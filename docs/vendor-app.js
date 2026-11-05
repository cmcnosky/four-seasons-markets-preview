(function () {
  'use strict';

  var API_PATH = '/api/workspace';
  var SESSION_DRAFT_PREFIX = 'fsm-vendor-session-draft-v1:';
  var DRAFT_NAMES = ['reservation', 'offer', 'profile', 'promotion'];
  var PHOTO_LIMIT = 700 * 1024;
  var VALID_SECTIONS = ['overview', 'reservations', 'offers', 'profile', 'promotions'];
  var COLORS = {
    paper: '#fff9ee',
    green: '#173d2d',
    tomato: '#c34b2b',
    mustard: '#e8bd52',
    ink: '#1e2923'
  };

  var OCCURRENCES = [
    { id: 'richardson', name: 'Richardson Farmers Market', short: 'Richardson', city: 'Richardson', venue: 'Dal-Rich Towne Square', address: '101 S Coit Rd, Richardson, TX 75080', date: '2026-11-07', day: 'Saturday', hours: '10 AM–2 PM', rhythm: 'weekly', fee: 45 },
    { id: 'arlington', name: 'Downtown Arlington Farmers Market', short: 'Downtown Arlington', city: 'Arlington', venue: 'Front & Center streets', address: '300 W Front St, Arlington, TX 76011', date: '2026-11-07', day: 'Saturday', hours: '10 AM–2 PM', rhythm: 'weekly', fee: 45 },
    { id: 'castle-hills', name: 'Castle Hills Outdoor Market', short: 'Castle Hills', city: 'Lewisville', venue: 'Village Shops & Plaza', address: '2540 King Arthur Blvd, Lewisville, TX 75056', date: '2026-11-07', day: 'Saturday', hours: '10 AM–2 PM', rhythm: 'monthly', fee: 60 },
    { id: 'plano', name: 'Plano Farmers Market', short: 'Plano', city: 'Plano', venue: 'Berkeley Square', address: '4721 W Park Blvd, Plano, TX 75093', date: '2026-11-07', day: 'Saturday', hours: '10 AM–2 PM', rhythm: 'weekly', fee: 45 },
    { id: 'carrollton', name: 'Carrollton Artisans Market', short: 'Carrollton', city: 'Carrollton', venue: 'Trinity Valley Shopping Center', address: '2722 N Josey Ln, Carrollton, TX 75007', date: '2026-11-08', day: 'Sunday', hours: '10 AM–2 PM', rhythm: 'weekly', fee: 45 },
    { id: 'flower-mound', name: 'Flower Mound Farmers Market', short: 'Flower Mound', city: 'Flower Mound', venue: 'The River Walk', address: '4203 River Walk Dr, Flower Mound, TX 75028', date: '2026-11-08', day: 'Sunday', hours: '10 AM–2 PM', rhythm: 'weekly', fee: 45 }
  ];

  var runtime = {
    root: null,
    section: 'overview',
    snapshot: null,
    loadedAt: 0,
    loading: false,
    busy: false,
    requestId: 0,
    promoImage: null,
    lastFocusedId: '',
    draftScope: '',
    lastAuthenticatedScope: '',
    revalidationTimer: 0,
    authEpoch: 0,
    activeController: null,
    revalidateAfterBusy: false,
    authUserKey: '',
    authMode: 'signin',
    authMessage: '',
    authMessageKind: 'success',
    authListenerBound: false
  };

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(value) {
    return escapeHTML(value).replace(/`/g, '&#96;');
  }

  function safeString(value, max) {
    var result = typeof value === 'string' ? value.trim() : '';
    return typeof max === 'number' ? result.slice(0, max) : result;
  }

  function safePhoto(value) {
    return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : '';
  }

  function safeWebUrl(value) {
    var text = safeString(value, 300);
    if (!text) return '';
    try {
      var url = new URL(text);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (_error) {
      return '';
    }
  }

  function makeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return prefix + '-' + window.crypto.randomUUID();
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function formatDate(value, includeYear) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 'Date not set';
    var date = new Date(value + 'T12:00:00');
    if (isNaN(date.getTime())) return 'Date not set';
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: includeYear === false ? undefined : 'numeric'
    }).format(date);
  }

  function formatTimestamp(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function todayInMarketTimezone() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      var values = {};
      parts.forEach(function (part) { values[part.type] = part.value; });
      return values.year + '-' + values.month + '-' + values.day;
    } catch (_error) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function offerVisibility(offer, profile) {
    if (offer.status !== 'published') return { visible: false, label: statusLabel(offer.status), note: 'Only published offers can appear to shoppers.' };
    if (!profile.published) return { visible: false, label: 'PUBLISHED · PROFILE NOT PUBLIC', note: 'Publish the business profile to make this offer customer-visible.' };
    var today = todayInMarketTimezone();
    if (!offer.startDate || !offer.endDate) return { visible: false, label: 'PUBLISHED · DATES NEEDED', note: 'Add both date limits before this can appear publicly.' };
    if (today < offer.startDate) return { visible: false, label: 'PUBLISHED · STARTS ' + formatDate(offer.startDate, false).toUpperCase(), note: 'It will appear publicly on its start date while the profile remains public.' };
    if (today > offer.endDate) return { visible: false, label: 'PUBLISHED · ENDED', note: 'Its public date window has ended.' };
    return { visible: true, label: 'PUBLIC NOW', note: 'Visible to anyone in the directory during this date window.' };
  }

  function occurrenceFor(id, date) {
    return OCCURRENCES.find(function (item) {
      return item.id === id && (!date || item.date === date);
    }) || null;
  }

  function normaliseProfile(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var categories = Array.isArray(raw.categories) ? raw.categories : [raw.category1, raw.category2, raw.category3];
    return {
      businessName: safeString(raw.businessName || raw.name, 80),
      city: safeString(raw.city, 80),
      shortDescription: safeString(raw.shortDescription || raw.description, 120),
      about: safeString(raw.about, 350),
      categories: categories.map(function (item) { return safeString(item, 50); }).filter(Boolean).slice(0, 3),
      website: safeWebUrl(raw.website),
      instagram: safeWebUrl(raw.instagram),
      photoData: safePhoto(raw.photoData || raw.photoDataUrl || raw.photo),
      published: raw.published === true
    };
  }

  function normaliseReservation(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var market = occurrenceFor(raw.marketId, raw.date || raw.occurrenceDate);
    var size = raw.boothSize === '20x10' ? '20x10' : '10x10';
    var fee = typeof raw.estimatedFee === 'number' ? raw.estimatedFee : (market && size === '10x10' ? market.fee : null);
    return {
      id: safeString(raw.id, 120),
      marketId: safeString(raw.marketId, 80),
      date: safeString(raw.date || raw.occurrenceDate, 10),
      boothSize: size,
      notes: safeString(raw.notes, 240),
      status: raw.status === 'cancelled' ? 'cancelled' : 'requested',
      estimatedFee: fee,
      quoteNeeded: raw.quoteNeeded === true || size === '20x10',
      createdAt: raw.createdAt || '',
      updatedAt: raw.updatedAt || ''
    };
  }

  function normaliseOffer(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var status = ['draft', 'published', 'archived'].indexOf(raw.status) > -1 ? raw.status : 'draft';
    var typeAliases = {
      'Percentage off': 'percentage',
      'Dollar amount off': 'amount',
      'Bundle': 'bundle',
      'Free sample': 'free-item',
      'Market-day special': 'market-special',
      'New product': 'new-product',
      'Other': 'other'
    };
    var type = typeAliases[raw.type] || raw.type;
    if (['percentage', 'amount', 'bundle', 'free-item', 'market-special', 'new-product', 'other'].indexOf(type) === -1) type = '';
    return {
      id: safeString(raw.id, 120),
      title: safeString(raw.title, 80),
      type: type,
      value: safeString(raw.value, 60),
      description: safeString(raw.description, 150),
      startDate: safeString(raw.startDate || raw.startsOn, 10),
      endDate: safeString(raw.endDate || raw.endsOn || raw.expiry, 10),
      marketIds: Array.isArray(raw.marketIds) ? raw.marketIds.filter(function (id) { return !!occurrenceFor(id); }).slice(0, OCCURRENCES.length) : [],
      status: status,
      createdAt: raw.createdAt || '',
      updatedAt: raw.updatedAt || ''
    };
  }

  function normalisePromotion(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      id: safeString(raw.id, 120),
      title: safeString(raw.title, 80),
      reservationId: safeString(raw.reservationId, 120),
      marketId: safeString(raw.marketId, 80),
      offerId: safeString(raw.offerId, 120),
      format: raw.format === 'story' ? 'story' : 'square',
      headline: safeString(raw.headline, 80),
      caption: safeString(raw.caption, 600),
      updatedAt: raw.updatedAt || ''
    };
  }

  function normaliseSnapshot(payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    var state = payload.state && typeof payload.state === 'object' ? payload.state : payload;
    var account = payload.account && typeof payload.account === 'object' ? payload.account : {};
    var publicId = safeString(account.publicId, 120);
    return {
      version: Number.isFinite(Number(payload.version)) ? Number(payload.version) : Number(state.version) || 0,
      user: {
        displayName: safeString((payload.user && payload.user.displayName) || (state.user && state.user.displayName) || 'Vendor', 120)
      },
      account: {
        publicId: /^[a-zA-Z0-9_-]+$/.test(publicId) ? publicId : '',
        draftScope: safeString(account.draftScope, 240),
        status: account.status === 'active' ? 'active' : '',
        profilePublished: account.profilePublished === true,
        emailVerified: account.emailVerified === true
      },
      profile: normaliseProfile(state.profile),
      reservations: (Array.isArray(state.reservations) ? state.reservations : []).map(normaliseReservation),
      offers: (Array.isArray(state.offers) ? state.offers : []).map(normaliseOffer),
      promotions: (Array.isArray(state.promotions) ? state.promotions : (Array.isArray(state.campaigns) ? state.campaigns : [])).map(normalisePromotion)
    };
  }

  function workspaceApiUrl() {
    var origin = window.FSMAuth && typeof window.FSMAuth.apiOrigin === 'function'
      ? window.FSMAuth.apiOrigin()
      : window.location.origin;
    return new URL(API_PATH, origin).href;
  }

  function canonicalHashUrl(hash) {
    var base = typeof window.FSM_CANONICAL_URL === 'string' && window.FSM_CANONICAL_URL.trim()
      ? window.FSM_CANONICAL_URL.trim()
      : window.location.href;
    try {
      var url = new URL(base, window.location.href);
      url.search = '';
      url.hash = String(hash || '').replace(/^#/, '');
      return url.href;
    } catch (_error) {
      return hash || '#';
    }
  }

  function draftKey(name) {
    if (!runtime.snapshot || !runtime.draftScope || DRAFT_NAMES.indexOf(name) === -1) return '';
    return SESSION_DRAFT_PREFIX + runtime.draftScope + ':' + name;
  }

  function readDraft(name) {
    var key = draftKey(name);
    if (!key) return null;
    try {
      var raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function writeDraft(name, value) {
    var key = draftKey(name);
    if (!key) return false;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
      window.FSMComfort?.queue(name,value);
      return true;
    } catch (_error) {
      announce('This browser could not save the unfinished draft. Keep this page open until you save.', 'error');
      return false;
    }
  }

  function clearDraft(name) {
    var key = draftKey(name);
    if (!key) return;
    try { window.sessionStorage.removeItem(key); } catch (_error) { /* no-op */ }
    window.FSMComfort?.queue(name,null);
  }

  function clearWorkspaceMemory(clearAccountContext) {
    runtime.snapshot = null;
    runtime.draftScope = '';
    if (clearAccountContext) runtime.lastAuthenticatedScope = '';
    runtime.loadedAt = 0;
    runtime.promoImage = null;
    runtime.lastFocusedId = '';
  }

  function invalidatePendingRequest() {
    runtime.authEpoch += 1;
    runtime.requestId += 1;
    if (runtime.activeController) {
      try { runtime.activeController.abort(); } catch (_error) { /* no-op */ }
    }
    runtime.activeController = null;
    runtime.loading = false;
  }

  function concealWorkspace() {
    if (!runtime.root) return;
    runtime.root.querySelectorAll('.vapp-confirm-dialog').forEach(function (dialog) {
      if (typeof dialog._vappCancel === 'function') dialog._vappCancel();
      else dialog.remove();
    });
    var content = runtime.root.querySelector('[data-vapp-content]');
    if (content) content.innerHTML = loadingView();
  }

  function adoptSnapshot(payload) {
    var next = normaliseSnapshot(payload);
    var changedAccount = !!runtime.lastAuthenticatedScope && runtime.lastAuthenticatedScope !== next.account.draftScope;
    if (changedAccount) {
      runtime.promoImage = null;
      runtime.lastFocusedId = '';
    }
    runtime.snapshot = next;
    runtime.draftScope = next.account.draftScope;
    runtime.lastAuthenticatedScope = next.account.draftScope;
    runtime.loadedAt = Date.now();
    return next;
  }

  function navItem(section, number, label, note) {
    var href = section === 'overview' ? '#workspace' : '#workspace/' + section;
    var active = runtime.section === section;
    return '<a class="vapp-nav-link' + (active ? ' is-active' : '') + '" href="' + href + '"' + (active ? ' aria-current="page"' : '') + '>' +
      '<span class="vapp-nav-number">' + number + '</span><span><strong>' + escapeHTML(label) + '</strong><small>' + escapeHTML(note) + '</small></span></a>';
  }

  function renderVendorApp(section) {
    runtime.section = section === 'plans' ? 'reservations' : VALID_SECTIONS.indexOf(section) > -1 ? section : 'overview';
    return '<section class="vapp" data-vendor-app>' +
      '<div class="vapp-preview-bar"><strong>Vendor account</strong><span aria-hidden="true">·</span><span>One account · Applications, bookings & your business</span></div>' +
      '<div class="vapp-frame">' +
        '<aside class="vapp-sidebar">' +
          '<div class="vapp-side-head"><span class="vapp-kicker">Vendor workspace</span><a href="#workspace" class="vapp-wordmark">MARKET<br>DESK</a><p>Plan your markets. Promote your business.</p></div>' +
          '<nav class="vapp-nav" aria-label="Vendor workspace">' +
            navItem('overview', '00', 'Overview', 'What needs attention') +
            '<a class="vapp-nav-link" href="#operations/my-bookings"><span class="vapp-nav-number">01</span><span><strong>Bookings</strong><small>Requests & confirmations</small></span></a>' +
            navItem('offers', '02', 'Offers', 'Give shoppers a reason') +
            navItem('profile', '03', 'Profile', 'Publish your storefront') +
            '<a class="vapp-nav-link" href="#promotion-kit"><span class="vapp-nav-number">04</span><span><strong>Promotions</strong><small>Graphics, captions & QR</small></span></a>' +
          '<a class="vapp-nav-link" href="#account"><span class="vapp-nav-number">05</span><span><strong>Account</strong><small>Documents & settings</small></span></a></nav>' +
          '<div class="vapp-side-foot" data-vapp-account><span>Checking account…</span></div>' +
        '</aside>' +
        '<div class="vapp-main" id="vapp-main" tabindex="-1">' +
          '<div class="vapp-live" data-vapp-live role="status" aria-live="polite" aria-atomic="true"></div>' +
          '<div class="vapp-sync-bar"><span data-sync-status role="status">Draft autosave ready</span><button type="button" data-retry-drafts>Retry sync</button><button type="button" data-download-drafts>Download drafts</button><button type="button" data-use-cloud-drafts hidden>Use cloud copy</button><button type="button" data-keep-local-drafts hidden>Keep this device</button></div>' +
          '<div data-vapp-content>' + loadingView() + '</div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function loadingView() {
    return '<section class="vapp-loading" aria-label="Loading vendor workspace">' +
      '<span class="vapp-kicker">Opening the market desk</span><div class="vapp-loading-line"></div><div class="vapp-loading-line short"></div><p>Loading your saved vendor record…</p>' +
    '</section>';
  }

  function errorView(message) {
    return '<section class="vapp-error-panel" role="alert"><span class="vapp-panel-number">OFFLINE</span><div><h1>The market desk did not open.</h1><p>' + escapeHTML(message || 'The saved workspace could not be loaded.') + '</p><button class="vapp-button primary" type="button" data-vapp-retry>Try again</button><p class="vapp-fine">Account-scoped unfinished edits in this tab remain available after a successful reload.</p></div></section>';
  }

  function currentAuthState() {
    return window.FSMAuth && typeof window.FSMAuth.getState === 'function'
      ? window.FSMAuth.getState()
      : { phase: 'error', configured: null, user: null, message: 'Account sign-in could not load.' };
  }

  function authNotice() {
    return '<div class="vapp-auth-message ' + (runtime.authMessageKind === 'error' ? 'is-error' : 'is-success') + '" role="status" data-auth-message' + (runtime.authMessage ? '' : ' hidden') + '>' + escapeHTML(runtime.authMessage) + '</div>';
  }

  function authView(authState) {
    authState = authState || currentAuthState();
    if (authState.phase === 'loading') return loadingView();
    if (authState.phase === 'authenticated') return loadingView();
    if (authState.phase === 'unconfigured') {
      return '<section class="vapp-error-panel vapp-auth-panel"><span class="vapp-panel-number">SOON</span><div><span class="vapp-kicker">Vendor accounts</span><h1>ACCOUNT SIGN-IN IS BEING CONFIGURED.</h1><p>The shopper-facing markets and vendor directory remain available. Account creation and vendor workspace access will open after the identity provider is connected.</p><div class="vapp-auth-links"><a class="vapp-button primary" href="#vendors">Browse vendors →</a><a class="vapp-button outline" href="#markets">Find a market →</a></div></div></section>';
    }
    if (authState.phase === 'error') {
      return '<section class="vapp-error-panel vapp-auth-panel" role="alert"><span class="vapp-panel-number">ACCOUNT</span><div><span class="vapp-kicker">Vendor accounts</span><h1>SIGN-IN COULD NOT LOAD.</h1><p>' + escapeHTML(authState.message || 'Check the connection and try again.') + '</p><button class="vapp-button primary" type="button" data-auth-retry>Try account sign-in again</button><div class="vapp-auth-links"><a href="#vendors">Browse vendors ↗</a><a href="#markets">Find a market ↗</a></div></div></section>';
    }
    if (authState.phase === 'unverified') return verificationView(authState);

    var signup = runtime.authMode === 'signup';
    var reset = runtime.authMode === 'reset';
    var heading = signup ? 'CREATE YOUR VENDOR ACCOUNT.' : reset ? 'RESET YOUR PASSWORD.' : 'WELCOME BACK TO MARKET DESK.';
    var intro = signup
      ? 'Create one account for your saved profile, offers, applications, and bookings across devices.'
      : reset
        ? 'Enter the email on your account to request a secure password-reset link.'
        : 'Sign in to manage your vendor storefront and saved market-day work.';
    var form = '';
    if (reset) {
      form = '<form class="vapp-auth-form" data-auth-form="reset" novalidate><div class="vapp-field"><label for="vapp-auth-reset-email">Email address</label><input id="vapp-auth-reset-email" name="email" type="email" autocomplete="email" inputmode="email" required></div><button class="vapp-button primary" type="submit">Send reset email →</button><button class="vapp-text-button" type="button" data-auth-mode="signin">Back to sign in</button></form>';
    } else {
      form = '<div class="vapp-auth-tabs" role="group" aria-label="Choose account action"><button type="button" data-auth-mode="signin" aria-pressed="' + String(!signup) + '">Sign in</button><button type="button" data-auth-mode="signup" aria-pressed="' + String(signup) + '">Create account</button></div>' +
        '<label class="vapp-remember"><input type="checkbox" data-remember-device> Keep me signed in on this device</label><p class="vapp-fine">Leave unchecked on a shared device.</p>' +
        '<button class="vapp-google-button" type="button" data-auth-google><svg class="vapp-google-mark" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path fill="#4285f4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34a853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.91-2.258c-.805.54-1.835.859-3.046.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18z"/><path fill="#fbbc05" d="M3.963 10.707A5.42 5.42 0 0 1 3.682 9c0-.592.101-1.167.281-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332z"/><path fill="#ea4335" d="M9 3.579c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.463.892 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.164 6.656 3.579 9 3.579z"/></svg>Continue with Google</button><div class="vapp-auth-divider"><span>or use email</span></div>' +
        '<form class="vapp-auth-form" data-auth-form="' + (signup ? 'signup' : 'signin') + '" novalidate>' +
          (signup ? '<div class="vapp-field"><label for="vapp-auth-name">Your name</label><input id="vapp-auth-name" name="displayName" maxlength="120" autocomplete="name" required></div>' : '') +
          '<div class="vapp-field"><label for="vapp-auth-email">Email address</label><input id="vapp-auth-email" name="email" type="email" autocomplete="username" inputmode="email" required></div>' +
          '<div class="vapp-field"><label for="vapp-auth-password">Password</label><input id="vapp-auth-password" name="password" type="password" minlength="8" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" required><small>' + (signup ? 'Use at least eight characters.' : 'Use the password for your vendor account.') + '</small></div>' +
          (signup ? '<div class="vapp-field"><label for="vapp-auth-confirm">Confirm password</label><input id="vapp-auth-confirm" name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></div>' : '') +
          '<button class="vapp-button primary" type="submit">' + (signup ? 'Create account →' : 'Sign in →') + '</button>' +
          (!signup ? '<button class="vapp-text-button" type="button" data-auth-mode="reset">Forgot password?</button>' : '') +
        '</form>';
    }
    return '<section class="vapp-auth-layout"><div class="vapp-auth-poster"><span class="vapp-panel-number">ACCOUNT</span><h1>' + heading + '</h1><p>' + intro + '</p><ul class="vapp-auth-features"><li>Saved workspace records sync across signed-in devices.</li><li>Only the profile and current offers you publish are public.</li><li>Planning requests do not allocate a booth or collect payment.</li></ul></div><div class="vapp-auth-card"><span class="vapp-kicker">One website · one vendor account</span>' + authNotice() + form + '<p class="vapp-auth-privacy">Use the same sign-in on any device to return to your saved work.</p></div></section>';
  }

  function verificationView(authState) {
    var email = authState && authState.user ? authState.user.email : '';
    return '<section class="vapp-auth-layout"><div class="vapp-auth-poster mustard"><span class="vapp-panel-number">VERIFY</span><h1>CHECK YOUR EMAIL.</h1><p>Verify the email address before opening the vendor workspace or publishing customer-facing information.</p><ul class="vapp-auth-features"><li>Your saved workspace remains private until verification succeeds.</li><li>The verification link returns to this website.</li><li>You can resend the message or refresh your status below.</li></ul></div><div class="vapp-auth-card"><span class="vapp-kicker">Email verification required</span><h2>' + escapeHTML(email || 'Your email address') + '</h2>' + authNotice() + '<p>Open the verification link, then return here. We check automatically; you can also check again below.</p><div class="vapp-auth-stack"><button class="vapp-button primary" type="button" data-auth-refresh>I verified my email →</button><button class="vapp-button outline" type="button" data-auth-resend>Resend verification email</button><button class="vapp-text-button" type="button" data-auth-signout>Use a different account</button></div></div></section>';
  }

  function renderAuthGate(authState) {
    if (!runtime.root) return;
    var content = runtime.root.querySelector('[data-vapp-content]');
    if (content) content.innerHTML = authView(authState);
    updateAccountUI(authState && authState.phase === 'loading' ? 'checking' : 'signed-out');
    bindAuthUI();
  }

  function updateAccountUI(state) {
    if (!runtime.root) return;
    var panel = runtime.root.querySelector('[data-vapp-account]');
    if (!panel) return;
    if (!runtime.snapshot) {
      if (state === 'checking') {
        panel.innerHTML = '<span>Checking account…</span>';
        return;
      }
      if (state === 'unavailable') {
        panel.innerHTML = '<span>Account status unavailable.</span><a href="#vendors">View shopper directory ↗</a>';
        return;
      }
      var authState = currentAuthState();
      if (authState.user) panel.innerHTML = '<span class="vapp-account-label">Account</span><strong class="vapp-account-name">' + escapeHTML(authState.user.displayName || authState.user.email || 'Vendor') + '</strong><span>' + (authState.phase === 'unverified' ? 'Email verification required.' : 'Opening your workspace…') + '</span><button type="button" data-auth-signout>Sign out ↗</button>';
      else panel.innerHTML = '<span>Sign in or create an account in the workspace panel.</span><a href="#vendors">View shopper directory ↗</a>';
      bindSideAccountActions();
      return;
    }
    var displayName = runtime.snapshot.user.displayName || 'Vendor';
    var publicProfile = runtime.snapshot.profile.published && runtime.snapshot.account.publicId
      ? '<a href="' + attr(canonicalHashUrl('#vendor/profile-' + runtime.snapshot.account.publicId)) + '">View your public profile ↗</a>'
      : '<a href="#vendors">View shopper directory ↗</a>';
    panel.innerHTML = '<span class="vapp-account-label">Signed in</span><strong class="vapp-account-name">' + escapeHTML(displayName) + '</strong><span>Saved records sync across signed-in devices.</span>' + publicProfile + '<button type="button" data-auth-signout>Sign out ↗</button>';
    bindSideAccountActions();
  }

  function displayAuthMessage(message, kind) {
    runtime.authMessage = message || '';
    runtime.authMessageKind = kind === 'error' ? 'error' : 'success';
    if (!runtime.root) return;
    var region = runtime.root.querySelector('[data-auth-message]');
    if (!region) return;
    region.hidden = !runtime.authMessage;
    region.className = 'vapp-auth-message ' + (runtime.authMessageKind === 'error' ? 'is-error' : 'is-success');
    region.textContent = runtime.authMessage;
  }

  function setAuthPending(button, pending, text) {
    if (!button) return;
    if (pending) {
      button.dataset.originalText = button.textContent;
      button.textContent = text || 'Working…';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  async function signOutVendor(button) {
    if (!window.FSMAuth) return;
    if (window.FSMComfort && typeof window.FSMComfort.hasUnsynced === 'function' && window.FSMComfort.hasUnsynced()) {
      var signOutAnyway = await confirmAction(
        'Sign out with unfinished drafts?',
        'Some edits have not reached your account yet. They will remain in this browser tab for this vendor account and stay hidden from other accounts. On a shared device, download a copy or wait for sync before signing out.',
        'Sign out anyway',
        true
      );
      if (!signOutAnyway) return;
    }
    setAuthPending(button, true, 'Signing out…');
    invalidatePendingRequest();
    runtime.busy = false;
    clearWorkspaceMemory(true);
    concealWorkspace();
    try {
      await window.FSMAuth.signOut();
      runtime.authUserKey = '';
      runtime.authMode = 'signin';
      runtime.authMessage = 'Signed out on this tab.';
      runtime.authMessageKind = 'success';
      renderAuthGate(window.FSMAuth.getState());
    } catch (error) {
      runtime.authMessage = error.message || 'Sign-out could not be completed.';
      runtime.authMessageKind = 'error';
      renderAuthGate({ phase: 'error', configured: true, user: window.FSMAuth.getState().user, message: runtime.authMessage });
    }
  }

  function bindSideAccountActions() {
    if (!runtime.root) return;
    runtime.root.querySelectorAll('[data-vapp-account] [data-auth-signout]').forEach(function (button) {
      button.addEventListener('click', function () { signOutVendor(button); });
    });
  }

  function bindDraftSafetyActions() {
    if (!runtime.root || !window.FSMComfort || typeof window.FSMComfort.resolveConflicts !== 'function') return;
    var cloudButton = runtime.root.querySelector('[data-use-cloud-drafts]');
    var localButton = runtime.root.querySelector('[data-keep-local-drafts]');
    if (cloudButton) cloudButton.addEventListener('click', async function () {
      if (!await confirmAction('Use the cloud copy?', 'This replaces the conflicting unfinished drafts in this browser tab. Download your device copy first if you may need it.', 'Use cloud copy', true)) return;
      setAuthPending(cloudButton, true, 'Checking cloud…');
      try {
        var resolved = await window.FSMComfort.resolveConflicts('cloud');
        if (resolved) announce('Cloud drafts loaded. The conflicting device copies were discarded by your choice.', 'success');
      } finally { setAuthPending(cloudButton, false); }
    });
    if (localButton) localButton.addEventListener('click', async function () {
      if (!await confirmAction('Keep the drafts on this device?', 'This saves the conflicting drafts from this browser tab over the current cloud copies. Download a backup first if you need both versions.', 'Keep this device', false)) return;
      setAuthPending(localButton, true, 'Saving device copy…');
      try {
        var resolved = await window.FSMComfort.resolveConflicts('local');
        if (resolved) announce('The device drafts were selected and sent to your account.', 'success');
      } finally { setAuthPending(localButton, false); }
    });
  }

  function bindAuthUI() {
    if (!runtime.root) return;
    runtime.root.querySelectorAll('[data-auth-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        runtime.authMode = button.getAttribute('data-auth-mode') || 'signin';
        runtime.authMessage = '';
        renderAuthGate(currentAuthState());
        var first = runtime.root.querySelector('.vapp-auth-form input');
        if (first) first.focus();
      });
    });
    var retry = runtime.root.querySelector('[data-auth-retry]');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });

    runtime.root.querySelectorAll('[data-auth-signout]').forEach(function (button) {
      if (button.closest('[data-vapp-account]')) return;
      button.addEventListener('click', function () { signOutVendor(button); });
    });

    var google = runtime.root.querySelector('[data-auth-google]');
    if (google) google.addEventListener('click', async function () {
      setAuthPending(google, true, 'Opening Google…');
      displayAuthMessage('', 'success');
      try {
        await window.FSMAuth.setRememberDevice(!!runtime.root.querySelector('[data-remember-device]')?.checked);
        var next = await window.FSMAuth.signInGoogle();
        runtime.authMessage = '';
        if (next.phase === 'authenticated') await loadWorkspace(true);
        else renderAuthGate(next);
      } catch (error) {
        setAuthPending(google, false);
        displayAuthMessage(error.message || 'Google sign-in could not be completed.', 'error');
      }
    });

    var form = runtime.root.querySelector('[data-auth-form]');
    if (form) form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var mode = form.getAttribute('data-auth-form');
      var submit = event.submitter || form.querySelector('[type="submit"]');
      var email = form.elements.email ? form.elements.email.value.trim() : '';
      var password = form.elements.password ? form.elements.password.value : '';
      displayAuthMessage('', 'success');
      if (!email) { displayAuthMessage('Enter your email address.', 'error'); form.elements.email.focus(); return; }
      if (mode !== 'reset' && !password) { displayAuthMessage('Enter your password.', 'error'); form.elements.password.focus(); return; }
      if (mode === 'signup' && !form.elements.displayName.value.trim()) { displayAuthMessage('Enter your name.', 'error'); form.elements.displayName.focus(); return; }
      if (mode === 'signup' && password.length < 8) { displayAuthMessage('Choose a password with at least eight characters.', 'error'); form.elements.password.focus(); return; }
      if (mode === 'signup' && password !== form.elements.confirmPassword.value) { displayAuthMessage('The two passwords do not match.', 'error'); form.elements.confirmPassword.focus(); return; }
      setAuthPending(submit, true, mode === 'reset' ? 'Sending…' : mode === 'signup' ? 'Creating…' : 'Signing in…');
      try {
        if (mode === 'reset') {
          await window.FSMAuth.sendPasswordReset(email);
          setAuthPending(submit, false);
          form.reset();
          displayAuthMessage('If that email is eligible, a secure password-reset link is on its way.', 'success');
          return;
        }
        await window.FSMAuth.setRememberDevice(!!runtime.root.querySelector('[data-remember-device]')?.checked);
        var next = mode === 'signup'
          ? await window.FSMAuth.signUp(email, password, form.elements.displayName.value)
          : await window.FSMAuth.signIn(email, password);
        form.reset();
        runtime.authMessage = next.phase === 'unverified' ? 'Verification email sent. Check your inbox and spam folder.' : '';
        runtime.authMessageKind = 'success';
        if (next.phase === 'authenticated') await loadWorkspace(true);
        else renderAuthGate(next);
      } catch (error) {
        setAuthPending(submit, false);
        var latest = currentAuthState();
        if (latest.phase === 'unverified') {
          runtime.authMessage = error.message || 'Verify your email to continue.';
          runtime.authMessageKind = 'error';
          renderAuthGate(latest);
        } else {
          displayAuthMessage(error.message || 'The account request could not be completed.', 'error');
        }
      }
    });

    var resend = runtime.root.querySelector('[data-auth-resend]');
    if (resend) resend.addEventListener('click', async function () {
      setAuthPending(resend, true, 'Sending…');
      try {
        await window.FSMAuth.sendVerification();
        setAuthPending(resend, false);
        displayAuthMessage('Verification email sent. Check your inbox and spam folder.', 'success');
      } catch (error) {
        setAuthPending(resend, false);
        displayAuthMessage(error.message || 'The verification email could not be sent.', 'error');
      }
    });

    var refresh = runtime.root.querySelector('[data-auth-refresh]');
    if (refresh) refresh.addEventListener('click', async function () {
      setAuthPending(refresh, true, 'Checking…');
      try {
        var next = await window.FSMAuth.refreshVerification();
        if (next.phase === 'authenticated') {
          runtime.authMessage = '';
          await loadWorkspace(true);
        } else {
          setAuthPending(refresh, false);
          displayAuthMessage('The email is not verified yet. Open the verification link, then try again.', 'error');
        }
      } catch (error) {
        setAuthPending(refresh, false);
        displayAuthMessage(error.message || 'Verification status could not be refreshed.', 'error');
      }
    });
  }

  function confirmAction(title, body, confirmLabel, danger) {
    return new Promise(function (resolve) {
      if (!runtime.root) { resolve(false); return; }
      var dialog = document.createElement('dialog');
      var titleId = 'vapp-confirm-' + Date.now().toString(36);
      dialog.className = 'vapp-confirm-dialog';
      dialog.setAttribute('aria-labelledby', titleId);
      dialog.innerHTML = '<div class="vapp-confirm-head"><span>PLEASE CONFIRM</span><strong aria-hidden="true">!</strong></div><div class="vapp-confirm-body"><h2 id="' + attr(titleId) + '">' + escapeHTML(title) + '</h2><p>' + escapeHTML(body) + '</p><div class="vapp-confirm-actions"><button class="vapp-button outline" type="button" data-confirm-cancel>Go back</button><button class="vapp-button ' + (danger ? 'danger' : 'primary') + '" type="button" data-confirm-accept>' + escapeHTML(confirmLabel) + '</button></div></div>';
      var settled = false;
      var boundScope = runtime.draftScope;
      var previousFocus = document.activeElement;
      function finish(value) {
        if (settled) return;
        settled = true;
        try { if (dialog.open) dialog.close(); } catch (_error) { /* no-op */ }
        dialog.remove();
        if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) previousFocus.focus();
        resolve(value);
      }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(false); });
      dialog._vappCancel = function () { finish(false); };
      dialog.querySelector('[data-confirm-cancel]').addEventListener('click', function () { finish(false); });
      var accept = dialog.querySelector('[data-confirm-accept]');
      accept.addEventListener('click', function () { finish(!!runtime.snapshot && runtime.draftScope === boundScope); });
      runtime.root.appendChild(dialog);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      accept.focus();
    });
  }

  async function apiRequest(method, body, options) {
    options = options || {};
    var response;
    try {
      var headers = body ? { 'Content-Type': 'application/json', 'Accept': 'application/json' } : { 'Accept': 'application/json' };
      var token = await window.FSMAuth.getIdToken(options.forceToken === true);
      headers.Authorization = 'Bearer ' + token;
      if (method === 'PATCH' && options.accountScope) {
        headers['X-Vendor-Account'] = options.accountScope;
      }
      response = await window.fetch(workspaceApiUrl(), {
        method: method,
        credentials: 'omit',
        cache: 'no-store',
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: options.signal
      });
    } catch (requestError) {
      if (requestError && requestError.name === 'AbortError') {
        var abortedError = new Error('The workspace request was replaced by a newer account check.');
        abortedError.code = 'aborted';
        throw abortedError;
      }
      if (requestError && typeof requestError.code === 'string' && requestError.code.indexOf('auth/') === 0) {
        requestError.status = 401;
        requestError.data = { error: 'authentication_required', message: requestError.message };
        throw requestError;
      }
      var networkError = new Error('The network did not respond. Check the connection and try again.');
      networkError.code = 'network';
      throw networkError;
    }

    var data = null;
    try { data = await response.json(); } catch (_error) { data = null; }

    if (response.status === 401 && !options.authRetried) {
      return apiRequest(method, body, Object.assign({}, options, { authRetried: true, forceToken: true }));
    }

    if (!response.ok) {
      var errorMessages = {
        duplicate_reservation_request: 'A request for that market date is already saved. Cancel it before creating another.',
        reservation_already_cancelled: 'That request is already cancelled.',
        reservation_not_found: 'That saved request could not be found. Reload the workspace and try again.',
        offer_not_found: 'That offer could not be found. Reload the workspace and try again.',
        offer_already_archived: 'That offer is already archived.',
        promotion_not_found: 'That campaign could not be found. Reload the workspace and try again.',
        occurrence_not_verified: 'That market and date pair is not available for planning here.',
        past_occurrence: 'That market occurrence has passed and can no longer be requested.',
        reservation_market_mismatch: 'The selected reservation does not match this campaign market.',
        offer_market_mismatch: 'The selected offer is not associated with this campaign market.',
        account_changed: 'The signed-in account changed. The workspace has been reloaded without saving the previous form.',
        missing_account_context: 'The account context was missing. Reload the workspace before saving.',
        email_verification_required: 'Verify your email address before opening or changing the vendor workspace.',
        workspace_too_large: 'The saved workspace is at its storage limit. Remove an old campaign or use a smaller profile photo.',
        request_too_large: 'This save is too large. Use a smaller profile photo and try again.',
        workspace_unavailable: 'The saved workspace is temporarily unavailable.'
      };
      var issue = data && Array.isArray(data.issues) && data.issues[0] ? data.issues[0] : null;
      var issuePrefix = issue && issue.path ? issue.path.replace(/^payload\.?/, '').replace(/\./g, ' ') + ': ' : '';
      var message = data && data.message ? data.message : issue ? issuePrefix + issue.message : (data && errorMessages[data.error]) || 'The workspace request failed (' + response.status + ').';
      var error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data || {};
  }

  async function loadWorkspace(force) {
    if (!runtime.root) return;
    if (runtime.busy) {
      runtime.revalidateAfterBusy = true;
      return;
    }
    if (runtime.loading) return;
    runtime.loading = true;
    var epoch = runtime.authEpoch;
    var requestId = ++runtime.requestId;
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    runtime.activeController = controller;
    clearWorkspaceMemory(false);
    updateAccountUI('checking');
    concealWorkspace();

    try {
      if (!window.FSMAuth || typeof window.FSMAuth.ready !== 'function') {
        clearWorkspaceMemory(false);
        renderAuthGate({ phase: 'error', configured: null, user: null, message: 'Account sign-in could not load.' });
        return;
      }
      var authState = await window.FSMAuth.ready();
      if (epoch !== runtime.authEpoch || requestId !== runtime.requestId || !runtime.root) return;
      var authKey = authState.user && authState.user.userKey ? authState.user.userKey : '';
      if (runtime.authUserKey && runtime.authUserKey !== authKey) {
        runtime.lastAuthenticatedScope = '';
      }
      runtime.authUserKey = authKey;
      if (authState.phase !== 'authenticated') {
        clearWorkspaceMemory(authState.phase === 'signed-out');
        renderAuthGate(authState);
        return;
      }
      var payload = await apiRequest('GET', null, { signal: controller ? controller.signal : undefined });
      if (epoch !== runtime.authEpoch || requestId !== runtime.requestId || !runtime.root) return;
      var snapshot = adoptSnapshot(payload);
      if (!snapshot.account.draftScope || snapshot.account.status !== 'active' || !snapshot.account.emailVerified) {
        clearWorkspaceMemory(false);
        throw new Error('The authenticated account response was incomplete. Reload and try again.');
      }
      await window.FSMComfort?.load(snapshot.account.draftScope);
      if (epoch !== runtime.authEpoch || requestId !== runtime.requestId || !runtime.root) return;
      renderCurrentSection();
      window.FSMComfort?.paint();
    } catch (error) {
      if (epoch !== runtime.authEpoch || requestId !== runtime.requestId || !runtime.root || error.code === 'aborted') return;
      var needsSignIn = error.status === 401;
      var needsVerification = error.status === 403 && error.data && error.data.error === 'email_verification_required';
      if (needsSignIn) {
        invalidatePendingRequest();
        clearWorkspaceMemory(true);
        runtime.authUserKey = '';
        try { await window.FSMAuth.signOut(); } catch (_signOutError) { /* local gate still closes */ }
        runtime.authMessage = error.message || 'Sign in again to continue.';
        runtime.authMessageKind = 'error';
        renderAuthGate(currentAuthState());
      } else if (needsVerification) {
        clearWorkspaceMemory(false);
        runtime.authMessage = error.message || 'Verify your email address to continue.';
        runtime.authMessageKind = 'error';
        var verificationState = currentAuthState();
        verificationState.phase = 'unverified';
        renderAuthGate(verificationState);
      } else {
        clearWorkspaceMemory(false);
        updateAccountUI('unavailable');
        var currentContent = runtime.root.querySelector('[data-vapp-content]');
        if (currentContent) currentContent.innerHTML = errorView(error.message);
        bindRetry();
      }
    } finally {
      if (runtime.activeController === controller) runtime.activeController = null;
      if (epoch === runtime.authEpoch && requestId === runtime.requestId) runtime.loading = false;
    }
  }

  async function mutate(action, payload, button, successMessage) {
    if (runtime.busy || !runtime.snapshot) return null;
    runtime.busy = true;
    var mutationEpoch = runtime.authEpoch;
    var mutationScope = runtime.snapshot.account.draftScope;
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    runtime.activeController = controller;
    setPending(button, true);
    try {
      var result = await apiRequest('PATCH', {
        version: runtime.snapshot.version,
        action: action,
        payload: payload
      }, { accountScope: mutationScope, signal: controller ? controller.signal : undefined });
      if (mutationEpoch !== runtime.authEpoch || !runtime.snapshot || runtime.draftScope !== mutationScope) return null;
      var resultSnapshot = normaliseSnapshot(result);
      if (resultSnapshot.account.draftScope !== mutationScope) {
        invalidatePendingRequest();
        runtime.busy = false;
        clearWorkspaceMemory(true);
        await loadWorkspace(true);
        announce('The signed-in account changed. The workspace was reloaded and the previous form was not saved.', 'error');
        return null;
      }
      adoptSnapshot(result);
      renderCurrentSection();
      announce(successMessage || 'Saved.', 'success');
      return result;
    } catch (error) {
      if (mutationEpoch !== runtime.authEpoch || error.code === 'aborted') return null;
      if (error.status === 401) {
        invalidatePendingRequest();
        runtime.busy = false;
        clearWorkspaceMemory(true);
        runtime.authUserKey = '';
        try { await window.FSMAuth.signOut(); } catch (_signOutError) { /* local gate still closes */ }
        runtime.authMessage = error.message || 'Sign in again to continue.';
        runtime.authMessageKind = 'error';
        renderAuthGate(currentAuthState());
      } else if (error.status === 403 && error.data && error.data.error === 'email_verification_required') {
        invalidatePendingRequest();
        runtime.busy = false;
        clearWorkspaceMemory(false);
        runtime.authMessage = error.message || 'Verify your email address before saving workspace changes.';
        runtime.authMessageKind = 'error';
        var verificationState = currentAuthState();
        verificationState.phase = 'unverified';
        renderAuthGate(verificationState);
      } else if (error.status === 403 && error.data && (error.data.error === 'account_changed' || error.data.error === 'missing_account_context')) {
        invalidatePendingRequest();
        runtime.busy = false;
        clearWorkspaceMemory(true);
        await loadWorkspace(true);
        announce('The signed-in account changed. The workspace was reloaded and the previous form was not saved.', 'error');
      } else if (error.status === 409 && error.data && error.data.state) {
        adoptSnapshot(error.data);
        renderCurrentSection();
        announce('This workspace changed in another tab. The latest saved version is now shown; your unfinished browser draft was kept.', 'error');
      } else {
        setPending(button, false);
        announce(error.message || 'The change could not be saved. Your unfinished draft was kept.', 'error');
      }
      return null;
    } finally {
      if (runtime.activeController === controller) runtime.activeController = null;
      runtime.busy = false;
      if (runtime.revalidateAfterBusy) {
        runtime.revalidateAfterBusy = false;
        revalidateWorkspaceSession(true);
      }
    }
  }

  function setPending(button, pending) {
    if (!button) return;
    if (pending) {
      button.dataset.originalText = button.textContent;
      button.textContent = 'Saving…';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function announce(message, kind) {
    if (!runtime.root) return;
    var region = runtime.root.querySelector('[data-vapp-live]');
    if (!region) return;
    region.className = 'vapp-live is-visible ' + (kind === 'error' ? 'is-error' : 'is-success');
    region.textContent = message;
    window.clearTimeout(region._hideTimer);
    region._hideTimer = window.setTimeout(function () {
      if (region) region.className = 'vapp-live';
    }, 6500);
  }

  function bindRetry() {
    if (!runtime.root) return;
    var button = runtime.root.querySelector('[data-vapp-retry]');
    if (button) button.addEventListener('click', function () { loadWorkspace(true); });
  }

  function pageHeader(kicker, title, intro, action) {
    return '<header class="vapp-page-head"><div><span class="vapp-kicker">' + escapeHTML(kicker) + '</span><h1>' + escapeHTML(title) + '</h1><p>' + escapeHTML(intro) + '</p></div>' + (action || '') + '</header>';
  }

  function statusLabel(status) {
    var labels = { requested: 'Planning request', cancelled: 'Cancelled', draft: 'Draft', published: 'Published', archived: 'Archived' };
    return labels[status] || status || 'Draft';
  }

  function emptyState(number, title, body, action) {
    return '<div class="vapp-empty"><span>' + escapeHTML(number) + '</span><div><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(body) + '</p>' + (action || '') + '</div></div>';
  }

  function renderCurrentSection() {
    if (!runtime.root || !runtime.snapshot) return;
    var content = runtime.root.querySelector('[data-vapp-content]');
    if (!content) return;
    var views = {
      overview: overviewView,
      reservations: reservationsView,
      offers: offersView,
      profile: profileView,
      promotions: promotionsView
    };
    content.innerHTML = (views[runtime.section] || overviewView)();
    updateAccountUI();
    bindCurrentSection();
  }

  function bindCurrentSection() {
    if (runtime.section === 'reservations') bindReservations();
    if (runtime.section === 'offers') bindOffers();
    if (runtime.section === 'profile') bindProfile();
    if (runtime.section === 'promotions') bindPromotions();
  }

  function overviewView() {
    var state = runtime.snapshot;
    var publicOffers = state.offers.filter(function(item){return offerVisibility(item,state.profile).visible;});
    var name = state.profile.businessName || state.user.displayName || 'Vendor';
    var needs = [];
    if (!state.profile.published) needs.push('<a href="#workspace/profile"><span>01</span><strong>'+ (state.profile.businessName ? 'Publish your profile' : 'Start your public profile') +'</strong><small>Give shoppers a name, story, and reason to stop.</small></a>');
    needs.push('<a href="#operations/apply"><span>02</span><strong>Your vendor application</strong><small>Save your progress, attach documents, and track review.</small></a>');
    if(!publicOffers.length) needs.push('<a href="#workspace/offers"><span>03</span><strong>Make a shopper offer</strong><small>Review dates and publish an offer beside your profile.</small></a>');
    needs.push('<a href="#promotion-kit"><span>04</span><strong>Build your promotion kit</strong><small>Share your business, offers, and confirmed market dates.</small></a>');
    return pageHeader('Vendor overview','HELLO, '+name.toUpperCase(),'Your application, bookings, public storefront, and useful next steps in one account.','<a class="vapp-button ink" href="#operations/my-bookings">Your market bookings →</a>')+
      '<section class="vapp-scoreboard" aria-label="Workspace status">'+
      metric('01','DESK','Applications & bookings','Open your market record below')+
      metric('02',state.profile.published?'ON':'OFF','Public profile',state.profile.published?'Visible to anyone':'Account only')+
      metric('03',String(publicOffers.length),'Public offers now','Current dates and published profile')+
      metric('04','KIT','Promotion tools','Graphics, captions & QR posters')+'</section>'+
      '<div class="vapp-overview-grid"><section class="vapp-poster-panel mustard"><div class="vapp-panel-title"><span>UP NEXT</span><h2>Keep the stall moving.</h2></div><div class="vapp-task-list">'+needs.join('')+'</div></section>'+
      '<section class="vapp-ledger"><div class="vapp-section-bar"><div><span class="vapp-kicker">Your market record</span><h2>From application to arrival</h2></div></div><div class="vapp-task-list"><a href="#operations/my-bookings"><strong>Requests & confirmations</strong><small>See each booking status and cancel eligible requests.</small></a><a href="#operations/visits"><strong>Market-day instructions</strong><small>Load-in details, location, and your confirmed dates.</small></a><a href="#account/documents"><strong>Documents & photos</strong><small>Keep private paperwork and public gallery images together.</small></a><a href="#account/business"><strong>Useful business details</strong><small>Products, payment methods, pickup, and access information.</small></a></div></section></div>'+
      '<section class="vapp-ground-rules"><strong>Ready for review</strong><p>Your profile and current published offers can be viewed by customers. Applications and documents stay private. Official bookings will open after the organizer approves the operating rules and activates this website. Saved historical plans remain available in <a href="#workspace/plans">your planning archive</a>.</p></section>';
  }

  function metric(number, value, label, note) {
    return '<article class="vapp-metric"><span>' + number + '</span><strong>' + escapeHTML(value) + '</strong><div><b>' + escapeHTML(label) + '</b><small>' + escapeHTML(note) + '</small></div></article>';
  }

  function reservationRow(item) {
    var market = occurrenceFor(item.marketId, item.date);
    return '<article class="vapp-ledger-row"><div><span class="vapp-status ' + attr(item.status) + '">' + escapeHTML(statusLabel(item.status)) + '</span><h3>' + escapeHTML(market ? market.short : item.marketId || 'Market') + '</h3><p>' + escapeHTML(formatDate(item.date)) + ' · ' + escapeHTML(item.boothSize) + '</p></div><strong>' + (item.quoteNeeded ? 'QUOTE NEEDED' : '$' + escapeHTML(item.estimatedFee == null ? '—' : item.estimatedFee) + ' EST.') + '</strong></article>';
  }

  function reservationsView() {
    var draft = readDraft('reservation') || { marketId: '', boothSize: '10x10', notes: '' };
    var selected = occurrenceFor(draft.marketId);
    var booth = draft.boothSize === '20x10' ? '20x10' : '10x10';
    var requests = runtime.snapshot.reservations.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return pageHeader('01 / Reservations', 'PLAN A MARKET DATE', 'Choose a sourced date and save a planning request to your account. It is not sent to the organizer or confirmed as a booking.', '') +
      '<div class="vapp-work-grid reservation-grid">' +
        '<form class="vapp-editor" id="vapp-reservation-form" novalidate>' +
          '<div class="vapp-editor-head tomato"><span>NEW REQUEST</span><strong>Three clear steps.</strong></div>' +
          '<fieldset class="vapp-step"><legend><span>01</span> Choose a market and date</legend>' +
            '<label for="vapp-market">Market occurrence</label><select id="vapp-market" name="marketId" required><option value="">Select one of six sourced dates</option>' +
              OCCURRENCES.map(function (item) { return '<option value="' + attr(item.id) + '"' + (item.id === draft.marketId ? ' selected' : '') + '>' + escapeHTML(item.short + ' — ' + formatDate(item.date)) + '</option>'; }).join('') +
            '</select><div class="vapp-occurrence" data-reservation-occurrence>' + occurrenceSummary(selected) + '</div>' +
          '</fieldset>' +
          '<fieldset class="vapp-step"><legend><span>02</span> Pick a footprint</legend><div class="vapp-choice-grid">' +
            '<label class="vapp-choice"><input type="radio" name="boothSize" value="10x10"' + (booth === '10x10' ? ' checked' : '') + '><span><strong>10 × 10 FT</strong><small>' + (selected ? '$' + selected.fee + ' current estimate' : '$45 weekly / $60 monthly estimate') + '</small></span></label>' +
            '<label class="vapp-choice"><input type="radio" name="boothSize" value="20x10"' + (booth === '20x10' ? ' checked' : '') + '><span><strong>20 × 10 FT</strong><small>Price not published · quote needed</small></span></label>' +
          '</div></fieldset>' +
          '<fieldset class="vapp-step"><legend><span>03</span> Add notes and review</legend><label for="vapp-reservation-notes">Planning notes <span class="vapp-optional">Optional · not sent to market staff</span></label><textarea id="vapp-reservation-notes" name="notes" maxlength="240" rows="4" placeholder="Equipment, access needs, or questions to resolve before booking.">' + escapeHTML(draft.notes || '') + '</textarea><div class="vapp-count" data-count-for="vapp-reservation-notes">' + String((draft.notes || '').length) + ' / 240</div><div class="vapp-review-strip" data-reservation-review>' + reservationReview(selected, booth) + '</div></fieldset>' +
          '<div class="vapp-form-actions"><button class="vapp-button primary" type="submit">Save planning request</button><p>Private account record · no organizer submission, charge, or booth allocation.</p></div>' +
        '</form>' +
        '<section class="vapp-stack"><div class="vapp-section-bar"><div><span class="vapp-kicker">Your planning ledger</span><h2>Saved requests</h2></div><span>' + requests.length + ' total</span></div>' +
          (requests.length ? requests.map(reservationCard).join('') : emptyState('00', 'No saved requests', 'Your first saved request will appear here. It is not a confirmed booking.', '')) +
        '</section>' +
      '</div>';
  }

  function occurrenceSummary(item) {
    if (!item) return '<p>Select a market to see the sourced occurrence.</p>';
    return '<strong>' + escapeHTML(item.day + ', ' + formatDate(item.date, true)) + ' · ' + item.hours + '</strong><span>' + escapeHTML(item.venue) + '<br>' + escapeHTML(item.address) + '</span>';
  }

  function reservationReview(item, booth) {
    if (!item) return '<span>ESTIMATE</span><strong>Select a market first</strong>';
    var price = booth === '20x10' ? 'Quote needed' : '$' + item.fee + ' estimated';
    return '<span>REVIEW</span><strong>' + escapeHTML(item.short + ' · ' + booth) + '</strong><b>' + escapeHTML(price) + '</b><small>Planning record · not sent or approved</small>';
  }

  function reservationCard(item) {
    var market = occurrenceFor(item.marketId, item.date);
    var active = item.status === 'requested';
    return '<article class="vapp-record' + (active ? '' : ' is-muted') + '"><div class="vapp-record-top"><span class="vapp-status ' + attr(item.status) + '">' + escapeHTML(statusLabel(item.status)) + '</span><span>' + escapeHTML(formatTimestamp(item.updatedAt || item.createdAt)) + '</span></div><h3>' + escapeHTML(market ? market.short : item.marketId) + '</h3><p>' + escapeHTML(formatDate(item.date)) + ' · ' + escapeHTML(item.boothSize) + '</p><dl><div><dt>Place</dt><dd>' + escapeHTML(market ? market.venue : 'Market venue') + '</dd></div><div><dt>Estimate</dt><dd>' + (item.quoteNeeded ? 'Quote needed' : '$' + escapeHTML(item.estimatedFee == null ? '—' : item.estimatedFee)) + '</dd></div></dl>' +
      (item.notes ? '<p class="vapp-record-note">“' + escapeHTML(item.notes) + '”</p>' : '') +
      (active ? '<button class="vapp-text-button danger" type="button" data-cancel-reservation="' + attr(item.id) + '">Cancel request</button>' : '') + '</article>';
  }

  function bindReservations() {
    var form = runtime.root.querySelector('#vapp-reservation-form');
    if (!form) return;
    var boundScope = runtime.draftScope;
    var marketSelect = form.querySelector('[name="marketId"]');
    var notes = form.querySelector('[name="notes"]');

    function currentControl(element) {
      return !!runtime.snapshot && runtime.draftScope === boundScope && element && element.isConnected && runtime.root && runtime.root.contains(element);
    }

    function capture() {
      if (!currentControl(form)) return;
      var data = {
        marketId: marketSelect.value,
        boothSize: (form.querySelector('[name="boothSize"]:checked') || {}).value || '10x10',
        notes: notes.value.slice(0, 240)
      };
      writeDraft('reservation', data);
      var selected = occurrenceFor(data.marketId);
      var occurrence = form.querySelector('[data-reservation-occurrence]');
      var review = form.querySelector('[data-reservation-review]');
      if (occurrence) occurrence.innerHTML = occurrenceSummary(selected);
      if (review) review.innerHTML = reservationReview(selected, data.boothSize);
      var count = form.querySelector('[data-count-for="vapp-reservation-notes"]');
      if (count) count.textContent = data.notes.length + ' / 240';
    }

    form.addEventListener('input', capture);
    form.addEventListener('change', capture);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!currentControl(form)) return;
      var market = occurrenceFor(marketSelect.value);
      var boothSize = (form.querySelector('[name="boothSize"]:checked') || {}).value;
      if (!market || (boothSize !== '10x10' && boothSize !== '20x10')) {
        announce('Choose a market occurrence and booth footprint before saving.', 'error');
        (market ? form.querySelector('[name="boothSize"]') : marketSelect).focus();
        return;
      }
      var result = await mutate('reservation.request', {
        marketId: market.id,
        date: market.date,
        boothSize: boothSize,
        notes: notes.value.trim().slice(0, 240)
      }, event.submitter, 'Planning request saved to your account. It was not sent to the organizer; no booth was allocated and no charge was made.');
      if (result) { clearDraft('reservation'); renderCurrentSection(); }
    });

    runtime.root.querySelectorAll('[data-cancel-reservation]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (!await confirmAction('Cancel this planning request?', 'This removes the saved planning request from your active list. It does not affect any organizer reservation outside this site.', 'Cancel request', true)) return;
        if (!currentControl(button)) return;
        await mutate('reservation.cancel', { id: button.getAttribute('data-cancel-reservation') }, button, 'Planning request cancelled. No organizer booking was changed.');
      });
    });
  }

  function blankOffer() {
    return { id: '', title: '', type: '', value: '', description: '', startDate: '', endDate: '', marketIds: [], status: 'draft' };
  }

  function offersView() {
    var draft = Object.assign(blankOffer(), readDraft('offer') || {});
    draft.marketIds = Array.isArray(draft.marketIds) ? draft.marketIds : [];
    var offers = runtime.snapshot.offers.slice().sort(function (a, b) { return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)); });
    return pageHeader('02 / Offers', 'MAKE THE OFFER CLEAR', 'Build a date-limited reason to visit. Published offers are public only during their date window and while your profile is public.', '<button class="vapp-button ink" type="button" data-new-offer>New offer +</button>') +
      '<div class="vapp-work-grid offers-grid">' +
        '<form class="vapp-editor" id="vapp-offer-form" novalidate>' +
          '<input type="hidden" name="id" value="' + attr(draft.id || '') + '"><div class="vapp-editor-head green"><span>' + (draft.id ? 'EDIT OFFER' : 'NEW OFFER') + '</span><strong>' + (draft.id ? 'Change the saved record.' : 'Start with the value.') + '</strong></div>' +
          '<div class="vapp-field"><label for="vapp-offer-title">Offer title</label><input id="vapp-offer-title" name="title" maxlength="80" required value="' + attr(draft.title) + '" placeholder="Saturday bread bundle"></div>' +
          '<div class="vapp-two-fields"><div class="vapp-field"><label for="vapp-offer-type">Offer type</label><select id="vapp-offer-type" name="type" required><option value="">Choose one</option>' + [{ value: 'percentage', label: 'Percentage off' }, { value: 'amount', label: 'Dollar amount off' }, { value: 'bundle', label: 'Bundle' }, { value: 'free-item', label: 'Free item or sample' }, { value: 'market-special', label: 'Market-day special' }, { value: 'new-product', label: 'New product' }, { value: 'other', label: 'Other' }].map(function (item) { return '<option value="' + item.value + '"' + (draft.type === item.value ? ' selected' : '') + '>' + escapeHTML(item.label) + '</option>'; }).join('') + '</select></div><div class="vapp-field"><label for="vapp-offer-value">Offer value <span class="vapp-optional">Optional</span></label><input id="vapp-offer-value" name="value" maxlength="60" value="' + attr(draft.value || '') + '" placeholder="20% off, $5 off, or 2 for $12"></div></div>' +
          '<div class="vapp-field"><label for="vapp-offer-description">Shopper-facing details</label><textarea id="vapp-offer-description" name="description" maxlength="150" rows="4" required placeholder="What is included, any limits, and what the shopper should do.">' + escapeHTML(draft.description) + '</textarea><div class="vapp-count" data-count-for="vapp-offer-description">' + String(draft.description.length) + ' / 150</div></div>' +
          '<fieldset class="vapp-fieldset"><legend>Date limits</legend><div class="vapp-two-fields"><div class="vapp-field"><label for="vapp-offer-start">Starts</label><input id="vapp-offer-start" name="startDate" type="date" value="' + attr(draft.startDate) + '"></div><div class="vapp-field"><label for="vapp-offer-end">Ends</label><input id="vapp-offer-end" name="endDate" type="date" value="' + attr(draft.endDate) + '"></div></div><p class="vapp-fine">Published offers need both dates. They appear in the new directory only while in date.</p></fieldset>' +
          '<fieldset class="vapp-fieldset"><legend>Associated markets</legend><div class="vapp-check-grid">' + OCCURRENCES.map(function (item) { return '<label><input type="checkbox" name="marketIds" value="' + attr(item.id) + '"' + (draft.marketIds.indexOf(item.id) > -1 ? ' checked' : '') + '><span><strong>' + escapeHTML(item.short) + '</strong><small>' + escapeHTML(item.day) + '</small></span></label>'; }).join('') + '</div></fieldset>' +
          '<div class="vapp-offer-preview"><span>SHOPPER PREVIEW</span><strong data-offer-preview-title>' + escapeHTML(draft.title || 'Your offer title') + '</strong><p data-offer-preview-description>' + escapeHTML(draft.description || 'Clear, useful details will appear here.') + '</p></div>' +
          '<div class="vapp-form-actions split"><div><button class="vapp-button outline" type="submit" name="intent" value="draft">Save draft</button><button class="vapp-button primary" type="submit" name="intent" value="published">Publish offer</button></div><button class="vapp-text-button" type="button" data-clear-offer>Clear editor</button></div>' +
        '</form>' +
        '<section class="vapp-stack"><div class="vapp-section-bar"><div><span class="vapp-kicker">Offer shelf</span><h2>Saved offers</h2></div><span>' + offers.length + ' total</span></div>' +
          (offers.length ? offers.map(offerCard).join('') : emptyState('00', 'No saved offers', 'Save a draft first, then publish it when the details and dates are ready.', '')) +
        '</section>' +
      '</div>';
  }

  function offerCard(offer) {
    var markets = offer.marketIds.map(function (id) { var market = occurrenceFor(id); return market ? market.short : ''; }).filter(Boolean);
    var visibility = offerVisibility(offer, runtime.snapshot.profile);
    return '<article class="vapp-record offer-record' + (offer.status === 'archived' ? ' is-muted' : '') + '"><div class="vapp-record-top"><span class="vapp-status ' + attr(offer.status) + '">' + escapeHTML(statusLabel(offer.status)) + '</span><span>' + escapeHTML(formatTimestamp(offer.updatedAt || offer.createdAt)) + '</span></div><h3>' + escapeHTML(offer.title || 'Untitled offer') + '</h3><p>' + escapeHTML(offer.description || 'No shopper-facing details yet.') + '</p><div class="vapp-tag-row">' + markets.map(function (name) { return '<span>' + escapeHTML(name) + '</span>'; }).join('') + '</div><dl><div><dt>Date limit</dt><dd>' + escapeHTML(offer.startDate ? formatDate(offer.startDate, false) : 'Not set') + ' → ' + escapeHTML(offer.endDate ? formatDate(offer.endDate, false) : 'Not set') + '</dd></div></dl>' +
      (offer.status === 'published' ? '<p class="vapp-visibility' + (visibility.visible ? ' is-public' : '') + '"><strong>' + escapeHTML(visibility.label) + '</strong><span>' + escapeHTML(visibility.note) + '</span></p>' : '') +
      '<div class="vapp-record-actions"><button class="vapp-text-button" type="button" data-copy-offer="' + attr(offer.id) + '">Use as template</button><button class="vapp-text-button" type="button" data-extend-offer="' + attr(offer.id) + '">Extend one week</button><button class="vapp-text-button" type="button" data-edit-offer="' + attr(offer.id) + '">Edit</button>' + (offer.status !== 'archived' ? '<button class="vapp-text-button danger" type="button" data-archive-offer="' + attr(offer.id) + '">Archive</button>' : '') + '</div></article>';
  }

  function offerFromForm(form) {
    var checked = Array.from(form.querySelectorAll('[name="marketIds"]:checked')).map(function (input) { return input.value; });
    return {
      id: form.elements.id.value,
      title: form.elements.title.value.trim().slice(0, 80),
      type: form.elements.type.value.slice(0, 40),
      value: form.elements.value.value.trim().slice(0, 60),
      description: form.elements.description.value.trim().slice(0, 150),
      startDate: form.elements.startDate.value,
      endDate: form.elements.endDate.value,
      marketIds: checked,
      status: 'draft'
    };
  }

  function bindOffers() {
    var form = runtime.root.querySelector('#vapp-offer-form');
    if (!form) return;
    var boundScope = runtime.draftScope;
    function currentEditor() {
      return !!runtime.snapshot && runtime.draftScope === boundScope && form.isConnected && runtime.root && runtime.root.contains(form);
    }
    function capture() {
      if (!currentEditor()) return;
      var draft = offerFromForm(form);
      writeDraft('offer', draft);
      var title = form.querySelector('[data-offer-preview-title]');
      var description = form.querySelector('[data-offer-preview-description]');
      var count = form.querySelector('[data-count-for="vapp-offer-description"]');
      if (title) title.textContent = draft.title || 'Your offer title';
      if (description) description.textContent = draft.description || 'Clear, useful details will appear here.';
      if (count) count.textContent = draft.description.length + ' / 150';
    }
    form.addEventListener('input', capture);
    form.addEventListener('change', capture);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!currentEditor()) return;
      var offer = offerFromForm(form);
      var intent = event.submitter && event.submitter.value === 'published' ? 'published' : 'draft';
      if (!offer.title || !offer.type) {
        announce('Give the offer a clear title and choose its type before saving.', 'error');
        (offer.title ? form.elements.type : form.elements.title).focus();
        return;
      }
      if (offer.startDate && offer.endDate && offer.endDate < offer.startDate) {
        announce('The offer end date must be the same as or later than its start date.', 'error');
        form.elements.endDate.focus();
        return;
      }
      if (intent === 'published') {
        if (!offer.description || !offer.startDate || !offer.endDate || !offer.marketIds.length) {
          announce('Publishing needs shopper details, a start and end date, and at least one associated market.', 'error');
          return;
        }
        var publishMessage = runtime.snapshot.profile.published
          ? 'Publish this offer for anyone to see during its date window? Its title, value, details, dates, and selected markets will be public. You can archive it later.'
          : 'Mark this offer as published? Its title, value, details, dates, and selected markets will become public during its date window after you publish your business profile. You can archive it later.';
        if (!await confirmAction('Publish this offer?', publishMessage, 'Publish offer', false)) return;
        if (!currentEditor()) return;
      }
      offer.status = intent;
      if (!offer.id) delete offer.id;
      var successMessage = 'Offer draft saved to your account.';
      if (intent === 'published') {
        var projected = offerVisibility(offer, runtime.snapshot.profile);
        if (projected.visible) successMessage = 'Offer published and visible to anyone now.';
        else if (!runtime.snapshot.profile.published) successMessage = 'Offer saved as published. It can become public during its date window after you publish your business profile.';
        else if (todayInMarketTimezone() < offer.startDate) successMessage = 'Offer published. It will become public on its start date while your profile remains public.';
        else successMessage = 'Offer saved as published, but its public date window has ended. Update the dates to show it again.';
      }
      var result = await mutate('offer.save', offer, event.submitter, successMessage);
      if (result) { clearDraft('offer'); renderCurrentSection(); }
    });

    runtime.root.querySelectorAll('[data-edit-offer]').forEach(function (button) {
      button.addEventListener('click', function () {
        var offer = runtime.snapshot.offers.find(function (item) { return item.id === button.getAttribute('data-edit-offer'); });
        if (!offer) return;
        writeDraft('offer', offer);
        renderCurrentSection();
        var input = runtime.root.querySelector('#vapp-offer-title');
        if (input) input.focus();
      });
    });
    runtime.root.querySelectorAll('[data-copy-offer],[data-extend-offer]').forEach(function(button){button.addEventListener('click',function(){
      var offer=runtime.snapshot.offers.find(function(item){return item.id===(button.dataset.copyOffer||button.dataset.extendOffer);});if(!offer)return;
      var copy=JSON.parse(JSON.stringify(offer));if(button.dataset.copyOffer){copy.id='';copy.title=copy.title.slice(0,70)+' (copy)';copy.status='draft';}else{var date=new Date((copy.endDate||todayInMarketTimezone())+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+7);copy.endDate=date.toISOString().slice(0,10);copy.status='draft';}
      writeDraft('offer',copy);renderCurrentSection();announce('Template ready. Review dates and details before saving or publishing.');
    });});
    runtime.root.querySelectorAll('[data-archive-offer]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (!await confirmAction('Archive this offer?', 'The offer will stop appearing in the public directory. Its saved record will remain in your account as archived.', 'Archive offer', true)) return;
        if (!currentEditor() || !button.isConnected) return;
        await mutate('offer.archive', { id: button.getAttribute('data-archive-offer') }, button, 'Offer archived and removed from public display.');
      });
    });
    var clear = runtime.root.querySelector('[data-clear-offer]');
    if (clear) clear.addEventListener('click', function () { clearDraft('offer'); renderCurrentSection(); });
    var fresh = runtime.root.querySelector('[data-new-offer]');
    if (fresh) fresh.addEventListener('click', function () { clearDraft('offer'); renderCurrentSection(); runtime.root.querySelector('#vapp-offer-title').focus(); });
  }

  function profileView() {
    var server = runtime.snapshot.profile;
    var local = readDraft('profile');
    var draft = normaliseProfile(local || server);
    while (draft.categories.length < 3) draft.categories.push('');
    var restored = !!local;
    return pageHeader('03 / Profile', 'YOUR PUBLIC MARKET TABLE', 'Shape the information customers see in the directory. Nothing becomes public until you choose Publish profile.', '') +
      '<section class="vapp-public-notice"><strong>PUBLISHING IS PUBLIC</strong><p>Your business name, city, descriptions, categories, website, Instagram link, and profile photo become visible to anyone. Current offers marked Published appear with the profile. Reservations and promotions stay private. You can unpublish at any time.</p></section>' +
      (restored ? '<div class="vapp-draft-notice"><strong>UNFINISHED TAB EDIT RESTORED</strong><span>This private draft syncs to your account when online. Review it, then save or publish your profile.</span><button type="button" data-discard-profile>Discard tab edit</button></div>' : '') +
      '<div class="vapp-public-notice"><a href="#account/business">Add products, payment methods, pickup and access details →</a> · <a href="#account/documents">Manage documents and gallery photos →</a></div><div class="vapp-profile-grid">' +
        '<form class="vapp-editor" id="vapp-profile-form" novalidate data-server-published="' + String(server.published) + '">' +
          '<div class="vapp-editor-head mustard"><span>PROFILE EDITOR</span><strong>Useful beats clever.</strong></div>' +
          '<div class="vapp-two-fields"><div class="vapp-field"><label for="vapp-business-name">Business name</label><input id="vapp-business-name" name="businessName" maxlength="80" autocomplete="organization" required value="' + attr(draft.businessName) + '" placeholder="Your market business"></div><div class="vapp-field"><label for="vapp-city">Home city</label><input id="vapp-city" name="city" maxlength="80" autocomplete="address-level2" value="' + attr(draft.city) + '" placeholder="City, Texas"></div></div>' +
          '<div class="vapp-field"><label for="vapp-profile-short">Short description</label><textarea id="vapp-profile-short" name="shortDescription" maxlength="120" rows="3" required placeholder="One direct sentence about what shoppers will find.">' + escapeHTML(draft.shortDescription) + '</textarea><div class="vapp-count" data-count-for="vapp-profile-short">' + String(draft.shortDescription.length) + ' / 120</div></div>' +
          '<div class="vapp-field"><label for="vapp-profile-about">About the business</label><textarea id="vapp-profile-about" name="about" maxlength="350" rows="6" placeholder="Share the people, process, or purpose behind the products.">' + escapeHTML(draft.about) + '</textarea><div class="vapp-count" data-count-for="vapp-profile-about">' + String(draft.about.length) + ' / 350</div></div>' +
          '<fieldset class="vapp-fieldset"><legend>Product categories</legend><div class="vapp-three-fields">' + [0, 1, 2].map(function (index) { return '<div class="vapp-field"><label for="vapp-category-' + index + '">' + (index === 0 ? 'Primary' : 'Category ' + (index + 1)) + '</label><input id="vapp-category-' + index + '" name="category' + index + '" maxlength="50" value="' + attr(draft.categories[index]) + '" placeholder="' + (index === 0 ? 'Produce, baked goods…' : 'Optional') + '"></div>'; }).join('') + '</div></fieldset>' +
          '<fieldset class="vapp-fieldset"><legend>Website and social</legend><div class="vapp-two-fields">' +
            socialField('website', 'Website', draft.website, 'https://yourbusiness.com') + socialField('instagram', 'Instagram', draft.instagram, 'https://instagram.com/yourbusiness') +
          '</div></fieldset>' +
          '<fieldset class="vapp-fieldset"><legend>Profile photo</legend><div class="vapp-photo-control"><div class="vapp-photo-thumb" data-profile-thumb>' + profilePhoto(draft.photoData, draft.businessName) + '</div><div><label class="vapp-button outline small" for="vapp-profile-photo">Choose raster image</label><input class="vapp-visually-hidden" id="vapp-profile-photo" type="file" accept="image/png,image/jpeg,image/webp"><p>PNG, JPEG, or WebP · up to 25 MB. We resize it automatically.</p><button class="vapp-text-button danger" type="button" data-remove-profile-photo' + (draft.photoData ? '' : ' hidden') + '>Remove photo</button></div></div><input type="hidden" name="photoData" value="' + attr(draft.photoData) + '"></fieldset>' +
          '<div class="vapp-form-actions split"><div><button class="vapp-button outline" type="submit" name="intent" value="save">' + (server.published ? 'Save public changes' : 'Save private profile') + '</button><button class="vapp-button primary" type="submit" name="intent" value="' + (server.published ? 'unpublish' : 'publish') + '">' + (server.published ? 'Unpublish profile' : 'Publish profile') + '</button></div><p>' + (server.published ? 'Public now · saved changes update what customers see.' : 'Account only · not visible to customers.') + '</p></div>' +
        '</form>' +
        '<aside class="vapp-profile-preview-wrap"><div class="vapp-section-bar"><div><span class="vapp-kicker">Immediate preview</span><h2>What customers read</h2></div><span data-profile-visibility>' + (server.published ? (restored ? 'UNSAVED CHANGES · NOT LIVE' : 'PUBLIC NOW') : 'NOT PUBLIC') + '</span></div><div data-profile-preview>' + profilePreview(draft, server.published, restored) + '</div><p class="vapp-fine">This card uses only what you enter here. No information has been imported from the original vendor account.</p></aside>' +
      '</div>';
  }

  function socialField(name, label, value, placeholder) {
    return '<div class="vapp-field"><label for="vapp-' + name + '">' + label + '</label><input id="vapp-' + name + '" name="' + name + '" type="url" inputmode="url" maxlength="300" value="' + attr(value) + '" placeholder="' + attr(placeholder) + '"></div>';
  }

  function initials(name) {
    var parts = safeString(name).split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.length ? parts.map(function (part) { return part.charAt(0).toUpperCase(); }).join('') : 'YM';
  }

  function profilePhoto(photo, name) {
    return photo ? '<img src="' + attr(photo) + '" alt="">' : '<span aria-hidden="true">' + escapeHTML(initials(name)) + '</span>';
  }

  function profilePreview(profile, published, dirty) {
    var links = [
      ['Website', profile.website], ['Instagram', profile.instagram]
    ].filter(function (item) { return !!safeWebUrl(item[1]); });
    var badge = published ? (dirty ? 'PUBLIC PROFILE · THESE CHANGES ARE NOT LIVE' : 'PUBLIC DIRECTORY PROFILE') : 'PRIVATE EDITOR PREVIEW';
    return '<article class="vapp-directory-card"><div class="vapp-directory-image">' + profilePhoto(profile.photoData, profile.businessName) + '<span>' + badge + '</span></div><div class="vapp-directory-body"><p class="vapp-directory-city">' + escapeHTML(profile.city || 'Your city') + '</p><h3>' + escapeHTML(profile.businessName || 'Your business name') + '</h3><div class="vapp-tag-row">' + profile.categories.filter(Boolean).map(function (category) { return '<span>' + escapeHTML(category) + '</span>'; }).join('') + '</div><p class="vapp-directory-short">' + escapeHTML(profile.shortDescription || 'A direct description will tell shoppers what they will find at your table.') + '</p>' + (profile.about ? '<p>' + escapeHTML(profile.about) + '</p>' : '') + '<div class="vapp-directory-links">' + links.map(function (item) { return '<a href="' + attr(item[1]) + '" target="_blank" rel="noopener">' + escapeHTML(item[0]) + ' ↗</a>'; }).join('') + '</div></div></article>';
  }

  function profileFromForm(form) {
    return normaliseProfile({
      businessName: form.elements.businessName.value,
      city: form.elements.city.value,
      shortDescription: form.elements.shortDescription.value,
      about: form.elements.about.value,
      categories: [form.elements.category0.value, form.elements.category1.value, form.elements.category2.value],
      website: form.elements.website.value,
      instagram: form.elements.instagram.value,
      photoData: form.elements.photoData.value,
      published: form.dataset.serverPublished === 'true'
    });
  }

  function bindProfile() {
    var form = runtime.root.querySelector('#vapp-profile-form');
    if (!form) return;
    var boundScope = runtime.draftScope;
    function currentEditor() {
      return !!runtime.snapshot && runtime.draftScope === boundScope && form.isConnected && runtime.root && runtime.root.contains(form);
    }
    function capture() {
      if (!currentEditor()) return;
      var draft = profileFromForm(form);
      writeDraft('profile', draft);
      var preview = runtime.root.querySelector('[data-profile-preview]');
      if (preview) preview.innerHTML = profilePreview(draft, form.dataset.serverPublished === 'true', true);
      var visibility = runtime.root.querySelector('[data-profile-visibility]');
      if (visibility) visibility.textContent = form.dataset.serverPublished === 'true' ? 'UNSAVED CHANGES · NOT LIVE' : 'NOT PUBLIC';
      [['shortDescription', 'vapp-profile-short', 120], ['about', 'vapp-profile-about', 350]].forEach(function (item) {
        var counter = form.querySelector('[data-count-for="' + item[1] + '"]');
        if (counter) counter.textContent = draft[item[0]].length + ' / ' + item[2];
      });
    }
    form.addEventListener('input', function (event) { if (event.target.type !== 'file') capture(); });
    form.addEventListener('change', function (event) { if (event.target.type !== 'file') capture(); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!currentEditor()) return;
      var profile = profileFromForm(form);
      var intent = event.submitter ? event.submitter.value : 'save';
      var willBePublished = intent === 'publish' || (intent === 'save' && form.dataset.serverPublished === 'true');
      if (willBePublished && !profile.businessName) {
        announce('A public profile needs a business name.', 'error');
        form.elements.businessName.focus();
        return;
      }
      if (willBePublished && (!profile.shortDescription || !profile.categories.filter(Boolean).length)) {
        announce('A public profile needs a short description and at least one product category.', 'error');
        return;
      }
      var categoryKeys = profile.categories.map(function (item) { return item.toLocaleLowerCase(); });
      if (new Set(categoryKeys).size !== categoryKeys.length) {
        announce('Use each product category only once.', 'error');
        form.elements.category0.focus();
        return;
      }
      var invalidUrl = ['website', 'instagram'].find(function (name) {
        return form.elements[name].value.trim() && !safeWebUrl(form.elements[name].value);
      });
      if (invalidUrl) {
        announce('Enter a complete http:// or https:// address for ' + invalidUrl + '.', 'error');
        form.elements[invalidUrl].focus();
        return;
      }
      if (intent === 'publish' && !await confirmAction('Publish this profile?', 'Customers will see the business name, city, descriptions, categories, website, Instagram link, and profile photo. Current offers marked Published can also appear. You can unpublish at any time.', 'Publish profile', false)) return;
      if (intent === 'unpublish' && !await confirmAction('Unpublish this profile?', 'The profile and its offers will stop appearing to customers. Your saved records will remain in your account.', 'Unpublish profile', true)) return;
      if (!currentEditor()) return;
      profile.published = willBePublished;
      var profileMessage = intent === 'unpublish'
        ? 'Profile unpublished. It and its offers are no longer customer-visible.'
        : (profile.published ? 'Public profile changes saved. Customers can see the updated information.' : 'Private profile saved to your account.');
      var result = await mutate('profile.save', profile, event.submitter, profileMessage);
      if (result) { clearDraft('profile'); renderCurrentSection(); }
    });

    var photoInput = form.querySelector('#vapp-profile-photo');
    photoInput.addEventListener('change', async function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file) return;
      if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) === -1) {
        photoInput.value = '';
        announce('Choose a PNG, JPEG, or WebP raster image.', 'error');
        return;
      }
      try {
        announce('Preparing your photo…');
        var value=await window.FSMComfort.resizePhoto(file);
        if(!currentEditor())return;
        form.elements.photoData.value=value;
        var thumb=form.querySelector('[data-profile-thumb]');if(thumb)thumb.innerHTML=profilePhoto(value,form.elements.businessName.value);
        var remove=form.querySelector('[data-remove-profile-photo]');if(remove)remove.hidden=false;
        capture();announce('Photo resized. Review the preview, then save or publish your profile.');
      }catch(error){photoInput.value='';if(currentEditor())announce(error.message||'This photo could not be processed.','error');}
    });
    var removePhoto = form.querySelector('[data-remove-profile-photo]');
    if (removePhoto) removePhoto.addEventListener('click', function () {
      form.elements.photoData.value = '';
      photoInput.value = '';
      var thumb = form.querySelector('[data-profile-thumb]');
      if (thumb) thumb.innerHTML = profilePhoto('', form.elements.businessName.value);
      removePhoto.hidden = true;
      capture();
    });
    var discard = runtime.root.querySelector('[data-discard-profile]');
    if (discard) discard.addEventListener('click', function () { clearDraft('profile'); renderCurrentSection(); });
  }

  function blankPromotion() {
    return { id: '', title: '', marketId: '', reservationId: '', offerId: '', format: 'square', headline: '', caption: '' };
  }

  function promotionsView() {
    var draft = Object.assign(blankPromotion(), readDraft('promotion') || {});
    var reservations = runtime.snapshot.reservations.filter(function (item) { return item.status === 'requested'; });
    var offers = runtime.snapshot.offers.filter(function (item) { return item.status !== 'archived'; });
    var draftReservation = reservations.find(function (item) { return item.id === draft.reservationId; });
    var draftMarketId = draftReservation ? draftReservation.marketId : '';
    var promotions = runtime.snapshot.promotions.slice().sort(function (a, b) { return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)); });
    return pageHeader('04 / Promotions', 'MAKE SOME MARKET NOISE', 'Compose a caption and export a post-ready PNG tied to a saved planning request. Saving here does not post to social media.', '') +
      '<div class="vapp-promo-grid">' +
        '<form class="vapp-editor" id="vapp-promotion-form" novalidate><input type="hidden" name="id" value="' + attr(draft.id) + '">' +
          '<div class="vapp-editor-head tomato"><span>PROMOTION COMPOSER</span><strong>One date. One clear reason.</strong></div>' +
          (reservations.length ? '' : '<div class="vapp-inline-warning"><strong>A planning date comes first.</strong><p>Save a planning request before building market-specific creative. The request does not confirm attendance.</p><a href="#workspace/reservations">Plan a date →</a></div>') +
          '<div class="vapp-field"><label for="vapp-promo-title">Internal campaign name</label><input id="vapp-promo-title" name="title" maxlength="80" value="' + attr(draft.title) + '" placeholder="November Richardson announcement"></div>' +
          '<div class="vapp-two-fields"><div class="vapp-field"><label for="vapp-promo-reservation">Reservation request</label><select id="vapp-promo-reservation" name="reservationId" required><option value="">Choose a requested date</option>' + reservations.map(function (item) { var market = occurrenceFor(item.marketId, item.date); return '<option value="' + attr(item.id) + '"' + (item.id === draft.reservationId ? ' selected' : '') + '>' + escapeHTML((market ? market.short : item.marketId) + ' — ' + formatDate(item.date, false)) + '</option>'; }).join('') + '</select></div><div class="vapp-field"><label for="vapp-promo-offer">Featured offer <span class="vapp-optional">Optional</span></label><select id="vapp-promo-offer" name="offerId"><option value="">No featured offer</option>' + offers.map(function (offer) { var incompatible = draftMarketId && offer.marketIds.indexOf(draftMarketId) === -1; return '<option value="' + attr(offer.id) + '" data-markets="' + attr(offer.marketIds.join(',')) + '"' + (offer.id === draft.offerId ? ' selected' : '') + (incompatible ? ' disabled' : '') + '>' + escapeHTML(offer.title || 'Untitled offer') + ' (' + escapeHTML(incompatible ? 'not for this market' : offer.status) + ')</option>'; }).join('') + '</select></div></div>' +
          '<fieldset class="vapp-fieldset"><legend>Canvas format</legend><div class="vapp-choice-grid"><label class="vapp-choice"><input type="radio" name="format" value="square"' + (draft.format !== 'story' ? ' checked' : '') + '><span><strong>SQUARE</strong><small>1080 × 1080 PNG</small></span></label><label class="vapp-choice"><input type="radio" name="format" value="story"' + (draft.format === 'story' ? ' checked' : '') + '><span><strong>STORY</strong><small>1080 × 1920 PNG</small></span></label></div></fieldset>' +
          '<div class="vapp-field"><label for="vapp-promo-headline">Graphic headline</label><input id="vapp-promo-headline" name="headline" maxlength="80" value="' + attr(draft.headline) + '" placeholder="Market day plan"></div>' +
          '<div class="vapp-field"><div class="vapp-label-line"><label for="vapp-promo-caption">Social caption</label><button class="vapp-text-button" type="button" data-generate-caption>Draft from selections</button></div><textarea id="vapp-promo-caption" name="caption" maxlength="600" rows="8" placeholder="Tell customers where, when, and why to visit.">' + escapeHTML(draft.caption) + '</textarea><div class="vapp-count" data-count-for="vapp-promo-caption">' + String(draft.caption.length) + ' / 600</div></div>' +
          '<div class="vapp-form-actions split"><div><button class="vapp-button primary" type="submit"' + (reservations.length ? '' : ' disabled') + '>Save campaign</button><button class="vapp-button outline" type="button" data-copy-caption>Copy caption</button></div><button class="vapp-text-button" type="button" data-clear-promotion>Clear editor</button></div>' +
        '</form>' +
        '<aside class="vapp-canvas-column"><div class="vapp-canvas-head"><div><span class="vapp-kicker">Live artwork</span><h2>PNG preview</h2></div><button class="vapp-button ink small" type="button" data-download-png>Download PNG ↓</button></div><div class="vapp-canvas-wrap"><canvas id="vapp-promo-canvas" width="1080" height="1080" role="img" aria-label="Promotion graphic preview"></canvas></div><p class="vapp-fine">Uses the saved profile photo when one is available. Export stays on this device until you choose where to share it.</p></aside>' +
      '</div>' +
      '<section class="vapp-campaign-shelf"><div class="vapp-section-bar"><div><span class="vapp-kicker">Campaign shelf</span><h2>Saved compositions</h2></div><span>' + promotions.length + ' total</span></div><div class="vapp-campaign-grid">' +
        (promotions.length ? promotions.map(promotionCard).join('') : emptyState('00', 'No saved campaigns', 'Tie a composition to a requested date, then save it here for later edits and export.', '')) +
      '</div></section>';
  }

  function promotionCard(promotion) {
    var reservation = runtime.snapshot.reservations.find(function (item) { return item.id === promotion.reservationId; });
    var market = reservation ? occurrenceFor(reservation.marketId, reservation.date) : null;
    var offer = runtime.snapshot.offers.find(function (item) { return item.id === promotion.offerId; });
    return '<article class="vapp-campaign-card"><span>' + escapeHTML(promotion.format.toUpperCase()) + '</span><h3>' + escapeHTML(promotion.title || 'Untitled campaign') + '</h3><p>' + escapeHTML(market ? market.short + ' · ' + formatDate(reservation.date, false) : 'Reservation unavailable') + '</p>' + (offer ? '<strong>FEATURES: ' + escapeHTML(offer.title) + '</strong>' : '') + '<div><button class="vapp-text-button" type="button" data-edit-promotion="' + attr(promotion.id) + '">Open</button><button class="vapp-text-button danger" type="button" data-delete-promotion="' + attr(promotion.id) + '">Delete</button></div></article>';
  }

  function promotionFromForm(form) {
    var reservation = runtime.snapshot.reservations.find(function (item) { return item.id === form.elements.reservationId.value; });
    return {
      id: form.elements.id.value,
      title: form.elements.title.value.trim().slice(0, 80),
      marketId: reservation ? reservation.marketId : '',
      reservationId: form.elements.reservationId.value,
      offerId: form.elements.offerId.value,
      format: (form.querySelector('[name="format"]:checked') || {}).value === 'story' ? 'story' : 'square',
      headline: form.elements.headline.value.trim().slice(0, 80),
      caption: form.elements.caption.value.trim().slice(0, 600)
    };
  }

  function generatedCaption(data) {
    var reservation = runtime.snapshot.reservations.find(function (item) { return item.id === data.reservationId; });
    if (!reservation) return '';
    var market = occurrenceFor(reservation.marketId, reservation.date);
    var offer = runtime.snapshot.offers.find(function (item) { return item.id === data.offerId; });
    var business = runtime.snapshot.profile.businessName || 'We';
    var lines = ['DRAFT · Attendance is not confirmed.', business + ' is planning for ' + (market ? market.short : 'the market') + ' on ' + formatDate(reservation.date, true) + (market ? ' from ' + market.hours + '.' : '.')];
    if (offer) lines.push(offer.title + (offer.value ? ' — ' + offer.value : '') + (offer.description ? ': ' + offer.description : '.'));
    lines.push('If the booking is confirmed, come say hello and shop local.');
    if (market) lines.push(market.venue + ', ' + market.city + '.');
    return lines.join('\n\n').slice(0, 600);
  }

  function bindPromotions() {
    var form = runtime.root.querySelector('#vapp-promotion-form');
    if (!form) return;
    var boundScope = runtime.draftScope;
    function currentEditor() {
      return !!runtime.snapshot && runtime.draftScope === boundScope && form.isConnected && runtime.root && runtime.root.contains(form);
    }
    function capture() {
      if (!currentEditor()) return;
      var data = promotionFromForm(form);
      writeDraft('promotion', data);
      var count = form.querySelector('[data-count-for="vapp-promo-caption"]');
      if (count) count.textContent = data.caption.length + ' / 600';
      drawPromotion(data);
    }
    form.addEventListener('input', capture);
    form.addEventListener('change', capture);
    form.elements.reservationId.addEventListener('change', function () {
      var reservation = runtime.snapshot.reservations.find(function (item) { return item.id === form.elements.reservationId.value; });
      var marketId = reservation ? reservation.marketId : '';
      var cleared = false;
      Array.from(form.elements.offerId.options).forEach(function (option) {
        if (!option.value) return;
        var markets = (option.dataset.markets || '').split(',').filter(Boolean);
        option.disabled = !!marketId && markets.indexOf(marketId) === -1;
        if (option.disabled && option.selected) cleared = true;
      });
      if (cleared) {
        form.elements.offerId.value = '';
        announce('The previous offer is not associated with this market, so it was removed from the campaign.', 'error');
      }
      capture();
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!currentEditor()) return;
      var promotion = promotionFromForm(form);
      if (!promotion.reservationId) {
        announce('Choose a saved requested date before saving the campaign.', 'error');
        form.elements.reservationId.focus();
        return;
      }
      if (!promotion.title || !promotion.headline || !promotion.caption) {
        announce('Add an internal name, graphic headline, and caption before saving.', 'error');
        return;
      }
      var featuredOffer = runtime.snapshot.offers.find(function (item) { return item.id === promotion.offerId; });
      if (featuredOffer && featuredOffer.marketIds.indexOf(promotion.marketId) === -1) {
        announce('Choose an offer associated with the selected reservation market.', 'error');
        form.elements.offerId.focus();
        return;
      }
      if (!promotion.id) delete promotion.id;
      var result = await mutate('promotion.save', promotion, event.submitter, 'Campaign saved. It has not been posted to any social network.');
      if (result) { clearDraft('promotion'); renderCurrentSection(); }
    });
    var generate = form.querySelector('[data-generate-caption]');
    generate.addEventListener('click', function () {
      var caption = generatedCaption(promotionFromForm(form));
      if (!caption) {
        announce('Choose a requested date before drafting the caption.', 'error');
        form.elements.reservationId.focus();
        return;
      }
      form.elements.caption.value = caption;
      if (!form.elements.headline.value.trim()) form.elements.headline.value = 'MARKET DAY PLAN';
      if (!form.elements.title.value.trim()) {
        var reservation = runtime.snapshot.reservations.find(function (item) { return item.id === form.elements.reservationId.value; });
        var market = reservation ? occurrenceFor(reservation.marketId, reservation.date) : null;
        form.elements.title.value = (market ? market.short : 'Market') + ' announcement';
      }
      capture();
    });
    var copy = form.querySelector('[data-copy-caption]');
    copy.addEventListener('click', async function () {
      var text = form.elements.caption.value.trim();
      if (!text) { announce('Write or generate a caption first.', 'error'); return; }
      try {
        await navigator.clipboard.writeText(text);
        if (!currentEditor()) return;
        announce('Caption copied to the clipboard.', 'success');
      } catch (_error) {
        if (!currentEditor()) return;
        form.elements.caption.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (_copyError) { copied = false; }
        announce(copied ? 'Caption copied to the clipboard.' : 'Clipboard access was unavailable. The caption is selected for manual copying.', copied ? 'success' : 'error');
      }
    });
    var download = runtime.root.querySelector('[data-download-png]');
    download.addEventListener('click', function () {
      var canvas = runtime.root.querySelector('#vapp-promo-canvas');
      if (!canvas) return;
      try {
        var data = promotionFromForm(form);
        var base = (data.title || 'market-promotion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'market-promotion';
        canvas.toBlob(function (blob) {
          if (!currentEditor() || !canvas.isConnected) return;
          if (!blob) {
            announce('The PNG could not be prepared in this browser.', 'error');
            return;
          }
          var objectUrl = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.download = base + '-' + data.format + '.png';
          link.href = objectUrl;
          link.hidden = true;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1500);
          announce('PNG download started.', 'success');
        }, 'image/png');
      } catch (_error) {
        announce('The PNG download could not be started in this browser.', 'error');
      }
    });
    var clear = form.querySelector('[data-clear-promotion]');
    clear.addEventListener('click', function () { clearDraft('promotion'); renderCurrentSection(); });
    runtime.root.querySelectorAll('[data-edit-promotion]').forEach(function (button) {
      button.addEventListener('click', function () {
        var promotion = runtime.snapshot.promotions.find(function (item) { return item.id === button.getAttribute('data-edit-promotion'); });
        if (!promotion) return;
        writeDraft('promotion', promotion);
        renderCurrentSection();
        runtime.root.querySelector('#vapp-promo-title').focus();
      });
    });
    runtime.root.querySelectorAll('[data-delete-promotion]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (!await confirmAction('Delete this saved campaign?', 'The saved composition will be removed from your account. Any PNG already exported will stay on your device.', 'Delete campaign', true)) return;
        if (!currentEditor() || !button.isConnected) return;
        await mutate('promotion.delete', { id: button.getAttribute('data-delete-promotion') }, button, 'Saved campaign deleted.');
      });
    });
    drawPromotion(promotionFromForm(form));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (currentEditor()) drawPromotion(promotionFromForm(form)); });
  }

  function drawPromotion(data) {
    var canvas = runtime.root && runtime.root.querySelector('#vapp-promo-canvas');
    if (!canvas) return;
    var width = 1080;
    var height = data.format === 'story' ? 1920 : 1080;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    var profile = runtime.snapshot.profile;
    var photo = safePhoto(profile.photoData);
    if (!photo) {
      paintPoster(canvas, data, null);
      return;
    }
    if (runtime.promoImage && runtime.promoImage.src === photo && runtime.promoImage.complete) {
      paintPoster(canvas, data, runtime.promoImage);
      return;
    }
    paintPoster(canvas, data, null);
    var image = new Image();
    runtime.promoImage = image;
    image.onload = function () { if (runtime.root && runtime.promoImage === image) paintPoster(canvas, data, image); };
    image.onerror = function () { if (runtime.promoImage === image) runtime.promoImage = null; };
    image.src = photo;
  }

  function paintPoster(canvas, data, photo) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    var isStory = h > w;
    var reservation = runtime.snapshot.reservations.find(function (item) { return item.id === data.reservationId; });
    var market = reservation ? occurrenceFor(reservation.marketId, reservation.date) : null;
    var offer = runtime.snapshot.offers.find(function (item) { return item.id === data.offerId; });
    var business = runtime.snapshot.profile.businessName || 'YOUR BUSINESS';
    var headline = (data.headline || 'MARKET DAY PLAN').toUpperCase();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = COLORS.green;
    ctx.fillRect(0, 0, w, isStory ? 220 : 170);
    ctx.fillStyle = COLORS.mustard;
    ctx.fillRect(0, isStory ? 220 : 170, w, isStory ? 24 : 18);
    ctx.fillStyle = COLORS.tomato;
    ctx.fillRect(w - (isStory ? 190 : 150), 0, isStory ? 190 : 150, isStory ? 220 : 170);

    ctx.fillStyle = COLORS.paper;
    ctx.font = '700 42px "DM Sans", Arial, sans-serif';
    var businessText = business.toUpperCase();
    var businessWidth = w - (isStory ? 280 : 240);
    var businessFont = Math.max(24, Math.min(42, 42 * businessWidth / Math.max(1, ctx.measureText(businessText).width)));
    ctx.font = '700 ' + businessFont + 'px \"DM Sans\", Arial, sans-serif';
    drawWrapped(ctx, businessText, 62, isStory ? 82 : 62, businessWidth, 32, 2);
    ctx.font = '600 25px "DM Sans", Arial, sans-serif';
    ctx.fillText('FOUR SEASONS MARKET DAY', 64, isStory ? 152 : 120);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.paper;
    ctx.font = '800 27px "Barlow Condensed", "Arial Narrow", sans-serif';
    ['SHOP', 'MEET', 'REPEAT'].forEach(function (word, index) {
      ctx.fillText(word, w - (isStory ? 95 : 75), (isStory ? 77 : 52) + index * 34);
    });
    ctx.restore();

    var headlineY = isStory ? 360 : 280;
    ctx.fillStyle = COLORS.ink;
    ctx.font = '800 ' + (isStory ? '126' : '105') + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    drawWrapped(ctx, headline, 62, headlineY, w - 124, isStory ? 118 : 98, isStory ? 4 : 3);

    var featureTop = isStory ? 810 : 585;
    var featureHeight = isStory ? 560 : 320;
    if (photo) {
      drawCoverImage(ctx, photo, 62, featureTop, w - 124, featureHeight);
      ctx.fillStyle = 'rgba(23,61,45,.76)';
      ctx.fillRect(62, featureTop, w - 124, featureHeight);
    } else {
      ctx.fillStyle = COLORS.mustard;
      ctx.fillRect(62, featureTop, w - 124, featureHeight);
      ctx.fillStyle = COLORS.ink;
      for (var stripe = -featureHeight; stripe < w; stripe += 54) {
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.translate(stripe, featureTop);
        ctx.rotate(-Math.PI / 4);
        ctx.fillRect(0, 0, 17, featureHeight * 2);
        ctx.restore();
      }
    }

    ctx.fillStyle = photo ? COLORS.paper : COLORS.green;
    ctx.font = '800 ' + (isStory ? '74' : '60') + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText((market ? market.short : 'CHOOSE A MARKET').toUpperCase(), 102, featureTop + (isStory ? 105 : 83));
    ctx.font = '600 ' + (isStory ? '34' : '28') + 'px "DM Sans", Arial, sans-serif';
    var dateLine = reservation ? formatDate(reservation.date, true).toUpperCase() + (market ? ' · ' + market.hours : '') : 'REQUEST A DATE TO COMPLETE THIS CARD';
    ctx.fillText(dateLine, 102, featureTop + (isStory ? 165 : 132));
    if (market) {
      ctx.font = '500 ' + (isStory ? '29' : '24') + 'px "DM Sans", Arial, sans-serif';
      drawWrapped(ctx, market.venue + ' · ' + market.city, 102, featureTop + (isStory ? 220 : 175), w - 204, isStory ? 42 : 34, 2);
    }
    if (offer) {
      var boxY = featureTop + featureHeight - (isStory ? 190 : 120);
      ctx.fillStyle = COLORS.tomato;
      ctx.fillRect(102, boxY, w - 204, isStory ? 130 : 78);
      ctx.fillStyle = COLORS.paper;
      ctx.font = '800 ' + (isStory ? '42' : '32') + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
      drawWrapped(ctx, (offer.title + (offer.value ? ' · ' + offer.value : '')).toUpperCase(), 128, boxY + (isStory ? 52 : 31), w - 256, isStory ? 43 : 34, 2);
    }

    var footerY = isStory ? 1540 : 965;
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 ' + (isStory ? '29' : '22') + 'px "DM Sans", Arial, sans-serif';
    ctx.fillText('LOCAL FOOD · LOCAL GOODS · PEOPLE YOU CAN MEET', 62, footerY);
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(62, footerY + (isStory ? 55 : 35), w - 124, isStory ? 8 : 6);
    if (isStory) {
      ctx.fillStyle = COLORS.ink;
      ctx.font = '800 62px "Barlow Condensed", "Arial Narrow", sans-serif';
      ctx.fillText('COME SAY HELLO.', 62, footerY + 165);
      ctx.font = '500 28px "DM Sans", Arial, sans-serif';
      drawWrapped(ctx, (data.caption || 'Save the date and come shop local.').replace(/\s+/g, ' '), 62, footerY + 225, w - 124, 42, 3);
    }
    ctx.fillStyle = COLORS.mustard;
    ctx.fillRect(16, h - 72, w - 32, 56);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.font = '800 24px "DM Sans", Arial, sans-serif';
    ctx.fillText('DRAFT · ATTENDANCE NOT CONFIRMED', w / 2, h - 35);
    ctx.textAlign = 'left';
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 12;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    canvas.setAttribute('aria-label', headline + (market ? ', ' + market.short + ', ' + formatDate(reservation.date, true) : ', market promotion preview'));
  }

  function drawCoverImage(ctx, image, x, y, width, height) {
    var imageRatio = image.width / image.height;
    var boxRatio = width / height;
    var sx = 0;
    var sy = 0;
    var sw = image.width;
    var sh = image.height;
    if (imageRatio > boxRatio) {
      sw = image.height * boxRatio;
      sx = (image.width - sw) / 2;
    } else {
      sh = image.width / boxRatio;
      sy = (image.height - sh) / 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  }

  function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    lines = lines.slice(0, maxLines);
    if (lines.length === maxLines && words.length && ctx.measureText(lines[lines.length - 1]).width > maxWidth) {
      while (lines[lines.length - 1].length && ctx.measureText(lines[lines.length - 1] + '…').width > maxWidth) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
      lines[lines.length - 1] += '…';
    }
    lines.forEach(function (value, index) { ctx.fillText(value, x, y + index * lineHeight); });
    return y + lines.length * lineHeight;
  }

  function bindAuthStateListener() {
    if (runtime.authListenerBound || !window.FSMAuth || typeof window.FSMAuth.onChange !== 'function') return;
    runtime.authListenerBound = true;
    window.FSMAuth.onChange(function (authState) {
      var nextKey = authState.user && authState.user.userKey ? authState.user.userKey : '';
      var changedUser = !!runtime.authUserKey && runtime.authUserKey !== nextKey;
      if (changedUser) {
        invalidatePendingRequest();
        runtime.busy = false;
        clearWorkspaceMemory(true);
        concealWorkspace();
      }
      runtime.authUserKey = nextKey;
      if (!runtime.root || !document.documentElement.contains(runtime.root)) return;
      if (authState.phase === 'authenticated') {
        if (!runtime.snapshot && !runtime.loading && !runtime.busy) loadWorkspace(true);
        return;
      }
      if (authState.phase === 'loading') {
        concealWorkspace();
        updateAccountUI('checking');
        return;
      }
      if (runtime.snapshot || runtime.loading) {
        invalidatePendingRequest();
        runtime.busy = false;
      }
      clearWorkspaceMemory(changedUser || authState.phase === 'signed-out');
      renderAuthGate(authState);
    });
  }

  async function initVendorApp(section) {
    runtime.section = section === 'plans' ? 'reservations' : VALID_SECTIONS.indexOf(section) > -1 ? section : 'overview';
    runtime.root = document.querySelector('[data-vendor-app]');
    if (!runtime.root) return;
    bindAuthStateListener();
    bindDraftSafetyActions();
    await loadWorkspace(true);
  }

  function revalidateWorkspaceSession(immediate) {
    window.clearTimeout(runtime.revalidationTimer);
    var run = function () {
      var root = document.querySelector('[data-vendor-app]');
      if (!root) return;
      if (runtime.busy) {
        runtime.revalidateAfterBusy = true;
        return;
      }
      if (runtime.loading) invalidatePendingRequest();
      runtime.root = root;
      loadWorkspace(true);
    };
    if (immediate) run();
    else runtime.revalidationTimer = window.setTimeout(run, 120);
  }

  window.addEventListener('focus', function () { revalidateWorkspaceSession(false); });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) revalidateWorkspaceSession(true);
  });
  window.addEventListener('pagehide', function () {
    window.clearTimeout(runtime.revalidationTimer);
    invalidatePendingRequest();
    runtime.busy = false;
    clearWorkspaceMemory(false);
    concealWorkspace();
    updateAccountUI('checking');
  });

  window.addEventListener('fsm:drafts-resolved', function (event) {
    var detail = event && event.detail ? event.detail : {};
    if (!runtime.snapshot || detail.scope !== runtime.draftScope || detail.userKey !== runtime.authUserKey) return;
    renderCurrentSection();
    window.FSMComfort?.paint();
  });

  window.renderVendorApp = renderVendorApp;
  window.initVendorApp = initVendorApp;
})();
