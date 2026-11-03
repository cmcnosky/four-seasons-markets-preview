(function () {
  'use strict';

  var FIREBASE_VERSION = '13.2.0';
  var FIREBASE_APP_URL = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/firebase-app.js';
  var FIREBASE_AUTH_URL = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/firebase-auth.js';
  var listeners = new Set();
  var auth = null;
  var authApi = null;
  var initPromise = null;
  var state = {
    phase: 'loading',
    configured: null,
    user: null,
    message: ''
  };

  function apiOrigin() {
    var candidate = typeof window.FSM_API_ORIGIN === 'string' && window.FSM_API_ORIGIN.trim()
      ? window.FSM_API_ORIGIN.trim()
      : window.location.origin;
    try {
      var url = new URL(candidate, window.location.origin);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported API protocol');
      return url.origin;
    } catch (_error) {
      return window.location.origin;
    }
  }

  function publicState() {
    return {
      phase: state.phase,
      configured: state.configured,
      message: state.message,
      user: state.user ? {
        email: state.user.email,
        displayName: state.user.displayName,
        emailVerified: state.user.emailVerified,
        userKey: state.user.userKey
      } : null
    };
  }

  function emit() {
    var next = publicState();
    listeners.forEach(function (listener) {
      try { listener(next); } catch (_error) { /* listener errors stay isolated */ }
    });
  }

  function setState(next) {
    state = Object.assign({}, state, next);
    emit();
    return publicState();
  }

  function publishUser(user) {
    if (!user) return setState({ phase: 'signed-out', configured: true, user: null, message: '' });
    return setState({
      phase: user.emailVerified ? 'authenticated' : 'unverified',
      configured: true,
      user: {
        email: typeof user.email === 'string' ? user.email : '',
        displayName: typeof user.displayName === 'string' ? user.displayName : '',
        emailVerified: user.emailVerified === true,
        userKey: typeof user.uid === 'string' ? user.uid : ''
      },
      message: ''
    });
  }

  function verificationReturnUrl() {
    var base = typeof window.FSM_CANONICAL_URL === 'string' && window.FSM_CANONICAL_URL.trim()
      ? window.FSM_CANONICAL_URL.trim()
      : window.location.href;
    var url = new URL(base, window.location.href);
    url.search = '';
    url.hash = 'workspace';
    return url.href;
  }

  function authError(error, fallback) {
    var code = error && typeof error.code === 'string' ? error.code : 'auth/unknown';
    var messages = {
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/missing-email': 'Enter your email address.',
      'auth/missing-password': 'Enter your password.',
      'auth/invalid-credential': 'The email or password is incorrect.',
      'auth/invalid-login-credentials': 'The email or password is incorrect.',
      'auth/wrong-password': 'The email or password is incorrect.',
      'auth/user-not-found': 'The email or password is incorrect.',
      'auth/email-already-in-use': 'An account already uses that email. Sign in or reset the password instead.',
      'auth/weak-password': 'Choose a stronger password with at least eight characters.',
      'auth/user-disabled': 'This account is disabled. Contact support for help.',
      'auth/too-many-requests': 'Too many attempts were made. Wait a little while and try again.',
      'auth/network-request-failed': 'The account service could not be reached. Check the connection and try again.',
      'auth/popup-blocked': 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.',
      'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
      'auth/cancelled-popup-request': 'A newer Google sign-in attempt replaced the previous one.',
      'auth/account-exists-with-different-credential': 'That email already has an account. Sign in with the method originally used for it.',
      'auth/unauthorized-domain': 'Google sign-in is not authorized for this website yet.',
      'auth/app-not-authorized': 'This website is not authorized to use the configured account service.',
      'auth/operation-not-allowed': 'That sign-in method is not enabled yet.',
      'auth/operation-not-supported-in-this-environment': 'This browser cannot open the Google sign-in flow. Try email sign-in instead.',
      'auth/web-storage-unsupported': 'This browser is blocking the session storage needed for sign-in.',
      'auth/unsupported-persistence-type': 'This browser cannot keep the account session in this tab.',
      'auth/requires-recent-login': 'Sign in again before making that account change.',
      'auth/internal-error': 'The account service could not complete that request. Try again.',
      'auth/config-load-failed': 'Account sign-in could not load. Check the connection and try again.',
      'auth/configuration-not-found': 'Account sign-in is still being configured.',
      'auth/not-configured': 'Account sign-in is still being configured.',
      'auth/not-signed-in': 'Sign in to continue.',
      'auth/verification-send-failed': 'Your account was created, but the verification email could not be sent. Use Resend verification email to try again.'
    };
    var result = new Error(messages[code] || fallback || 'The account request could not be completed. Try again.');
    result.code = code;
    result.cause = error;
    return result;
  }

  async function ensureReady() {
    await initialize();
    if (!auth || !authApi || state.configured !== true) throw authError({ code: 'auth/not-configured' });
    return auth;
  }

  async function initialize() {
    if (initPromise) return initPromise;
    initPromise = (async function () {
      try {
        var response = await window.fetch(apiOrigin() + '/api/auth-config', {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
        });
        var configPayload = null;
        try { configPayload = await response.json(); } catch (_error) { configPayload = null; }
        if (configPayload && configPayload.configured === false) {
          return setState({ phase: 'unconfigured', configured: false, user: null, message: 'Account sign-in is being configured.' });
        }
        if (!response.ok) throw authError({ code: 'auth/config-load-failed' });
        if (!configPayload || configPayload.configured !== true || !configPayload.firebase) {
          return setState({ phase: 'unconfigured', configured: false, user: null, message: 'Account sign-in is being configured.' });
        }

        var firebaseConfig = configPayload.firebase;
        if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId) {
          return setState({ phase: 'unconfigured', configured: false, user: null, message: 'Account sign-in is being configured.' });
        }

        var modules = await Promise.all([import(FIREBASE_APP_URL), import(FIREBASE_AUTH_URL)]);
        var appApi = modules[0];
        authApi = modules[1];
        var appName = 'fsm-vendor-auth';
        var app = appApi.getApps().find(function (candidate) { return candidate.name === appName; }) || appApi.initializeApp(firebaseConfig, appName);
        auth = authApi.getAuth(app);
        auth.useDeviceLanguage();
        await authApi.setPersistence(auth, authApi.browserSessionPersistence);

        await new Promise(function (resolve) {
          var first = true;
          authApi.onAuthStateChanged(auth, function (user) {
            publishUser(user);
            if (first) { first = false; resolve(); }
          }, function (error) {
            setState({ phase: 'error', configured: true, user: null, message: authError(error).message });
            if (first) { first = false; resolve(); }
          });
        });
      } catch (error) {
        setState({ phase: 'error', configured: null, user: null, message: authError(error, 'Account sign-in could not load. Check the connection and try again.').message });
      }
      return publicState();
    })();
    return initPromise;
  }

  async function signIn(email, password) {
    await ensureReady();
    try {
      var credential = await authApi.signInWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
      return publishUser(credential.user);
    } catch (error) {
      throw authError(error, 'Sign-in could not be completed.');
    }
  }

  async function signUp(email, password, displayName) {
    await ensureReady();
    try {
      var credential = await authApi.createUserWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
      if (String(displayName || '').trim()) {
        await authApi.updateProfile(credential.user, { displayName: String(displayName).trim().slice(0, 120) });
      }
      publishUser(credential.user);
      try {
        await authApi.sendEmailVerification(credential.user, { url: verificationReturnUrl(), handleCodeInApp: false });
      } catch (verificationError) {
        throw authError({ code: 'auth/verification-send-failed', originalError: verificationError });
      }
      return publishUser(credential.user);
    } catch (error) {
      if (error && error.code === 'auth/verification-send-failed') throw error;
      throw authError(error, 'The account could not be created.');
    }
  }

  async function signInGoogle() {
    await ensureReady();
    try {
      var provider = new authApi.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      var credential = await authApi.signInWithPopup(auth, provider);
      return publishUser(credential.user);
    } catch (error) {
      throw authError(error, 'Google sign-in could not be completed.');
    }
  }

  async function sendPasswordReset(email) {
    await ensureReady();
    var address = String(email || '').trim();
    if (!address) throw authError({ code: 'auth/missing-email' });
    try {
      await authApi.sendPasswordResetEmail(auth, address, { url: verificationReturnUrl(), handleCodeInApp: false });
      return true;
    } catch (error) {
      if (error && error.code === 'auth/user-not-found') return true;
      throw authError(error, 'The password reset email could not be sent.');
    }
  }

  async function sendVerification() {
    await ensureReady();
    var user = auth.currentUser;
    if (!user) throw authError({ code: 'auth/not-signed-in' });
    if (user.emailVerified) return publishUser(user);
    try {
      await authApi.sendEmailVerification(user, { url: verificationReturnUrl(), handleCodeInApp: false });
      return true;
    } catch (error) {
      throw authError(error, 'The verification email could not be sent.');
    }
  }

  async function refreshVerification() {
    await ensureReady();
    var user = auth.currentUser;
    if (!user) throw authError({ code: 'auth/not-signed-in' });
    try {
      await authApi.reload(user);
      user = auth.currentUser;
      if (user && user.emailVerified) await user.getIdToken(true);
      return publishUser(user);
    } catch (error) {
      throw authError(error, 'Verification status could not be refreshed.');
    }
  }

  async function getIdToken(forceRefresh) {
    await ensureReady();
    var user = auth.currentUser;
    if (!user) throw authError({ code: 'auth/not-signed-in' });
    try {
      return await user.getIdToken(forceRefresh === true);
    } catch (error) {
      throw authError(error, 'The account session could not be verified. Sign in again.');
    }
  }

  async function signOut() {
    await ensureReady();
    try {
      await authApi.signOut(auth);
      return publishUser(null);
    } catch (error) {
      throw authError(error, 'Sign-out could not be completed.');
    }
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.add(listener);
    try { listener(publicState()); } catch (_error) { /* no-op */ }
    return function () { listeners.delete(listener); };
  }

  async function ready() {
    await initialize();
    return publicState();
  }

  window.FSMAuth = {
    ready: ready,
    getState: publicState,
    getIdToken: getIdToken,
    signIn: signIn,
    signUp: signUp,
    signInGoogle: signInGoogle,
    sendPasswordReset: sendPasswordReset,
    sendVerification: sendVerification,
    refreshVerification: refreshVerification,
    signOut: signOut,
    onChange: onChange,
    apiOrigin: apiOrigin,
    sdkVersion: FIREBASE_VERSION
  };

  initialize();
})();
