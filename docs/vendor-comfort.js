(function () {
  'use strict';

  var DRAFT_KEYS = ['profile', 'offer', 'reservation', 'promotion', 'application'];
  var DRAFT_PREFIX = 'fsm-vendor-session-draft-v1:';
  var META_PREFIX = 'fsm-vendor-session-draft-meta-v1:';
  var RETRY_DELAYS = [1500, 3000, 6000, 12000, 30000];
  var scope = '';
  var userKey = '';
  var values = {};
  var versions = {};
  var dirty = {};
  var conflicts = {};
  var timers = {};
  var retryCounts = {};
  var inFlight = {};
  var controllers = new Set();
  var loading = null;
  var lastSaved = 0;

  function owns(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function validKey(key) { return DRAFT_KEYS.indexOf(key) >= 0; }
  function dataStorageKey(accountScope, key) { return DRAFT_PREFIX + accountScope + ':' + key; }
  function metaStorageKey(accountScope, key) { return META_PREFIX + accountScope + ':' + key; }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce(function (result, key) { result[key] = stableValue(value[key]); return result; }, {});
    }
    return value;
  }
  function serialized(value) { return JSON.stringify(stableValue(value)); }
  function equal(left, right) { return serialized(left) === serialized(right); }

  function status(message, kind) {
    document.querySelectorAll('[data-sync-status]').forEach(function (element) {
      element.textContent = message;
      element.dataset.kind = kind || '';
    });
  }
  function setConflictActions(visible) {
    document.querySelectorAll('[data-use-cloud-drafts], [data-keep-local-drafts]').forEach(function (button) { button.hidden = !visible; });
  }
  function hasUnsynced() {
    return Object.keys(dirty).length > 0 || Object.keys(conflicts).length > 0 || Object.keys(inFlight).some(function (key) { return inFlight[key]; });
  }
  function paint() {
    var dirtyCount = Object.keys(dirty).length;
    var conflictCount = Object.keys(conflicts).length;
    setConflictActions(conflictCount > 0);
    if (conflictCount) return status('Device and cloud drafts differ — download a copy, then choose which one to keep.', 'error');
    if (!navigator.onLine && dirtyCount) return status('Offline — unfinished edits are kept in this tab for this account.', 'error');
    if (Object.keys(inFlight).some(function (key) { return inFlight[key]; }) || Object.keys(timers).length) return status('Saving draft…', '');
    if (dirtyCount) return status('Draft not synced — your edits remain in this tab. Reconnect or use Retry.', 'error');
    status(lastSaved ? 'Draft saved to your account · ' + new Date(lastSaved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Draft autosave ready', '');
  }

  function clearTimer(key) {
    if (timers[key]) window.clearTimeout(timers[key]);
    delete timers[key];
  }
  function reset() {
    Object.keys(timers).forEach(clearTimer);
    controllers.forEach(function (controller) { controller.abort(); });
    controllers.clear();
    scope = ''; userKey = ''; values = {}; versions = {}; dirty = {}; conflicts = {};
    timers = {}; retryCounts = {}; inFlight = {}; loading = null; lastSaved = 0;
    setConflictActions(false);
  }
  function currentUserKey() {
    var state = window.FSMAuth && typeof window.FSMAuth.getState === 'function' ? window.FSMAuth.getState() : null;
    return state && state.user && state.user.userKey ? state.user.userKey : '';
  }
  function same(accountScope, accountUserKey) {
    return !!accountScope && !!accountUserKey && scope === accountScope && userKey === accountUserKey && currentUserKey() === accountUserKey;
  }

  function readLocal(accountScope, key) {
    if (scope === accountScope && (owns(dirty, key) || owns(values, key))) return { present: true, data: values[key], dirty: !!dirty[key], knownClean: !dirty[key] };
    try {
      var raw = window.sessionStorage.getItem(dataStorageKey(accountScope, key));
      var metaRaw = window.sessionStorage.getItem(metaStorageKey(accountScope, key));
      var meta = metaRaw ? JSON.parse(metaRaw) : null;
      if (raw !== null) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return { present: true, data: parsed, dirty: !!(meta && meta.dirty), knownClean: !!(meta && meta.clean && !meta.dirty) };
      }
      if (meta && meta.deleted) return { present: true, data: null, dirty: !!meta.dirty, knownClean: !!(meta.clean && !meta.dirty) };
    } catch { /* the in-memory copy remains usable */ }
    return { present: false, data: undefined, dirty: false, knownClean: false };
  }
  function persistLocal(accountScope, key, data, isDirty) {
    try {
      if (data === null) window.sessionStorage.removeItem(dataStorageKey(accountScope, key));
      else window.sessionStorage.setItem(dataStorageKey(accountScope, key), JSON.stringify(data));
      window.sessionStorage.setItem(metaStorageKey(accountScope, key), JSON.stringify({ dirty: !!isDirty, clean: !isDirty, deleted: data === null, updatedAt: Date.now() }));
      return true;
    } catch { return false; }
  }
  function clearLocalMeta(accountScope, key) {
    try { window.sessionStorage.removeItem(metaStorageKey(accountScope, key)); } catch { /* no-op */ }
  }

  async function request(method, body, accountScope, accountUserKey) {
    if (!same(accountScope, accountUserKey)) throw new Error('Account changed');
    var token = await window.FSMAuth.getIdToken();
    if (!same(accountScope, accountUserKey)) throw new Error('Account changed');
    var controller = new window.AbortController();
    controllers.add(controller);
    try {
      var response = await window.fetch(window.FSMAuth.apiOrigin() + '/api/drafts', {
        method: method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Vendor-Account': accountScope },
        body: body ? JSON.stringify(body) : undefined
      });
      var data = await response.json().catch(function () { return {}; });
      if (!same(accountScope, accountUserKey)) throw new Error('Account changed');
      if (!response.ok) { var error = new Error(data.message || 'Draft save unavailable'); error.status = response.status; throw error; }
      return data;
    } finally { controllers.delete(controller); }
  }
  function cloudMap(payload) {
    return (payload && Array.isArray(payload.drafts) ? payload.drafts : []).reduce(function (result, row) {
      if (row && validKey(row.key)) result[row.key] = row;
      return result;
    }, {});
  }
  function recordConflict(key, local, cloudRow) {
    conflicts[key] = {
      localData: local.data, cloudData: cloudRow ? cloudRow.data : null, cloudPresent: !!cloudRow,
      cloudVersion: cloudRow ? cloudRow.version : 0, cloudUpdatedAt: cloudRow ? cloudRow.updatedAt : 0, cloudKnown: true
    };
    values[key] = local.data; dirty[key] = true; versions[key] = cloudRow ? cloudRow.version : 0;
    persistLocal(scope, key, local.data, true);
  }
  function reconcile(payload, accountScope, accountUserKey) {
    if (!same(accountScope, accountUserKey) || !payload || payload.accountScope !== accountScope) return;
    var cloud = cloudMap(payload);
    DRAFT_KEYS.forEach(function (key) {
      var row = cloud[key];
      var local = readLocal(accountScope, key);
      versions[key] = row ? row.version : 0;
      if (row) lastSaved = Math.max(lastSaved, Number(row.updatedAt) || 0);
      if (!local.present) {
        if (row) { values[key] = row.data; persistLocal(accountScope, key, row.data, false); }
        else { delete values[key]; clearLocalMeta(accountScope, key); }
        delete dirty[key]; delete conflicts[key]; return;
      }
      if (local.knownClean) {
        if (row) { values[key] = row.data; persistLocal(accountScope, key, row.data, false); }
        else { delete values[key]; clearLocalMeta(accountScope, key); }
        delete dirty[key]; delete conflicts[key]; return;
      }
      var cloudData = row ? row.data : null;
      if ((row || local.data === null) && equal(local.data, cloudData)) {
        values[key] = cloudData; delete dirty[key]; delete conflicts[key]; persistLocal(accountScope, key, cloudData, false); return;
      }
      if (!row && local.data !== null) {
        values[key] = local.data; dirty[key] = true; delete conflicts[key]; persistLocal(accountScope, key, local.data, true);
        schedule(key, 900, accountScope, accountUserKey); return;
      }
      recordConflict(key, local, row);
    });
    paint();
  }

  function transient(error) { return !error || !error.status || error.status === 408 || error.status === 429 || error.status >= 500; }
  function schedule(key, delay, accountScope, accountUserKey) {
    clearTimer(key);
    if (!same(accountScope, accountUserKey) || conflicts[key]) return;
    timers[key] = window.setTimeout(function () { delete timers[key]; if (same(accountScope, accountUserKey)) flush(key); }, delay);
  }
  async function refreshConflict(key, accountScope, accountUserKey) {
    try {
      var payload = await request('GET', null, accountScope, accountUserKey);
      if (!same(accountScope, accountUserKey) || !payload || payload.accountScope !== accountScope) return;
      var row = cloudMap(payload)[key];
      recordConflict(key, { present: true, data: values[key], dirty: true }, row);
    } catch { if (same(accountScope, accountUserKey) && conflicts[key]) conflicts[key].cloudKnown = false; }
  }
  async function flush(key) {
    if (!validKey(key) || inFlight[key]) return;
    if (!scope || !dirty[key] || conflicts[key] || !navigator.onLine) { paint(); return; }
    inFlight[key] = true; clearTimer(key);
    var accountScope = scope, accountUserKey = userKey, data = values[key], before = serialized(data), retryScheduled = false;
    paint();
    try {
      var result = await request('PATCH', { key: key, version: versions[key] || 0, data: data }, accountScope, accountUserKey);
      if (!same(accountScope, accountUserKey)) return;
      versions[key] = result.version; lastSaved = Number(result.updatedAt) || Date.now(); retryCounts[key] = 0;
      if (serialized(values[key]) === before) { delete dirty[key]; persistLocal(accountScope, key, values[key], false); }
    } catch (error) {
      if (!same(accountScope, accountUserKey) || error.name === 'AbortError') return;
      if (error.status === 409) {
        conflicts[key] = { localData: values[key], cloudData: null, cloudPresent: false, cloudVersion: versions[key] || 0, cloudUpdatedAt: 0, cloudKnown: false };
        await refreshConflict(key, accountScope, accountUserKey);
      } else if (transient(error) && (retryCounts[key] || 0) < RETRY_DELAYS.length) {
        var retryIndex = retryCounts[key] || 0;
        retryCounts[key] = retryIndex + 1; schedule(key, RETRY_DELAYS[retryIndex], accountScope, accountUserKey); retryScheduled = true;
        status('Draft not synced yet — retrying automatically. Your edits remain in this tab.', 'error');
      } else status('Draft not synced — your edits remain in this tab. Reconnect or use Retry.', 'error');
    } finally {
      if (same(accountScope, accountUserKey)) {
        inFlight[key] = false;
        if (dirty[key] && !conflicts[key] && !timers[key] && !retryScheduled && serialized(values[key]) !== before) schedule(key, 500, accountScope, accountUserKey);
        if (!retryScheduled) paint();
      }
    }
  }
  function queue(key, data) {
    if (!scope || !validKey(key)) return;
    values[key] = data; dirty[key] = true; retryCounts[key] = 0;
    persistLocal(scope, key, data, true);
    if (conflicts[key]) {
      conflicts[key].localData = data;
      clearTimer(key);
      paint();
      return;
    }
    schedule(key, 900, scope, userKey); paint();
  }
  async function load(accountScope) {
    var accountUserKey = currentUserKey();
    if (!accountScope || !accountUserKey) return;
    if (scope !== accountScope || userKey !== accountUserKey) { reset(); scope = accountScope; userKey = accountUserKey; }
    if (loading) return loading;
    loading = (async function () {
      try { reconcile(await request('GET', null, accountScope, accountUserKey), accountScope, accountUserKey); }
      catch {
        if (same(accountScope, accountUserKey)) {
          DRAFT_KEYS.forEach(function (key) {
            var local = readLocal(accountScope, key);
            if (local.present) {
              values[key] = local.data;
              dirty[key] = true;
              persistLocal(accountScope, key, local.data, true);
            }
          });
          status('Draft sync unavailable — unfinished work stays in this tab until reconnected.', 'error');
        }
      } finally { if (same(accountScope, accountUserKey)) { loading = null; paint(); } }
    })();
    return loading;
  }

  function dispatchResolution(choice) {
    if (typeof window.CustomEvent === 'function') window.dispatchEvent(new window.CustomEvent('fsm:drafts-resolved', { detail: { choice: choice, scope: scope, userKey: userKey } }));
  }
  async function resolveConflicts(choice) {
    var conflictKeys = Object.keys(conflicts);
    if (!conflictKeys.length || (choice !== 'cloud' && choice !== 'local')) return false;
    var accountScope = scope, accountUserKey = userKey;
    if (!same(accountScope, accountUserKey)) return false;
    if (conflictKeys.some(function (key) { return !conflicts[key].cloudKnown; })) {
      await load(accountScope); conflictKeys = Object.keys(conflicts);
      if (conflictKeys.some(function (key) { return !conflicts[key].cloudKnown; })) {
        status(choice === 'cloud' ? 'The cloud copy could not be loaded. Your device copy was not changed.' : 'The latest cloud version could not be checked. Nothing was overwritten.', 'error');
        return false;
      }
    }
    if (choice === 'cloud') {
      conflictKeys.forEach(function (key) {
        var conflict = conflicts[key];
        versions[key] = conflict.cloudVersion || 0; values[key] = conflict.cloudPresent ? conflict.cloudData : null;
        persistLocal(accountScope, key, values[key], false); delete dirty[key]; delete conflicts[key]; retryCounts[key] = 0; clearTimer(key);
      });
      paint(); dispatchResolution('cloud'); return true;
    }
    conflictKeys.forEach(function (key) {
      var conflict = conflicts[key];
      values[key] = conflict.localData; versions[key] = conflict.cloudVersion || 0; dirty[key] = true;
      persistLocal(accountScope, key, values[key], true); delete conflicts[key]; retryCounts[key] = 0;
    });
    paint(); dispatchResolution('local'); await Promise.all(conflictKeys.map(flush)); return true;
  }
  async function flushNow() {
    var keys = Object.keys(dirty).filter(function (key) { return !conflicts[key]; });
    keys.forEach(function (key) { retryCounts[key] = 0; clearTimer(key); });
    await Promise.all(keys.map(flush)); paint(); return !hasUnsynced();
  }

  async function resizePhoto(file, options) {
    options = options || {};
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) < 0) throw new Error('Choose a JPEG, PNG or WebP photo.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a photo smaller than 25 MB.');
    var image = await window.createImageBitmap(file);
    try {
      var edge = options.edge || 1200, ratio = Math.min(1, edge / Math.max(image.width, image.height));
      var canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
      var context = canvas.getContext('2d'); context.fillStyle = '#fff9ee'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      var quality = 0.86, result = canvas.toDataURL('image/jpeg', quality);
      while (result.length > 650 * 1024 && quality > 0.3) { quality -= 0.1; result = canvas.toDataURL('image/jpeg', quality); }
      if (result.length > 700 * 1024) throw new Error('This image is unusually detailed. Crop it or choose another photo.');
      return result;
    } finally { image.close(); }
  }
  function downloadDrafts() {
    var blob = new window.Blob([JSON.stringify({ drafts: values, downloadedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'Four Seasons - My unfinished drafts.json'; link.click();
    window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
  }

  window.addEventListener('online', function () { Object.keys(dirty).forEach(function (key) { retryCounts[key] = 0; clearTimer(key); flush(key); }); });
  window.addEventListener('offline', paint);
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-retry-drafts]')) flushNow();
    if (event.target.closest('[data-download-drafts]')) downloadDrafts();
  });
  window.FSMAuth.onChange(function (state) {
    var nextUserKey = state && state.user && state.user.userKey ? state.user.userKey : '';
    if (userKey && nextUserKey !== userKey) reset();
  });
  window.FSMComfort = {
    load: load, queue: queue, paint: paint, resizePhoto: resizePhoto, reset: reset,
    hasUnsynced: hasUnsynced, flushNow: flushNow, resolveConflicts: resolveConflicts, downloadDrafts: downloadDrafts
  };
})();
