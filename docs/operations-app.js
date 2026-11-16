(function () {
  'use strict';

  var API_PATH = '/api/operations';
  var VALID_SECTIONS = ['overview', 'calendar', 'applications', 'bookings', 'roster', 'staff', 'policies', 'notifications', 'moderation', 'support', 'data', 'apply', 'my-bookings', 'visits', 'invite'];
  var STAFF_SECTIONS = ['overview', 'calendar', 'applications', 'bookings', 'roster', 'staff', 'policies', 'notifications', 'moderation', 'support', 'data', 'invite'];
  var VENDOR_SECTIONS = ['overview', 'apply', 'my-bookings', 'visits', 'notifications', 'support', 'invite'];
  var runtime = {
    root: null,
    section: 'overview',
    snapshot: null,
    loading: false,
    busy: false,
    requestId: 0,
    controller: null,
    unsubscribe: null,
    liveTimer: 0,
    lastFocus: null,
    authUserKey: '',
    staffAccessSeen: false,
    latestBackup: null,
    backupPreview: null,
    resources: {},
    home: { loading: false, loaded: false, error: '', results: {} },
    repeatPreview: null,
    resourceRequestId: 0,
    dialogSequence: 0
  };

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function attr(value) { return escapeHTML(value).replace(/`/g, '&#96;'); }
  function text(value, fallback) { return typeof value === 'string' && value.trim() ? value.trim() : (fallback || ''); }
  function array(value) { return Array.isArray(value) ? value : []; }
  function checked(value) { return value === true ? ' checked' : ''; }
  function selected(value, expected) { return String(value || '') === String(expected || '') ? ' selected' : ''; }
  function isStaff() { return runtime.snapshot && runtime.snapshot.viewer && runtime.snapshot.viewer.mode === 'staff'; }
  function can(permission) {
    if (!isStaff()) return false;
    return runtime.snapshot.viewer.role === 'owner' || runtime.snapshot.viewer.permissions.indexOf(permission) >= 0;
  }
  function vendorSection() { return ['apply', 'my-bookings', 'visits'].indexOf(runtime.section) >= 0; }
  function operationsPath() { return vendorSection() || runtime.snapshot && runtime.snapshot.viewer.mode === 'vendor' ? API_PATH + '?view=vendor' : API_PATH; }
  function apiOrigin() {
    return window.FSMAuth && typeof window.FSMAuth.apiOrigin === 'function' ? window.FSMAuth.apiOrigin() : window.location.origin;
  }
  function apiUrl(path) { return new URL(path || API_PATH, apiOrigin()).href; }

  function localDate(value) {
    if (!value) return 'Date not set';
    var date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(value + 'T12:00:00') : new Date(value);
    if (isNaN(date.getTime())) return 'Date not set';
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }).format(date);
  }

  function localDateTime(value) {
    if (!value) return 'Not recorded';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'Not recorded';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' }).format(date);
  }

  function marketDateTimeInput(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    var map = {}; parts.forEach(function (part) { map[part.type] = part.value; });
    return map.year + '-' + map.month + '-' + map.day + 'T' + map.hour + ':' + map.minute;
  }

  function marketLocalToIso(value) {
    if (!value) return '';
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return value;
    var target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
    function wallClock(epoch) {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
      var map = {}; parts.forEach(function (part) { map[part.type] = part.value; });
      return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    }
    var guess = target;
    guess -= wallClock(guess) - target;
    guess -= wallClock(guess) - target;
    var zonePart = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' }).formatToParts(new Date(guess)).find(function (part) { return part.type === 'timeZoneName'; });
    var offset = zonePart && /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(zonePart.value);
    if (!offset) return new Date(guess).toISOString();
    return value + ':00' + offset[1] + String(offset[2]).padStart(2, '0') + ':' + String(offset[3] || '00').padStart(2, '0');
  }

  function occurrenceHours(item) {
    if (item.hours) return item.hours;
    if (!item.startsAt || !item.endsAt) return '';
    var formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    return formatter.format(new Date(item.startsAt)) + '–' + formatter.format(new Date(item.endsAt));
  }

  function money(value) {
    var amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount) : 'Not set';
  }

  function moneyCents(value) {
    if (value === null || value === undefined || value === '') return 'Not set';
    var cents = Number(value);
    return Number.isFinite(cents) ? money(cents / 100) : 'Not set';
  }

  function label(value) {
    var labels = {
      published_listing: 'Published listing', scheduled: 'Scheduled', delayed: 'Delayed', cancelled: 'Cancelled', draft: 'Draft', submitted: 'Submitted',
      needs_info: 'Needs information', needs_information: 'Needs information', approved: 'Approved', declined: 'Declined',
      rejected: 'Declined', waitlisted: 'Waitlisted', payment_due: 'Payment due', confirmed: 'Confirmed',
      attended: 'Attended', no_show: 'No-show', credited: 'Credited', withdrawn: 'Withdrawn', open: 'Open',
      pending: 'Pending', reviewing: 'Reviewing', resolved: 'Resolved', dismissed: 'Dismissed', suspended: 'Suspended', active: 'Active', disabled: 'Disabled', closed: 'Closed', in_progress: 'In progress',
      owner: 'Owner', admin: 'Administrator', operations: 'Operations', market_manager: 'Market manager', check_in: 'Check-in staff',
      vendor_reviewer: 'Vendor reviewer', finance: 'Finance', content: 'Content', readonly: 'Read only', vendor: 'Vendor', vendor_owner: 'Vendor owner'
    };
    return labels[value] || String(value || 'Unknown').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function statusClass(value) {
    var safe = String(value || 'unknown').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    return 'ops-status status-' + safe;
  }

  function normalise(payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    var viewer = payload.viewer && typeof payload.viewer === 'object' ? payload.viewer : {};
    var role = text(viewer.role || payload.role, 'vendor');
    var mode = viewer.mode === 'staff' || role !== 'vendor' && role !== 'vendor_owner' && role !== 'vendor_editor' ? 'staff' : 'vendor';
    return {
      viewer: {
        mode: mode,
        role: role,
        displayName: text(viewer.displayName || viewer.name || (payload.user && payload.user.displayName), mode === 'staff' ? 'Market staff' : 'Vendor'),
        permissions: array(viewer.permissions),
        marketIds: array(viewer.marketScopes || viewer.marketIds || viewer.scopes),
        account: viewer.account && typeof viewer.account === 'object' ? viewer.account : null
      },
      version: Number.isInteger(payload.version) ? payload.version : null,
      summary: payload.summary && typeof payload.summary === 'object' ? payload.summary : {},
      pageInfo: payload.pageInfo && typeof payload.pageInfo === 'object' ? payload.pageInfo : {},
      occurrences: array(payload.occurrences || payload.marketOccurrences),
      applications: array(payload.applications).map(function (item) {
        var answers = item.answers && typeof item.answers === 'object' ? item.answers : {};
        var categories = array(answers.categories);
        if (item.primaryCategory && categories.indexOf(item.primaryCategory) < 0) categories.unshift(item.primaryCategory);
        return Object.assign({}, item, answers, {
          productDescription: text(answers.productDescription || answers.description),
          categories: categories,
          documentIds: array(item.documentIds).length ? array(item.documentIds) : array(answers.documentIds),
          missingItems: array(item.missingItems)
        });
      }),
      bookings: array(payload.bookings || payload.reservations),
      staff: array(payload.staff || payload.memberships),
      policies: payload.policies && typeof payload.policies === 'object' ? payload.policies : {},
      notifications: array(payload.notifications).map(function (item) {
        var delivery = {};
        try { delivery = item.deliveryJson ? JSON.parse(item.deliveryJson) : {}; } catch {}
        return Object.assign({}, item, { delivery: delivery, deliveryStatus: item.deliveryStatus || delivery.status || '' });
      }),
      reports: array(payload.reports || payload.moderation),
      threads: array(payload.threads || payload.supportThreads),
      partners: array(payload.inquiries || payload.partners || payload.partnerInquiries),
      inquiryMessages: array(payload.inquiryMessages),
      staffInvites: array(payload.staffInvites),
      audit: array(payload.audit || payload.auditEvents),
      exports: array(payload.exports),
      configured: payload.configured !== false,
      raw: payload
    };
  }

  function routeQuery() {
    var hash = String(window.location.hash || '');
    var query = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?') + 1) : '';
    return new URLSearchParams(query);
  }

  function cleanFilters(source) {
    source = source || {};
    var clean = {};
    ['status', 'marketId', 'occurrenceId', 'q', 'dateFrom', 'dateTo'].forEach(function (key) {
      var value = text(source[key]);
      if (value) clean[key] = key === 'q' ? value.slice(0, 80) : value;
    });
    return clean;
  }

  function buildResourceQuery(resource, filters, cursor, limit) {
    var params = new URLSearchParams();
    params.set('resource', resource);
    params.set('limit', String(Math.max(1, Math.min(100, Number(limit) || 50))));
    var safe = cleanFilters(filters);
    Object.keys(safe).forEach(function (key) { params.set(key, safe[key]); });
    if (cursor) params.set('cursor', cursor);
    return params.toString();
  }

  function initialResourceFilters(resource, params, today) {
    params = params || new URLSearchParams();
    var filters = {};
    ['status', 'marketId', 'occurrenceId', 'q', 'dateFrom', 'dateTo'].forEach(function (key) {
      if (params.get(key)) filters[key] = params.get(key);
    });
    if (resource === 'occurrences' && !Object.keys(filters).length) filters.dateFrom = today || currentChicagoDate();
    return cleanFilters(filters);
  }

  function sameFilters(left, right) {
    left = cleanFilters(left);
    right = cleanFilters(right);
    var keys = ['status', 'marketId', 'occurrenceId', 'q', 'dateFrom', 'dateTo'];
    return keys.every(function (key) { return (left[key] || '') === (right[key] || ''); });
  }

  function reconcileResourceFilters(state, resource, params, today) {
    if (!state) return false;
    var next = initialResourceFilters(resource, params, today);
    if (sameFilters(state.filters, next)) return false;
    if (state.controller) state.controller.abort();
    state.filters = next;
    state.cursor = '';
    state.previous = [];
    state.items = [];
    state.summary = {};
    state.pageInfo = {};
    state.occurrence = null;
    state.loaded = false;
    state.loading = false;
    state.error = '';
    state.controller = null;
    state.deferredRender = false;
    state.requestId = Number(state.requestId || 0) + 1;
    return true;
  }

  function filterOccurrenceItems(items, filters) {
    filters = cleanFilters(filters);
    var query = String(filters.q || '').toLowerCase();
    return array(items).filter(function (item) {
      var date = String(occurrenceDate(item) || '').slice(0, 10);
      if (filters.status && String(item.status || 'published_listing') !== filters.status) return false;
      if (filters.marketId && String(item.marketId || '') !== filters.marketId) return false;
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
      if (!query) return true;
      var haystack = [item.id, item.publicId, item.marketId, item.name, item.marketName, item.venue, item.address, item.city, item.postalCode, item.status, date].map(function (value) { return String(value || '').toLowerCase(); }).join(' ');
      return haystack.indexOf(query) >= 0;
    });
  }

  function resourceState(resource) {
    if (!runtime.resources[resource]) {
      var params = routeQuery();
      runtime.resources[resource] = { loaded: false, loading: false, error: '', items: [], summary: {}, pageInfo: {}, occurrence: null, filters: initialResourceFilters(resource, params), cursor: '', previous: [], requestId: 0, controller: null, deferredRender: false };
    }
    return runtime.resources[resource];
  }

  function normaliseResourceItems(resource, items) {
    if (resource === 'applications') return normalise({ applications: items }).applications;
    if (resource === 'notifications') return normalise({ notifications: items }).notifications;
    return array(items);
  }

  function resourceItems(resource, fallback) {
    var state = runtime.resources[resource];
    return state && state.loaded ? state.items : array(fallback);
  }

  function resourceTotal(resource, fallback) {
    var state = runtime.resources[resource];
    return state && state.loaded && Number.isInteger(state.pageInfo.total) ? state.pageInfo.total : array(fallback).length;
  }

  function currentChicagoDate() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var map = {}; parts.forEach(function (part) { map[part.type] = part.value; });
    return map.year + '-' + map.month + '-' + map.day;
  }

  function upcomingOccurrences(items, today) {
    today = today || currentChicagoDate();
    return array(items).filter(function (item) {
      var date = String(occurrenceDate(item) || '').slice(0, 10);
      return date >= today && ['published_listing', 'scheduled', 'delayed'].indexOf(item.status || 'published_listing') >= 0;
    }).sort(sortDate);
  }

  function csvCell(value) {
    var cell = String(value == null ? '' : value);
    if (/^[=+\-@]/.test(cell.trimStart())) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  }

  function parseRepeatDates(value) {
    var dates = text(value).split(/[\n,]+/).map(function (date) { return date.trim(); }).filter(Boolean);
    if (!dates.length || dates.length > 12) throw new Error('Enter between 1 and 12 dates.');
    if (dates.some(function (date) { return !/^\d{4}-\d{2}-\d{2}$/.test(date); })) throw new Error('Use YYYY-MM-DD for every repeat date.');
    if (new Set(dates).size !== dates.length) throw new Error('Remove duplicate repeat dates before previewing.');
    return dates;
  }

  function validateRepeatDraft(data) {
    data = data || {};
    var dates;
    try { dates = parseRepeatDates(data.dates); }
    catch (error) { return { valid: false, field: 'dates', message: error.message }; }
    if (data.endsLocal <= data.startsLocal) return { valid: false, field: 'endsLocal', message: 'End time must be after start time.' };
    return { valid: true, dates: dates };
  }

  function repeatFormDefaults(item, draft) {
    item = item || {};
    draft = draft || {};
    return {
      dates: array(draft.dates).join('\n'),
      startsLocal: text(draft.startsLocal, marketDateTimeInput(item.startsAt).slice(11, 16)),
      endsLocal: text(draft.endsLocal, marketDateTimeInput(item.endsAt).slice(11, 16)),
      sourceUrl: text(draft.sourceUrl, item.sourceUrl || ''),
      sourceCheckedAt: marketDateTimeInput(draft.sourceCheckedAt || item.sourceCheckedAt)
    };
  }

  function workspaceReturnHref(section, currentHash) {
    var safe = VALID_SECTIONS.indexOf(section) >= 0 ? section : 'overview';
    var expected = safe === 'overview' ? '#operations' : '#operations/' + safe;
    var supplied = String(currentHash || '');
    var target = supplied === expected || supplied.indexOf(expected + '?') === 0 ? supplied : expected;
    return '#workspace?return=' + encodeURIComponent(target);
  }

  function occurrenceActionState(item, today) {
    item = item || {};
    var status = item.status || 'published_listing';
    var date = String(occurrenceDate(item) || '').slice(0, 10);
    var currentOrFuture = !!date && date >= (today || currentChicagoDate());
    return {
      roster: ['published_listing', 'scheduled', 'delayed'].indexOf(status) >= 0,
      repeat: status !== 'cancelled',
      delay: currentOrFuture && ['published_listing', 'scheduled'].indexOf(status) >= 0,
      cancel: currentOrFuture && ['draft', 'published_listing', 'scheduled', 'delayed'].indexOf(status) >= 0
    };
  }

  function occurrenceFormMode(nextStatus) {
    if (nextStatus === 'cancelled') return { title: 'REVIEW THE CANCELLATION', submit: 'Save cancellation', focus: 'loadInNotes' };
    if (nextStatus === 'delayed') return { title: 'REVIEW THE DELAY UPDATE', submit: 'Save delayed status', focus: 'loadInNotes' };
    if (nextStatus === 'edit') return { title: 'EDIT THE DATED RECORD', submit: 'Save occurrence', focus: 'name' };
    return { title: 'ADD A DATED MARKET', submit: 'Save new occurrence', focus: 'marketId' };
  }

  function setOccurrenceFormMode(form, nextStatus) {
    var mode = occurrenceFormMode(nextStatus);
    var heading = form && form.querySelector('[data-ops-occurrence-heading]');
    var submit = form && form.querySelector('[data-ops-occurrence-submit]');
    if (heading) heading.textContent = mode.title;
    if (submit) submit.textContent = mode.submit;
    return mode;
  }

  function prepareNewOccurrenceForm(form) {
    form.reset();
    var id = form.elements.namedItem('id');
    var version = form.elements.namedItem('version');
    if (id) id.value = '';
    if (version) version.value = '';
    return setOccurrenceFormMode(form, '');
  }

  function hasActiveOperationsEditor(root) {
    return !!(root && root.querySelector('[data-drawer]:not([hidden]), dialog[open]'));
  }

  function consumeDeferredResourceRender(resources, activeEditor) {
    if (activeEditor) return false;
    var pending = false;
    Object.keys(resources || {}).forEach(function (key) {
      if (resources[key].deferredRender) {
        resources[key].deferredRender = false;
        pending = true;
      }
    });
    return pending;
  }

  function conflictRecoveryMessage(message) {
    return text(message, 'The change could not be saved.') + ' Your unsaved values remain on this page and were not submitted. Copy them if needed. Selecting “Review latest record” replaces this unsaved copy.';
  }

  function routeHref(section) { return section === 'overview' ? '#operations' : '#operations/' + section; }

  function navItem(section, number, title, note) {
    var active = runtime.section === section;
    return '<a class="ops-nav-link' + (active ? ' is-active' : '') + '" href="' + routeHref(section) + '"' + (active ? ' aria-current="page"' : '') + '>' +
      '<span>' + escapeHTML(number) + '</span><b>' + escapeHTML(title) + '</b><small>' + escapeHTML(note) + '</small></a>';
  }

  function staffNav() {
    var checkInOnly = runtime.snapshot.viewer.role === 'check_in';
    return navItem('overview', '00', 'Daily desk', 'What needs a person') +
      navItem('calendar', '01', 'Markets', 'Dates, status, capacity') +
      (!checkInOnly ? navItem('applications', '02', 'Applications', 'Review the queue') : '') +
      (!checkInOnly ? navItem('bookings', '03', 'Bookings', 'Place every vendor') : '') +
      (can('checkin.manage') ? navItem('roster', 'DAY', 'Market day', 'Arrival and no-show') : '') +
      (can('staff.manage') ? navItem('staff', '04', 'Team', 'Roles and market access') : '') +
      navItem('notifications', '05', 'Notices', 'Delivery and replies') +
      (can('moderation.manage') ? navItem('moderation', '06', 'Moderation', 'Public content review') : '') +
      (can('inquiries.manage') ? navItem('support', '07', 'Inbox', 'Vendors and partners') : '') +
      (can('policies.manage') ? navItem('policies', '08', 'Rules', 'Operating decisions') : '') +
      (can('data.export') || ['owner', 'admin'].indexOf(runtime.snapshot.viewer.role) >= 0 ? navItem('data', '09', 'Records', 'Exports and recovery') : '');
  }

  function vendorNav() {
    return (runtime.staffAccessSeen ? '<a class="ops-nav-link ops-nav-switch" href="#operations"><span>↔</span><b>Manager desk</b><small>Return to staff operations</small></a>' : '') +
      navItem('overview', '00', 'Start here', 'Your next action') +
      navItem('apply', '01', 'Application', 'Reuse your business record') +
      navItem('my-bookings', '02', 'Market dates', 'Requests and decisions') +
      navItem('visits', '03', 'Market day', 'Confirmed instructions') +
      navItem('notifications', '04', 'Messages', 'Updates that matter') +
      navItem('support', '05', 'Get help', 'Keep the context attached');
  }

  function renderOperationsApp(section) {
    runtime.section = VALID_SECTIONS.indexOf(section) >= 0 ? section : 'overview';
    runtime.resources = {};
    runtime.repeatPreview = null;
    return '<section class="ops" data-operations-app>' +
      '<div class="ops-ribbon"><strong>ONE OPERATING RECORD</strong><span>Dates · decisions · vendors · public updates</span></div>' +
      '<div class="ops-layout">' +
        '<aside class="ops-rail"><header><span class="ops-kicker">Market operations</span><a href="#operations" class="ops-wordmark">FIELD<br>OFFICE</a><p>One desk for the work behind every market day.</p></header>' +
          '<button class="ops-mobile-menu" type="button" aria-expanded="false" aria-controls="ops-market-nav" data-ops-nav-toggle><span>Market operations menu</span><strong data-ops-nav-toggle-label>Show sections ↓</strong></button>' +
          '<nav class="ops-nav" id="ops-market-nav" aria-label="Market operations" data-ops-nav><div class="ops-nav-skeleton">Opening your desk…</div></nav>' +
          '<div class="ops-account" data-ops-account><span>Checking account…</span></div>' +
        '</aside>' +
        '<div class="ops-main" tabindex="-1" data-ops-main><div class="ops-live" role="status" aria-live="polite" aria-atomic="true" data-ops-live></div><div data-ops-content>' + loadingView() + '</div></div>' +
      '</div>' +
    '</section>';
  }

  function loadingView() {
    return '<section class="ops-loading" aria-label="Opening operations desk"><span class="ops-kicker">Opening the field office</span><h1>PUTTING THE MARKET DAY IN ORDER.</h1><div></div><div class="short"></div><p>Loading dates, decisions, and action queues…</p></section>';
  }

  function errorView(message) {
    return '<section class="ops-state-panel" role="alert"><span>OFFLINE</span><div><span class="ops-kicker">Operations desk</span><h1>THE FIELD OFFICE DID NOT OPEN.</h1><p>' + escapeHTML(message || 'The current records could not be loaded.') + '</p><button class="ops-button primary" type="button" data-ops-retry>Try again</button></div></section>';
  }

  function updateShell() {
    if (!runtime.root || !runtime.snapshot) return;
    if (isStaff()) runtime.staffAccessSeen = true;
    var nav = runtime.root.querySelector('[data-ops-nav]');
    if (nav) nav.innerHTML = isStaff() ? staffNav() : vendorNav();
    var account = runtime.root.querySelector('[data-ops-account]');
    if (account) account.innerHTML = '<span class="ops-kicker">Signed in · ' + escapeHTML(label(runtime.snapshot.viewer.role)) + '</span><strong>' + escapeHTML(runtime.snapshot.viewer.displayName) + '</strong><small>' + (isStaff() ? 'Review saved staff actions in Records.' : 'Your saved records follow this account.') + '</small>' + (isStaff() ? '<a class="ops-link" href="#operations/apply">My vendor record →</a>' : '') + '<button type="button" data-ops-signout>Sign out ↗</button>';
  }

  function pageHead(kicker, title, copy, action) {
    return '<header class="ops-page-head"><div><span class="ops-kicker">' + escapeHTML(kicker) + '</span><h1>' + escapeHTML(title) + '</h1><p>' + escapeHTML(copy) + '</p></div>' + (action || '') + '</header>';
  }

  function metric(number, value, name, note, tone) {
    return '<article class="ops-metric ' + attr(tone || '') + '"><span>' + escapeHTML(number) + '</span><strong>' + escapeHTML(value) + '</strong><div><b>' + escapeHTML(name) + '</b><small>' + escapeHTML(note) + '</small></div></article>';
  }

  function empty(title, body, action) {
    return '<div class="ops-empty"><span>00</span><div><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(body) + '</p>' + (action || '') + '</div></div>';
  }

  function countStatus(list, statuses) {
    return array(list).filter(function (item) { return statuses.indexOf(item.status) >= 0; }).length;
  }

  function summaryCount(name, fallback) {
    var value = runtime.snapshot && runtime.snapshot.summary && Number(runtime.snapshot.summary[name]);
    return Number.isFinite(value) && value >= 0 ? value : Number(fallback) || 0;
  }

  function homeQueueItems() {
    var results = runtime.home.results || {};
    var queue = [];
    function push(key, type, href, title, meta, priority) {
      var response = results[key];
      array(response && response.items).forEach(function (item) {
        queue.push({
          key: key + ':' + item.id,
          type: type,
          title: title(item),
          meta: meta(item),
          href: typeof href === 'function' ? href(item) : href,
          date: String(item.date || item.startsAt || item.bookingDeadlineAt || item.createdAt || item.submittedAt || item.updatedAt || ''),
          priority: priority
        });
      });
    }
    function recordHref(section, status, item) { return '#operations/' + section + '?status=' + encodeURIComponent(status) + '&q=' + encodeURIComponent(item.publicId || item.id || item.businessName || ''); }
    push('applications:submitted', 'REVIEW', function (item) { return recordHref('applications', 'submitted', item); }, function (item) { return text(item.businessName || item.vendorName, 'Vendor application'); }, function (item) { return 'Submitted ' + localDateTime(item.submittedAt || item.updatedAt); }, 1);
    push('bookings:requested', 'PLACE', function (item) { return recordHref('bookings', 'requested', item); }, function (item) { return text(item.businessName, bookingBusinessName(item)); }, function (item) { return text(item.marketName, 'Market') + ' · ' + localDate(occurrenceDate(item)); }, 2);
    push('bookings:approved', 'CONFIRM', function (item) { return recordHref('bookings', 'approved', item); }, function (item) { return text(item.businessName, bookingBusinessName(item)); }, function (item) { return text(item.marketName, 'Market') + ' · Approved, not confirmed'; }, 3);
    push('bookings:payment_due', 'CONFIRM', function (item) { return recordHref('bookings', 'payment_due', item); }, function (item) { return text(item.businessName, bookingBusinessName(item)); }, function (item) { return text(item.marketName, 'Market') + ' · Fee decision recorded'; }, 3);
    push('reports:open', 'REPORT', function (item) { return recordHref('moderation', 'open', item); }, function (item) { return text(item.businessName || item.subject, 'Directory report'); }, function (item) { return text(item.reason || item.details, 'Open review'); }, 0);
    push('inquiries:new', 'INBOX', function (item) { return recordHref('support', 'new', item); }, function (item) { return text(item.subject || item.organization, 'New inquiry'); }, function (item) { return text(item.name, 'Sender') + ' · ' + localDateTime(item.createdAt); }, 2);
    return queue.sort(function (a, b) { return a.priority - b.priority || a.date.localeCompare(b.date) || a.key.localeCompare(b.key); }).slice(0, 12);
  }

  function overviewView() {
    var s = runtime.snapshot;
    if (!isStaff()) return vendorOverviewView();
    var applicationReviews = summaryCount('applicationsSubmitted', countStatus(s.applications, ['submitted']));
    var bookingDecisions = summaryCount('bookingDecisions', countStatus(s.bookings, ['requested']));
    var readyToConfirm = summaryCount('readyToConfirm', countStatus(s.bookings, ['approved', 'payment_due']));
    var openReports = summaryCount('openReports', countStatus(s.reports, ['open', 'pending', 'reviewing']));
    var openInquiries = summaryCount('openInquiries', countStatus(s.partners, ['open', 'pending', 'in_progress']));
    var waitingVendor = summaryCount('applicationsWaitingOnVendor', countStatus(s.applications, ['needs_info', 'needs_information']));
    var waitlisted = summaryCount('waitlisted', countStatus(s.bookings, ['waitlisted']));
    var queue = homeQueueItems();
    var today = localDate(currentChicagoDate());
    return pageHead('00 / ' + today, 'RUN THE NEXT MARKET.', 'A role-scoped run sheet of decisions, disruptions, and handoffs that need a person.', '<a class="ops-button ink" href="' + (can('checkin.manage') ? '#operations/roster' : '#operations/calendar') + '">' + (can('checkin.manage') ? 'Open market-day roster →' : 'Update a market →') + '</a>') +
      '<section class="ops-work-stamps" aria-label="Work that needs staff action">' +
        metric('REVIEW', String(applicationReviews), 'Submitted applications', applicationReviews ? 'Staff decision needed' : 'Caught up', applicationReviews ? 'tomato' : 'green') +
        metric('PLACE', String(bookingDecisions), 'New booking requests', bookingDecisions ? 'Placement decision needed' : 'Caught up', bookingDecisions ? 'mustard' : 'green') +
        metric('CONFIRM', String(readyToConfirm), 'Approved, not confirmed', readyToConfirm ? 'Finish the handoff' : 'Caught up', readyToConfirm ? 'mustard' : 'green') +
        metric('EXCEPT', String(openReports + openInquiries), 'Reports and inbox', openReports + openInquiries ? 'Review open exceptions' : 'Caught up', openReports + openInquiries ? 'tomato' : 'green') +
      '</section>' +
      '<p class="ops-waiting-line"><strong>Waiting elsewhere:</strong> ' + waitingVendor + ' application' + (waitingVendor === 1 ? '' : 's') + ' need vendor information · ' + waitlisted + ' booking' + (waitlisted === 1 ? '' : 's') + ' wait for capacity. These are not counted as staff decisions above.</p>' +
      '<div class="ops-two-col"><section class="ops-board mustard ops-run-sheet"><div class="ops-section-head"><div><span class="ops-kicker">Daily run sheet</span><h2>WHAT NEEDS A PERSON?</h2></div><span>' + (runtime.home.loading ? 'Updating…' : queue.length + ' shown') + '</span></div>' +
        (runtime.home.error ? '<p class="ops-note">The priority list could not refresh: ' + escapeHTML(runtime.home.error) + '</p>' : queue.length ? '<ol class="ops-priority-list">' + queue.map(function (item) { return '<li><a href="' + attr(item.href) + '"><span class="ops-priority-type">' + escapeHTML(item.type) + '</span><div><h3>' + escapeHTML(item.title) + '</h3><p>' + escapeHTML(item.meta) + '</p></div><strong aria-hidden="true">→</strong></a></li>'; }).join('') + '</ol>' : runtime.home.loaded ? empty('No staff action is queued', 'Waiting-on-vendor and waitlist records remain available in their full lists.', '') : '<div class="ops-run-loading" aria-busy="true">Assembling the authorized work queue…</div>') +
        '</section><section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Next on the ground</span><h2>UPCOMING MARKETS</h2></div><a href="#operations/calendar">Full calendar →</a></div>' + occurrenceList(upcomingOccurrences(s.occurrences).slice(0, 5), true) + '</section></div>' +
      readinessPanel();
  }

  function vendorOverviewView() {
    var s = runtime.snapshot;
    var application = s.applications[0] || null;
    var confirmed = countStatus(s.bookings, ['confirmed', 'attended']);
    var unread = s.notifications.filter(function (x) { return !x.readAt && x.read !== true; }).length;
    var nextAction = !application ? { title: 'Start your application', body: 'Tell the market team what you make. Your business details can be reused for future dates.', href: '#operations/apply', button: 'Start application →' } :
      ['draft', 'needs_info', 'needs_information'].indexOf(application.status) >= 0 ? { title: application.status === 'draft' ? 'Finish your application' : 'The team needs more information', body: text(application.staffNote || application.staffMessage || application.reviewNote, 'Open your application to see what is missing.'), href: '#operations/apply', button: 'Open application →' } :
      application.status === 'approved' ? { title: 'Choose a market date', body: 'Your application is approved. Request an available occurrence when you are ready.', href: '#operations/my-bookings', button: 'Find market dates →' } : { title: 'Follow the application decision', body: 'Your current status and any staff explanation are saved with the application.', href: '#operations/apply', button: 'Review status →' };
    return pageHead('00 / Vendor operations', 'YOUR NEXT MARKET STARTS HERE.', 'Application, dates, decisions, and arrival details in one signed-in account.', (runtime.staffAccessSeen ? '<a class="ops-button outline" href="#operations">Manager desk ↔</a>' : '') + '<a class="ops-button ink" href="#workspace">Open storefront tools →</a>') +
      '<section class="ops-metrics three" aria-label="Vendor operations totals">' +
        metric('01', application ? label(application.status) : 'NOT STARTED', 'Application', application ? 'Updated ' + localDateTime(application.updatedAt) : 'One reusable record') +
        metric('02', String(confirmed), 'Confirmed markets', confirmed ? 'Arrival details available' : 'No confirmed dates') +
        metric('03', String(unread), 'Unread updates', unread ? 'Needs your attention' : 'All caught up') +
      '</section><div class="ops-two-col"><section class="ops-board tomato"><span class="ops-kicker">Up next</span><h2>' + escapeHTML(nextAction.title) + '</h2><p>' + escapeHTML(nextAction.body) + '</p><a class="ops-button paper" href="' + nextAction.href + '">' + escapeHTML(nextAction.button) + '</a></section><section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Your dates</span><h2>MARKET REQUESTS</h2></div><a href="#operations/my-bookings">See all →</a></div>' + bookingList(s.bookings.slice(0, 4), false) + '</section></div>' +
      '<section class="ops-truth"><strong>One record, clear authority</strong><p>A submitted request is not a confirmed booth. A booking becomes public only after authorized staff confirm it. Payment is not collected in this workspace unless the organizer later configures and activates an approved payment service.</p></section>';
  }

  function readinessPanel() {
    var p = runtime.snapshot.policies || {};
    var required = [p.bookingDeadlinePolicy, p.cancellationPolicy, p.weatherPolicy, p.creditRefundPolicy, p.paymentPolicy, p.supportContact];
    var set = required.filter(Boolean).length;
    var gates = [
      { done: set === required.length, title: 'Rules', note: set + ' / ' + required.length + ' complete' },
      { done: p.approved === true, title: 'Owner review', note: p.approved === true ? 'Approved' : 'Approval missing' },
      { done: p.operatorAuthorized === true, title: 'Organizer authority', note: p.operatorAuthorized === true ? 'Recorded' : 'Not recorded' },
      { done: !!p.activatedAt, title: 'Activation', note: p.activatedAt ? 'Active ' + localDateTime(p.activatedAt) : 'Bookings remain gated' }
    ];
    return '<section class="ops-readiness"><div><span class="ops-kicker">Operating readiness</span><h2>' + (gates.every(function (gate) { return gate.done; }) ? 'AUTHORIZED RECORD ACTIVE' : 'CLEAR THE FOUR GATES') + '</h2><p>These stages are separate. Saved dates and policies do not activate booking, payment, email, or text delivery by themselves.</p></div><div class="ops-gate-line">' + gates.map(function (gate, index) { return '<div class="' + (gate.done ? 'is-done' : '') + '"><span>' + String(index + 1).padStart(2, '0') + '</span><b>' + escapeHTML(gate.title) + '</b><small>' + escapeHTML(gate.note) + '</small></div>'; }).join('') + '</div>' + (can('policies.manage') ? '<a class="ops-button outline" href="#operations/policies">Review rules →</a>' : '<span class="ops-kicker">Owner action required</span>') + '</section>';
  }

  function operatingRecordAuthorized() {
    var policies = runtime.snapshot && runtime.snapshot.policies || {};
    return !!(policies.activatedAt && policies.approved === true && policies.operatorAuthorized === true);
  }

  function sortDate(a, b) { return String(a.date || a.startsAt || '').localeCompare(String(b.date || b.startsAt || '')); }
  function occurrenceName(item) { return text(item.marketName || item.name || item.market && item.market.name, 'Market occurrence'); }
  function occurrenceDate(item) { return item.date || item.startsAt || item.startDate || ''; }
  function occupiedCount(occurrenceId) {
    if (!runtime.snapshot) return 0;
    return runtime.snapshot.bookings.filter(function (booking) { return booking.occurrenceId === occurrenceId && ['approved','payment_due','confirmed','attended','no_show'].indexOf(booking.status) >= 0; }).length;
  }
  function bookingBusinessName(item) {
    var application = runtime.snapshot && runtime.snapshot.applications.find(function (candidate) { return candidate.id === item.applicationId || item.publicId && candidate.publicId === item.publicId; });
    return text(application && application.businessName, item.publicId || 'Vendor');
  }
  function rosterSlot(value) {
    return Number.isFinite(value) ? String(value) : text(value, '—');
  }
  function occurrenceList(items, compact) {
    if (!items.length) return empty('No market occurrences', 'Authorized staff can add the first dated market listing.', '<a class="ops-link" href="#operations/calendar">Open market calendar →</a>');
    return '<div class="ops-occurrence-list">' + items.map(function (item) {
      var capacity = item.capacity == null ? NaN : Number(item.capacity);
      var occupied = occupiedCount(item.id);
      var available = Number.isFinite(capacity) ? Math.max(0, capacity - occupied) : null;
      return '<article><div class="ops-date-block"><strong>' + escapeHTML(localDate(occurrenceDate(item)).split(',')[0]) + '</strong><span>' + escapeHTML(localDate(occurrenceDate(item)).replace(/^[^,]+,\s*/, '')) + '</span></div><div><span class="' + statusClass(item.status) + '">' + escapeHTML(label(item.status || 'published_listing')) + '</span><h3>' + escapeHTML(occurrenceName(item)) + '</h3><p>' + escapeHTML(text(item.venue)) + (occurrenceHours(item) ? ' · ' + escapeHTML(occurrenceHours(item)) : '') + '</p></div>' + (!compact ? '<div class="ops-capacity"><strong>' + (available == null ? '—' : available) + '</strong><span>spaces open</span></div>' : '') + '</article>';
    }).join('') + '</div>';
  }

  function calendarView() {
    var state = resourceState('occurrences');
    var items = state.loaded ? state.items.slice() : state.error ? [] : filterOccurrenceItems(runtime.snapshot.occurrences, state.filters);
    items.sort(sortDate);
    var emptyCalendar = state.error
      ? empty('Market list unavailable', 'The filtered calendar was not replaced with stale or mismatched records. Use “Try this list again” above.', '')
      : empty('No matching dated markets', 'Clear the filters or add a market occurrence after the organizer confirms its details.', '');
    var calendarCallout = operatingRecordAuthorized()
      ? '<section class="ops-callout"><strong>Organizer-authorized status lives here.</strong><p>Changing a date or status updates this operating record. Notification delivery still requires configured channels and is logged separately.</p><a href="' + attr(apiUrl('/api/calendar')) + '" target="_blank" rel="noopener">Open calendar feed ↗</a></section>'
      : '<section class="ops-callout warning"><strong>Configuration and preview record.</strong><p>Dates and status changes remain a proposed operating record until the organizer approves the policies, records authority, and activates operations.</p><a href="' + attr(apiUrl('/api/calendar')) + '" target="_blank" rel="noopener">Preview calendar feed ↗</a></section>';
    return pageHead('01 / Market calendar', 'CHANGE IT ONCE.', 'One dated occurrence feeds public status, vendor availability, confirmed lineups, calendar feeds, and notices.', can('occurrences.manage') ? '<button class="ops-button ink" type="button" data-ops-toggle="occurrence-form">Add occurrence +</button>' : '') +
      calendarCallout +
      (can('occurrences.manage') ? occurrenceForm() : '') +
      resourceToolbar('occurrences', [['','All statuses'],['draft','Draft · private'],['published_listing','Published listing'],['scheduled','Scheduled'],['delayed','Delayed'],['cancelled','Cancelled']], true) + resourceNotice('occurrences') +
      '<section class="ops-record-grid" data-ops-list="occurrences">' + (items.length ? items.map(occurrenceCard).join('') : emptyCalendar) + '</section>' + resourcePageControls('occurrences');
  }

  function occurrenceForm(item) {
    item = item || {};
    var mode = occurrenceFormMode(item.id ? 'edit' : '');
    return '<form class="ops-form ops-form-drawer" data-ops-form="occurrence.save" data-drawer="occurrence-form" hidden novalidate><input type="hidden" name="id" value="' + attr(item.id || '') + '"><input type="hidden" name="version" value="' + attr(item.version == null ? '' : item.version) + '"><div class="ops-form-head"><div><span class="ops-kicker">Market occurrence</span><h2 data-ops-occurrence-heading>' + escapeHTML(mode.title) + '</h2></div><button type="button" data-ops-close="occurrence-form" aria-label="Close occurrence form">×</button></div><div class="ops-form-grid">' +
      field('Market ID', 'marketId', item.marketId, 'text', true, 'richardson') + field('Market name', 'name', item.name || item.marketName, 'text', true, 'Richardson Farmers Market') +
      field('Venue', 'venue', item.venue, 'text', true, 'Dal-Rich Towne Square') + field('Date', 'date', occurrenceDate(item), 'date', true) +
      field('Street address', 'address', item.address, 'text', true, '101 S Coit Rd', 'wide') + field('City', 'city', item.city, 'text', true, 'Richardson') + field('Postal code', 'postalCode', item.postalCode, 'text', true, '75080') +
      field('Starts (Central time)', 'startsAt', marketDateTimeInput(item.startsAt), 'datetime-local', true) + field('Ends (Central time)', 'endsAt', marketDateTimeInput(item.endsAt), 'datetime-local', true) +
      selectField('Status', 'status', item.status || 'draft', [['draft','Draft · private'],['published_listing','Published listing'],['scheduled','Scheduled'],['delayed','Delayed'],['cancelled','Cancelled']]) +
      field('Vendor cutoff (Central time)', 'bookingDeadlineAt', marketDateTimeInput(item.bookingDeadlineAt), 'datetime-local', false) + field('10 × 10 fee in dollars', 'fee10x10Dollars', item.fee10x10Cents == null ? '' : item.fee10x10Cents / 100, 'number', false, '45.00') +
      field('Booth capacity', 'capacity', item.capacity, 'number', false, '40') + checkboxField('Open this occurrence for booking requests after all operating-policy gates pass.', 'bookingsOpen', item.bookingsOpen === true) +
      area('Parking notes', 'parkingNotes', item.parkingNotes, 'Where vendors and shoppers should park.', 'wide') +
      area('Accessibility and venue notes', 'accessNotes', item.accessNotes, 'Step-free route, accessible parking, restrooms, pet rules, and contact details.', 'wide') +
      area('Load-in and status notes', 'loadInNotes', item.loadInNotes, 'Unload window, entry route, and clear context if the market is delayed or cancelled.', 'wide') +
      field('Source URL', 'sourceUrl', item.sourceUrl, 'url', true, 'https://www.fourseasonsmarkets.com/') + field('Source checked (Central time)', 'sourceCheckedAt', marketDateTimeInput(item.sourceCheckedAt), 'datetime-local', true) +
      '<input type="hidden" name="timeZone" value="America/Chicago">' +
      '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit" data-ops-occurrence-submit>' + escapeHTML(mode.submit) + '</button><p>No automatic charge or message is sent by this save.</p></div></form>';
  }

  function occurrenceCard(item) {
    var capacity = item.capacity == null ? NaN : Number(item.capacity), occupied = occupiedCount(item.id);
    var actionState = occurrenceActionState(item);
    var actions = can('checkin.manage') && actionState.roster ? '<a class="ops-link" href="#operations/roster?occurrenceId=' + encodeURIComponent(item.id) + '">Open day roster →</a>' : '';
    if (can('occurrences.manage')) {
      if (actionState.repeat) actions += '<button class="ops-link" type="button" data-ops-repeat-occurrence="' + attr(item.id) + '">Repeat date…</button>';
      actions += '<button class="ops-link" type="button" data-ops-edit-occurrence="' + attr(item.id) + '">Edit details</button>';
      if (actionState.delay) actions += '<button class="ops-link" type="button" data-ops-edit-occurrence="' + attr(item.id) + '" data-next-status="delayed">Mark delayed</button>';
      if (actionState.cancel) actions += '<button class="ops-link danger" type="button" data-ops-edit-occurrence="' + attr(item.id) + '" data-next-status="cancelled">Cancel market</button>';
    }
    return '<article class="ops-record" data-filter-status="' + attr(item.status || 'published_listing') + '"><div class="ops-record-head"><span class="' + statusClass(item.status) + '">' + escapeHTML(label(item.status || 'published_listing')) + '</span><span>Updated ' + escapeHTML(localDateTime(item.updatedAt)) + '</span></div><h2>' + escapeHTML(occurrenceName(item)) + '</h2><p class="ops-record-lead">' + escapeHTML(localDate(occurrenceDate(item))) + (occurrenceHours(item) ? ' · ' + escapeHTML(occurrenceHours(item)) : '') + '</p><dl><div><dt>Venue</dt><dd>' + escapeHTML(text(item.venue, 'Not set')) + '</dd></div><div><dt>Booking cutoff</dt><dd>' + escapeHTML(localDateTime(item.bookingDeadlineAt)) + '</dd></div><div><dt>Fee</dt><dd>' + escapeHTML(moneyCents(item.fee10x10Cents)) + '</dd></div><div><dt>Capacity</dt><dd>' + (Number.isFinite(capacity) ? occupied + ' / ' + capacity + ' allocated or occupied' : 'Not set') + '</dd></div></dl>' + (item.loadInNotes ? '<p class="ops-note">' + escapeHTML(item.loadInNotes) + '</p>' : '') + '<div class="ops-card-actions">' + actions + '</div></article>';
  }

  function applicationsView() {
    if (!isStaff()) return applicationVendorView();
    var items = resourceItems('applications', runtime.snapshot.applications).slice().sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    return pageHead('02 / Vendor applications', 'REVIEW THE BUSINESS ONCE.', 'Search the complete authorized record, then keep the decision and its explanation on the reusable application.', '') + resourceToolbar('applications', [['','All applications'],['submitted','Submitted'],['needs_info','Needs information'],['approved','Approved'],['rejected','Declined'],['withdrawn','Withdrawn']], false) + resourceNotice('applications') +
      '<section class="ops-review-list" data-ops-list="applications">' + (items.length ? items.map(applicationReviewCard).join('') : empty('No matching applications', 'Clear the filters or wait for a vendor to submit an application.', '')) + '</section>' + resourcePageControls('applications');
  }

  function applicationReviewCard(item) {
    var documents = array(item.documentIds);
    var actionable = can('applications.review') && ['submitted', 'needs_info'].indexOf(item.status) >= 0;
    var decisions = actionable ? '<aside><span class="ops-kicker">Decision</span><label for="decision-' + attr(item.id) + '">Reviewer note</label><textarea id="decision-' + attr(item.id) + '" rows="4" maxlength="2000" data-decision-note="' + attr(item.id) + '" placeholder="Explain the decision or give the vendor useful context."></textarea><label for="missing-' + attr(item.id) + '">Missing items for a response request</label><textarea id="missing-' + attr(item.id) + '" rows="3" maxlength="1200" data-missing-items="' + attr(item.id) + '" placeholder="One specific item per line">' + escapeHTML(array(item.missingItems).join('\n')) + '</textarea><div class="ops-action-stack"><button class="ops-button primary" type="button" data-ops-transition="application" data-id="' + attr(item.id) + '" data-status="approved">Approve</button>' + (item.status === 'submitted' ? '<button class="ops-button outline" type="button" data-ops-transition="application" data-id="' + attr(item.id) + '" data-status="needs_info">Request information</button>' : '') + '<button class="ops-link danger" type="button" data-ops-transition="application" data-id="' + attr(item.id) + '" data-status="rejected">Decline with reason</button></div></aside>' : '<aside><span class="ops-kicker">Review state</span><p>No valid staff decision is available from this status.</p></aside>';
    return '<article class="ops-review-card" data-filter-status="' + attr(item.status) + '"><div class="ops-review-main"><div class="ops-record-head"><span class="' + statusClass(item.status) + '">' + escapeHTML(label(item.status)) + '</span><span>' + escapeHTML(localDateTime(item.submittedAt || item.updatedAt)) + '</span></div><h2>' + escapeHTML(text(item.businessName || item.vendorName, 'Unnamed business')) + '</h2><p>' + escapeHTML(text(item.productDescription || item.description, 'No product description supplied.')) + '</p><div class="ops-chips">' + array(item.categories).map(function (x) { return '<span>' + escapeHTML(x) + '</span>'; }).join('') + '</div><dl><div><dt>Applicant</dt><dd>' + escapeHTML(text(item.contactName, 'Not supplied')) + '</dd></div><div><dt>Location</dt><dd>' + escapeHTML(text(item.city, 'Not supplied')) + '</dd></div><div><dt>Primary category</dt><dd>' + escapeHTML(text(item.primaryCategory, 'Not supplied')) + '</dd></div></dl>' + (documents.length ? '<div class="ops-document-list"><strong>Attached documents</strong>' + documents.map(function (fileId, index) { return '<button class="ops-link" type="button" data-ops-download-file="' + attr(fileId) + '">Document ' + (index + 1) + ' ↓</button>'; }).join('') + '</div>' : '') + (item.staffNote ? '<p class="ops-note"><strong>Last staff note:</strong> ' + escapeHTML(item.staffNote) + '</p>' : '') + '</div>' + decisions + '</article>';
  }

  function applicationVendorView() {
    var item = runtime.snapshot.applications[0] || {};
    var submitted = item.status && item.status !== 'draft';
    var canRespond = !item.status || ['draft', 'needs_info', 'needs_information', 'rejected', 'withdrawn'].indexOf(item.status) >= 0;
    var readOnly = '<section class="ops-panel"><span class="ops-kicker">Submitted business record</span><h2>' + escapeHTML(text(item.businessName, 'Vendor application')) + '</h2><p>' + escapeHTML(text(item.productDescription || item.description, 'No product description supplied.')) + '</p><div class="ops-chips">' + array(item.categories).map(function (category) { return '<span>' + escapeHTML(category) + '</span>'; }).join('') + '</div><div class="ops-card-actions"><a class="ops-link" href="#operations/support">Ask about this application →</a>' + (['submitted','approved'].indexOf(item.status) >= 0 ? '<button class="ops-link danger" type="button" data-ops-action="application.withdraw" data-id="' + attr(item.id) + '">Withdraw application</button>' : '') + '</div></section>';
    return pageHead('01 / Reusable application', submitted ? 'YOUR APPLICATION RECORD.' : 'TELL US WHAT YOU MAKE.', 'Business information is saved once and can support future market-date requests.', '') +
      (item.status ? '<section class="ops-decision-banner ' + attr(item.status) + '"><span class="' + statusClass(item.status) + '">' + escapeHTML(label(item.status)) + '</span><div><h2>' + (item.status === 'needs_info' || item.status === 'needs_information' ? 'THE REVIEWER NEEDS A RESPONSE.' : 'CURRENT APPLICATION STATUS') + '</h2><p>' + escapeHTML(text(item.staffNote || item.staffMessage || item.reviewNote, 'The market team has not added a message.')) + '</p>' + (array(item.missingItems).length ? '<ul>' + array(item.missingItems).map(function (missing) { return '<li>' + escapeHTML(missing) + '</li>'; }).join('') + '</ul>' : '') + '</div></section>' : '') +
      (canRespond ? applicationForm(item, submitted) : readOnly);
  }

  function applicationForm(item, submitted) {
    return '<form class="ops-form" data-ops-form="application.submit" novalidate><input type="hidden" name="id" value="' + attr(item.id || '') + '"><input type="hidden" name="version" value="' + attr(item.version == null ? '' : item.version) + '"><div class="ops-form-head"><div><span class="ops-kicker">One reusable business record</span><h2>' + (submitted ? 'UPDATE YOUR RESPONSE' : 'START THE REVIEW') + '</h2></div><span>About 5 minutes</span></div><div class="ops-form-grid">' +
      field('Business name', 'businessName', item.businessName, 'text', true, 'Your public business name') + field('Contact name', 'contactName', item.contactName, 'text', true, 'Person staff should contact') +
      field('Business city', 'city', item.city, 'text', true, 'City, Texas') + field('Phone', 'phone', item.phone, 'tel', false, 'For application questions') +
      area('What do you make or grow?', 'productDescription', item.productDescription || item.description, 'Describe the products you plan to sell. Do not include private credentials or financial data.', 'wide', true) +
      field('Categories', 'categories', array(item.categories).join(', '), 'text', true, 'Produce, baked goods, pantry') + field('Website or shop', 'website', item.website, 'url', false, 'https://') +
      area('Permits, licenses, and product notes', 'complianceNotes', item.complianceNotes, 'List what applies. Staff will identify market-specific document requirements.', 'wide') +
      field('Reusable document IDs', 'documentIds', array(item.documentIds).join(', '), 'text', false, 'Choose IDs from Account documents', 'wide') +
      '<div class="ops-field wide"><a class="ops-link" href="#account/documents">Upload or review reusable documents →</a><small>Upload once, then attach the returned document IDs here. Files remain account-scoped unless authorized staff review this application.</small></div>' +
      checkboxField('I confirm this application accurately describes the business and products.', 'attested', item.attested) +
      '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">' + (submitted ? 'Send updated response' : 'Submit application') + '</button><p>Submitting sends this record to authorized reviewers. It does not reserve a booth or charge a payment method.</p></div></form>';
  }

  function bookingsView() {
    if (!isStaff()) return vendorBookingsView();
    var items = resourceItems('bookings', runtime.snapshot.bookings).slice().sort(function (a, b) { return String(occurrenceDate(a)).localeCompare(String(occurrenceDate(b))); });
    return pageHead('03 / Booking control', 'PLACE EVERY VENDOR.', 'Search the authorized record, decide placement, and keep arrival work on the separate market-day roster.', can('checkin.manage') ? '<a class="ops-button ink" href="#operations/roster">Open market-day roster →</a>' : '') + resourceToolbar('bookings', [['','All bookings'],['requested','Requested'],['waitlisted','Waitlisted'],['approved','Approved'],['payment_due','Payment due'],['confirmed','Confirmed'],['attended','Attended'],['no_show','No-show'],['cancelled','Cancelled'],['rejected','Declined']], true) + resourceNotice('bookings') +
      '<section class="ops-booking-table" data-ops-list="bookings">' + (items.length ? items.map(bookingManagerRow).join('') : empty('No matching bookings', 'Clear the filters or wait for an approved vendor to submit a market-date request.', '')) + '</section>' + resourcePageControls('bookings');
  }

  function bookingManagerRow(item) {
    var transitions = {
      requested: [['waitlisted','Waitlist'],['approved','Approve'],['rejected','Decline'],['cancelled','Cancel']],
      waitlisted: [['approved','Approve'],['rejected','Decline'],['cancelled','Cancel']],
      approved: [['payment_due','Record fee due'],['confirmed','Confirm'],['cancelled','Cancel'],['credited','Credit']],
      payment_due: [['confirmed','Confirm'],['cancelled','Cancel'],['credited','Credit']],
      confirmed: [['attended','Check in'],['no_show','No-show'],['cancelled','Cancel'],['credited','Credit']],
      rejected: [['requested','Reopen request']], cancelled: [['requested','Reopen request'],['credited','Credit']], credited: [['requested','Reopen request']], no_show: [['credited','Credit']], attended: []
    };
    var available = array(transitions[item.status]).filter(function (entry) {
      if (['attended', 'no_show'].indexOf(entry[0]) >= 0) return can('checkin.manage');
      return can('bookings.manage');
    });
    var actions = can('bookings.manage') || can('checkin.manage') ? available.map(function (entry) { var danger = ['rejected','cancelled','credited','no_show'].indexOf(entry[0]) >= 0; return '<button' + (danger ? ' class="danger"' : '') + ' type="button" data-ops-transition="booking" data-id="' + attr(item.id) + '" data-status="' + attr(entry[0]) + '">' + escapeHTML(entry[1]) + '</button>'; }).join('') : '';
    return '<article data-filter-status="' + attr(item.status) + '"><div><span class="' + statusClass(item.status) + '">' + escapeHTML(label(item.status)) + '</span><h3>' + escapeHTML(bookingBusinessName(item)) + '</h3><p>' + escapeHTML(text(item.vendorNote, 'No vendor note')) + '</p></div><div><b>' + escapeHTML(text(item.marketName, 'Market')) + '</b><span>' + escapeHTML(localDate(occurrenceDate(item))) + '</span><span>' + escapeHTML(text(item.boothSize, '10 × 10')) + '</span><span>' + escapeHTML(item.feeCents == null ? 'Fee not set' : moneyCents(item.feeCents)) + '</span></div><div><label for="booking-note-' + attr(item.id) + '">Decision or arrival note</label><input id="booking-note-' + attr(item.id) + '" data-booking-note="' + attr(item.id) + '" value="' + attr(item.staffNote || '') + '" maxlength="2000"><label for="booking-fee-' + attr(item.id) + '">Fee in dollars <small>(used only for “Record fee due”)</small></label><input id="booking-fee-' + attr(item.id) + '" data-booking-fee="' + attr(item.id) + '" type="number" min="0" max="10000" step="0.01" value="' + attr(item.feeCents == null ? '' : item.feeCents / 100) + '"><div class="ops-row-actions">' + (actions || '<span class="ops-kicker">No available action</span>') + '</div></div></article>';
  }

  function bookingList(items, showActions) {
    if (!items.length) return empty('No market-date requests', 'Approved vendors can request a dated occurrence when availability is published.', '<a class="ops-link" href="#operations/my-bookings">Find market dates →</a>');
    return '<div class="ops-booking-list">' + items.map(function (item) { return '<article><div><span class="' + statusClass(item.status) + '">' + escapeHTML(label(item.status)) + '</span><h3>' + escapeHTML(text(item.marketName, 'Market')) + '</h3><p>' + escapeHTML(localDate(occurrenceDate(item))) + ' · ' + escapeHTML(text(item.boothSize, '10 × 10')) + '</p></div><div><strong>' + escapeHTML(item.feeCents != null ? moneyCents(item.feeCents) : 'Fee pending') + '</strong><small>' + escapeHTML(text(item.staffNote, 'No staff note')) + '</small>' + (showActions && ['requested','waitlisted','approved','payment_due','confirmed'].indexOf(item.status) >= 0 ? '<button class="ops-link danger" type="button" data-ops-cancel-booking="' + attr(item.id) + '">Cancel request</button>' : '') + '</div></article>'; }).join('') + '</div>';
  }

  function rosterOccurrenceOptions() {
    var today = currentChicagoDate();
    return runtime.snapshot.occurrences.filter(function (item) {
      return ['published_listing', 'scheduled', 'delayed'].indexOf(item.status || 'published_listing') >= 0;
    }).sort(function (a, b) {
      var aDate = String(occurrenceDate(a)).slice(0, 10), bDate = String(occurrenceDate(b)).slice(0, 10);
      var aFuture = aDate >= today, bFuture = bDate >= today;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return aFuture ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
    });
  }

  function rosterView() {
    var state = resourceState('roster');
    var options = rosterOccurrenceOptions();
    if (!state.filters.occurrenceId && options.length) state.filters.occurrenceId = options[0].id;
    var selectedOccurrence = state.occurrence || occurrenceById(state.filters.occurrenceId);
    var items = state.loaded ? state.items : [];
    var summary = state.summary || {};
    var expected = Number.isInteger(summary.expected) ? summary.expected : items.filter(function (item) { return item.status === 'confirmed'; }).length;
    var attended = Number.isInteger(summary.attended) ? summary.attended : items.filter(function (item) { return item.status === 'attended'; }).length;
    var noShow = Number.isInteger(summary.noShow) ? summary.noShow : items.filter(function (item) { return item.status === 'no_show'; }).length;
    var remaining = Math.max(0, expected - attended - noShow);
    var selector = '<form class="ops-roster-select" data-ops-roster-select><div class="ops-field"><label for="ops-roster-occurrence">Market day</label><select id="ops-roster-occurrence" name="occurrenceId" required><option value="">Choose a dated market</option>' + options.map(function (item) { return '<option value="' + attr(item.id) + '"' + selected(state.filters.occurrenceId, item.id) + '>' + escapeHTML(localDate(occurrenceDate(item)) + ' — ' + occurrenceName(item)) + '</option>'; }).join('') + '</select></div><div class="ops-field ops-search-field"><label for="ops-roster-q">Find vendor or slot</label><input id="ops-roster-q" name="q" maxlength="80" value="' + attr(state.filters.q || '') + '" placeholder="Business, public ID, or slot"></div><div class="ops-field"><label for="ops-roster-status">Arrival</label><select id="ops-roster-status" name="status"><option value=""' + selected(state.filters.status, '') + '>Everyone expected</option><option value="confirmed"' + selected(state.filters.status, 'confirmed') + '>Not checked in</option><option value="attended"' + selected(state.filters.status, 'attended') + '>Arrived</option><option value="no_show"' + selected(state.filters.status, 'no_show') + '>No-show</option></select></div><div class="ops-filter-actions"><button class="ops-button primary" type="submit">Open roster</button><button class="ops-link" type="button" data-ops-resource-reset="roster">Clear search</button></div></form>';
    var header = selectedOccurrence ? '<section class="ops-roster-head"><div class="ops-date-block"><strong>' + escapeHTML(localDate(occurrenceDate(selectedOccurrence)).split(',')[0]) + '</strong><span>' + escapeHTML(localDate(occurrenceDate(selectedOccurrence)).replace(/^[^,]+,\s*/, '')) + '</span></div><div><span class="ops-kicker">Selected market day</span><h2>' + escapeHTML(occurrenceName(selectedOccurrence)) + '</h2><p>' + escapeHTML(text(selectedOccurrence.venue, 'Venue not supplied')) + (occurrenceHours(selectedOccurrence) ? ' · ' + escapeHTML(occurrenceHours(selectedOccurrence)) : '') + '</p></div><div class="ops-roster-tools"><button class="ops-button outline" type="button" data-ops-print-roster>Print all matching rows</button><button class="ops-button ink" type="button" data-ops-export-matching="roster">Export matching rows CSV</button></div></section>' : '';
    var totals = selectedOccurrence ? '<section class="ops-roster-summary" aria-label="Arrival totals"><div><strong>' + expected + '</strong><span>Expected</span></div><div><strong>' + attended + '</strong><span>Arrived</span></div><div><strong>' + noShow + '</strong><span>No-show</span></div><div class="' + (remaining ? 'needs-action' : 'complete') + '"><strong>' + remaining + '</strong><span>Still to mark</span></div></section>' : '';
    var rows = items.length ? '<ol class="ops-roster-list">' + items.map(function (item) {
      var action = item.status === 'confirmed' ? '<div class="ops-roster-actions"><button class="ops-button primary" type="button" data-ops-roster-status="attended" data-id="' + attr(item.id) + '">Mark arrived</button><button class="ops-link danger" type="button" data-ops-roster-status="no_show" data-id="' + attr(item.id) + '">No-show…</button></div>' : '<span class="ops-roster-stamp ' + attr(item.status) + '">' + escapeHTML(label(item.status)) + '</span>';
      return '<li><span class="ops-roster-slot">' + escapeHTML(rosterSlot(item.slotNumber)) + '</span><div><span class="ops-kicker">' + escapeHTML(text(item.publicId, 'Vendor record')) + '</span><h3>' + escapeHTML(text(item.businessName, 'Vendor')) + '</h3><p>' + escapeHTML(text(item.boothSize, 'Booth size not set')) + '</p></div>' + action + '</li>';
    }).join('') + '</ol>' : state.loaded && selectedOccurrence ? empty('No matching vendors', 'Clear the roster search or arrival filter. Only confirmed, attended, and no-show records belong on this list.', '') : '';
    return pageHead('DAY / Market-day roster', 'CHECK IN THE LINEUP.', 'One selected occurrence, the minimum safe vendor details, and fast recorded arrival decisions.', '') +
      '<section class="ops-callout"><strong>Arrival record only.</strong><p>This view excludes contact details, documents, fees, and staff notes. Printing and export include only the selected, authorized market day.' + (runtime.snapshot.viewer.role === 'check_in' ? ' Check-in staff can mark arrival after the market starts and no-show after it ends.' : '') + '</p></section>' + selector + resourceNotice('roster') + header + totals + rows + resourcePageControls('roster');
  }

  function vendorBookingsView() {
    var approvedApplication = runtime.snapshot.applications.find(function (x) { return x.status === 'approved'; });
    var existingOccurrenceIds = new Set(runtime.snapshot.bookings.map(function (x) { return x.occurrenceId; }));
    var now = Date.now();
    var rulesLive = operatingRecordAuthorized();
    var options = rulesLive ? runtime.snapshot.occurrences.filter(function (x) { return x.bookingsOpen === true && ['scheduled', 'delayed'].indexOf(x.status) >= 0 && x.bookingDeadlineAt && Date.parse(x.bookingDeadlineAt) > now && !existingOccurrenceIds.has(x.id); }) : [];
    return pageHead('02 / Market dates', 'REQUEST A DATED MARKET.', 'Availability and the current decision stay visible from request through market day.', '') +
      (!approvedApplication ? '<section class="ops-callout warning"><strong>Application approval required.</strong><p>Finish the reusable business application before requesting a market date.</p><a class="ops-link" href="#operations/apply">Open application →</a></section>' : !rulesLive ? '<section class="ops-callout warning"><strong>Booking requests are not activated.</strong><p>The organizer must approve the operating rules, record authority, and activate operations before request forms appear.</p></section>' : options.length ? bookingRequestForm(options, approvedApplication.id) : '<section class="ops-callout"><strong>No new booking dates are open.</strong><p>Published dates appear here only while organizer-authorized bookings are open and the deadline has not passed.</p></section>') +
      '<section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Saved history</span><h2>YOUR REQUESTS</h2></div><span>' + runtime.snapshot.bookings.length + ' total</span></div>' + bookingList(runtime.snapshot.bookings, true) + '</section>';
  }

  function bookingRequestForm(options, applicationId) {
    return '<form class="ops-form compact" data-ops-form="booking.request" novalidate><input type="hidden" name="applicationId" value="' + attr(applicationId) + '"><div class="ops-form-head"><div><span class="ops-kicker">New request</span><h2>CHOOSE AN AVAILABLE OCCURRENCE</h2></div><span>Request · not confirmation</span></div><div class="ops-form-grid">' +
      '<div class="ops-field wide"><label for="ops-occurrence">Market and date</label><select id="ops-occurrence" name="occurrenceId" required><option value="">Choose a dated market</option>' + options.map(function (x) { return '<option value="' + attr(x.id) + '">' + escapeHTML(occurrenceName(x) + ' — ' + localDate(occurrenceDate(x)) + (x.status === 'delayed' ? ' — DELAYED' : '')) + '</option>'; }).join('') + '</select></div>' +
      selectField('Booth footprint', 'boothSize', '10x10', [['10x10','10 × 10 ft'],['20x10','20 × 10 ft']]) +
      area('Equipment, access, or arrival notes', 'vendorNote', '', 'Anything staff should consider before deciding. Do not include payment information.', 'wide') +
      '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">Submit market request</button><p>This asks for review. It does not allocate inventory or collect payment.</p></div></form>';
  }

  function visitsView() {
    var items = runtime.snapshot.bookings.filter(function (x) { return ['confirmed', 'attended'].indexOf(x.status) >= 0; });
    return pageHead('03 / Confirmed market days', 'KNOW BEFORE YOU LOAD IN.', 'Only staff-confirmed dates appear here. Current arrival instructions remain attached to the booking.', '') +
      (items.length ? '<section class="ops-visit-grid">' + items.map(function (x) { var occurrence = occurrenceById(x.occurrenceId) || {}; return '<article><div class="ops-ticket-top"><span class="' + statusClass(x.status) + '">' + escapeHTML(label(x.status)) + '</span><strong>' + escapeHTML(localDate(occurrenceDate(x))) + '</strong></div><h2>' + escapeHTML(text(x.marketName, occurrenceName(occurrence))) + '</h2><p>' + escapeHTML(text(occurrence.venue, 'Venue details pending')) + '</p><dl><div><dt>Hours</dt><dd>' + escapeHTML(text(occurrenceHours(occurrence), 'Not supplied')) + '</dd></div><div><dt>Booth</dt><dd>' + escapeHTML(x.slotNumber ? 'Slot ' + x.slotNumber + ' · ' + text(x.boothSize) : text(x.boothSize, 'Not assigned')) + '</dd></div><div><dt>Parking / unload</dt><dd>' + escapeHTML(text(occurrence.parkingNotes || occurrence.loadInNotes, 'Not supplied')) + '</dd></div><div><dt>Access</dt><dd>' + escapeHTML(text(occurrence.accessNotes, 'Not supplied')) + '</dd></div></dl><p class="ops-note">' + escapeHTML(text(x.staffNote || occurrence.loadInNotes, 'Check back before traveling in case staff updates these instructions.')) + '</p></article>'; }).join('') + '</section>' : empty('No confirmed dates yet', 'A market appears here after authorized staff confirm the booking.', '<a class="ops-link" href="#operations/my-bookings">Review market requests →</a>'));
  }

  function staffView() {
    var members = runtime.snapshot.staff;
    var invites = runtime.snapshot.staffInvites;
    if (!can('staff.manage')) return pageHead('04 / Team access', 'ACCESS IS SCOPED.', 'Your role can view operations but cannot manage staff access.', '') + empty('Staff management unavailable', 'An owner or administrator can change team access.', '');
    return pageHead('04 / Team access', 'EVERY PERSON. THEIR OWN KEY.', 'Create a one-time token, let the teammate accept it from their own verified account, then explicitly approve access.', '<button class="ops-button ink" type="button" data-ops-toggle="staff-form">Create invitation +</button>') + staffInviteForm() +
      '<section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Two-step access</span><h2>PENDING INVITATIONS</h2></div><span>' + invites.length + ' records</span></div><div class="ops-team-list">' + (invites.length ? invites.map(function (invite) { var ready = invite.acceptedAt && !invite.approvedAt && !invite.revokedAt && Number(invite.expiresAt) > Date.now(); var state = invite.revokedAt ? 'Revoked' : invite.approvedAt ? 'Approved' : invite.acceptedAt ? 'Awaiting staff approval' : Number(invite.expiresAt) <= Date.now() ? 'Expired' : 'Awaiting acceptance'; return '<article><div class="ops-avatar">' + escapeHTML(invite.applicant && text(invite.applicant.displayName, '?').slice(0,2).toUpperCase() || '→') + '</div><div><span class="' + statusClass(invite.approvedAt ? 'active' : 'pending') + '">' + escapeHTML(state) + '</span><h2>' + escapeHTML(label(invite.role)) + '</h2><p>Expires ' + escapeHTML(localDateTime(invite.expiresAt)) + '</p></div><div><b>Market scope</b><span>' + escapeHTML(array(invite.marketScopes).join(', ') || 'All authorized markets') + '</span></div>' + (ready ? '<button class="ops-button primary" type="button" data-ops-approve-invite="' + attr(invite.id) + '">Approve verified applicant</button>' : '') + '</article>'; }).join('') : empty('No staff invitations', 'Create an invitation when a teammate is ready to use their own account.', '')) + '</div></section>' +
      '<section class="ops-team-list">' + (members.length ? members.map(function (m) { return '<article><div class="ops-avatar">' + escapeHTML(text(m.displayName, '?').slice(0,2).toUpperCase()) + '</div><div><span class="' + statusClass(m.status || 'active') + '">' + escapeHTML(label(m.status || 'active')) + '</span><h2>' + escapeHTML(text(m.displayName, 'Staff member')) + '</h2><p>' + escapeHTML(text(m.subject, 'Verified account')) + '</p></div><div><b>' + escapeHTML(label(m.role)) + '</b><span>' + escapeHTML(array(m.marketScopes).length ? array(m.marketScopes).join(', ') : 'All authorized markets') + '</span></div>' + (m.role === 'owner' ? '<span class="ops-kicker">Protected owner</span>' : '<button class="ops-link" type="button" data-ops-edit-staff data-issuer="' + attr(m.issuer) + '" data-subject="' + attr(m.subject) + '">Change access</button>') + '</article>'; }).join('') : empty('No staff memberships', 'The verified owner can invite the first operations teammate.', '')) + '</section>';
  }

  function staffInviteForm() {
    return '<form class="ops-form ops-form-drawer" data-ops-form="staff.invite" data-drawer="staff-form" hidden novalidate><div class="ops-form-head"><div><span class="ops-kicker">Scoped invitation</span><h2>GIVE THE RIGHT ACCESS</h2></div><button type="button" data-ops-close="staff-form" aria-label="Close staff form">×</button></div><div class="ops-form-grid">' + selectField('Role', 'role', 'operations', [['admin','Administrator'],['operations','Operations'],['market_manager','Market manager'],['vendor_reviewer','Vendor reviewer'],['content','Content'],['finance','Finance'],['check_in','Check-in staff'],['readonly','Read only']]) + field('Market access', 'marketScopes', '', 'text', false, 'Comma-separated market IDs; required for market manager and check-in') + field('Token expires after hours', 'expiresInHours', 48, 'number', true, '48') + '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">Create one-time token</button><p>No email is sent. Copy the token to the intended teammate through a trusted channel. Acceptance creates a pending request; it does not grant access until staff approves it here.</p></div></form>';
  }

  function inviteView() {
    return pageHead('Staff invitation', 'ACCEPT YOUR INVITATION.', 'Sign in with your own email/password or Google account, then paste the one-time token supplied by the market owner.', '') +
      '<form class="ops-form compact" data-ops-form="staff.invite.accept" novalidate><div class="ops-form-grid">' + field('One-time invitation token', 'token', '', 'text', true, 'staff_…', 'wide') + '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">Submit for staff approval</button><p>Acceptance does not grant access immediately. An authorized owner or administrator must approve the verified applicant.</p></div></form>';
  }

  function policiesView() {
    var p = runtime.snapshot.policies;
    return pageHead('08 / Operating rules', 'DECIDE THE RULE ONCE.', 'The owner records the authoritative deadline, capacity, cancellation, weather, credit, and publishing rules staff must follow.', '') +
      '<section class="ops-callout warning"><strong>Policy setup controls what can safely become automatic.</strong><p>Payment remains unavailable until fees, cancellations, credits, refunds, reconciliation ownership, and an approved provider are configured.</p></section>' +
      '<form class="ops-form" data-ops-form="policies.save" novalidate><input type="hidden" name="version" value="' + attr(p.version == null ? 0 : p.version) + '"><div class="ops-form-head"><div><span class="ops-kicker">Owner decisions</span><h2>CORE OPERATING POLICY</h2></div><span>' + (p.activatedAt ? 'ACTIVE' : 'DRAFT · BOOKINGS LOCKED') + '</span></div><div class="ops-form-grid">' +
      area('Booking deadline policy', 'bookingDeadlinePolicy', p.bookingDeadlinePolicy, 'State the exact cutoff and timezone, including exceptions.', 'wide', true) + area('Cancellation policy', 'cancellationPolicy', p.cancellationPolicy, 'Vendor cancellations, organizer cancellations, no-shows, and timing.', 'wide', true) +
      area('Weather decision policy', 'weatherPolicy', p.weatherPolicy, 'Who decides, by when, and which channels carry the official status.', 'wide', true) + area('Credit and refund policy', 'creditRefundPolicy', p.creditRefundPolicy, 'When a credit or refund is due and who may issue it.', 'wide', true) +
      area('Payment and reconciliation policy', 'paymentPolicy', p.paymentPolicy, 'Approved provider, fee authority, reconciliation owner, charge timing, and dispute handling. Recording this does not connect a payment processor.', 'wide', true) +
      field('Support and after-hours contact', 'supportContact', p.supportContact, 'text', true, 'Role, phone/email, and escalation hours', 'wide') +
      checkboxField('I have reviewed and approved the complete policy text above.', 'approved', p.approved === true) +
      checkboxField('I am authorized by the market organizer to designate this system as an official operations record.', 'operatorAuthorized', p.operatorAuthorized === true) +
      checkboxField('Activate the approved, organizer-authorized rules and allow eligible occurrence records to open booking requests.', 'activate', !!p.activatedAt) +
      '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">Save operating rules</button><p>Saving records the change. It does not enable payments or external messaging.</p></div></form>';
  }

  function notificationsView() {
    var items = isStaff() ? resourceItems('notifications', runtime.snapshot.notifications) : runtime.snapshot.notifications;
    var unread = items.filter(function (x) { return !x.readAt && x.read !== true; }).length;
    return pageHead(isStaff() ? '05 / Notification center' : '04 / Account messages', 'THE UPDATE AND ITS DELIVERY.', isStaff() ? 'Operational notices stay in the signed-in account with the delivery state returned by the service.' : 'Application, booking, and market-day updates stay attached to your account.', unread ? '<button class="ops-button outline" type="button" data-ops-read-all>Mark all read</button>' : '') +
      (isStaff() ? resourceToolbar('notifications', [['','All notices'],['unread','Unread'],['read','Read']], false) + resourceNotice('notifications') : '') + '<div class="ops-notice-layout"><section class="ops-notice-list">' + (items.length ? items.map(function (n) { var delivery = Object.keys(n.delivery || {}).map(function (key) { return key + ': ' + n.delivery[key]; }).join(' · '); var href = typeof n.href === 'string' && /^#operations(?:\/|$)/.test(n.href) ? '<a class="ops-link" href="' + attr(n.href) + '">Open related record →</a>' : ''; return '<article class="' + (!n.readAt && n.read !== true ? 'is-unread' : '') + '"><div><span class="ops-kicker">' + escapeHTML(label(n.kind || n.type || n.channel || 'Update')) + '</span><h2>' + escapeHTML(text(n.title, 'Account update')) + '</h2><p>' + escapeHTML(text(n.message || n.body)) + '</p><small>' + escapeHTML(localDateTime(n.createdAt)) + ' · ' + escapeHTML(delivery || n.deliveryStatus || 'In-account record') + '</small>' + href + '</div>' + (!n.readAt && n.read !== true ? '<button class="ops-link" type="button" data-ops-action="notification.read" data-id="' + attr(n.id) + '">Mark read</button>' : '') + '</article>'; }).join('') : empty('No matching account messages', 'Clear the search or wait for a new operational update.', '')) + (isStaff() ? resourcePageControls('notifications') : '') + '</section>' + preferencePanel() + '</div>';
  }

  function preferencePanel() {
    return '<aside class="ops-panel ops-preferences"><span class="ops-kicker">Delivery status</span><h2>IN-ACCOUNT FIRST.</h2><p>These notices are saved with the signed-in account. Email and text delivery remain inactive until the organizer connects verified sending services, records consent rules, and tests delivery.</p><a class="ops-link" href="#account">Review account details →</a></aside>';
  }

  function moderationView() {
    var items = resourceItems('reports', runtime.snapshot.reports);
    var canModerateVendor = runtime.snapshot.viewer.role !== 'market_manager' && can('moderation.manage');
    return pageHead('06 / Public content review', 'KEEP THE DIRECTORY TRUSTWORTHY.', 'Visitor reports, staff resolution, and separate vendor suspension or reinstatement actions stay recorded.', '') + resourceToolbar('reports', [['','All reports'],['open','Open'],['reviewing','Reviewing'],['resolved','Resolved'],['dismissed','Dismissed']], false) + resourceNotice('reports') +
      '<section class="ops-review-list">' + (items.length ? items.map(function (r) { var actions = '<div class="ops-action-stack">' + (['resolved','dismissed'].indexOf(r.status) < 0 ? '<button class="ops-button primary" type="button" data-ops-transition="report" data-id="' + attr(r.id) + '" data-status="resolved">Resolve report</button><button class="ops-button outline" type="button" data-ops-transition="report" data-id="' + attr(r.id) + '" data-status="dismissed">Dismiss report</button>' : '') + (canModerateVendor && r.publicVendorId ? '<button class="ops-link danger" type="button" data-ops-moderate-vendor="' + attr(r.publicVendorId) + '" data-status="suspended">Suspend vendor profile</button><button class="ops-link" type="button" data-ops-moderate-vendor="' + attr(r.publicVendorId) + '" data-status="active">Reinstate vendor profile</button>' : '') + '</div>'; return '<article class="ops-review-card"><div class="ops-review-main"><div class="ops-record-head"><span class="' + statusClass(r.status) + '">' + escapeHTML(label(r.status)) + '</span><span>' + escapeHTML(localDateTime(r.createdAt)) + '</span></div><h2>' + escapeHTML(text(r.businessName || r.subject, 'Directory report')) + '</h2><p>' + escapeHTML(text(r.reason || r.details || r.message)) + '</p><dl><div><dt>Reported item</dt><dd>' + escapeHTML(text(r.targetType, 'Profile')) + '</dd></div><div><dt>Contact supplied</dt><dd>' + escapeHTML(text(r.contact, 'None')) + '</dd></div></dl></div><aside><label for="report-note-' + attr(r.id) + '">Report resolution</label><textarea id="report-note-' + attr(r.id) + '" rows="5" maxlength="2000" data-report-note="' + attr(r.id) + '"></textarea>' + actions + '</aside></article>'; }).join('') : empty('No matching reports', 'Clear the filters or wait for a new directory report.', '')) + '</section>' + resourcePageControls('reports');
  }

  function supportView() {
    var items = isStaff() ? resourceItems('inquiries', runtime.snapshot.threads.concat(runtime.snapshot.partners)) : runtime.snapshot.threads.concat(runtime.snapshot.partners);
    return pageHead(isStaff() ? '07 / Shared operations inbox' : '05 / Support', isStaff() ? 'KEEP THE CONTEXT WITH THE QUESTION.' : 'ASK ON THE RIGHT RECORD.', isStaff() ? 'Vendor and partner inquiries, internal notes, and resolution status stay visible to authorized staff.' : 'Include the relevant application, booking, profile, or market ID so staff can review the right record.', '<button class="ops-button ink" type="button" data-ops-toggle="support-form">New inquiry +</button>') + supportForm() + (isStaff() ? resourceToolbar('inquiries', [['','All inquiries'],['new','New'],['in_progress','In progress'],['closed','Closed']], false) + resourceNotice('inquiries') : '') +
      '<section class="ops-thread-list">' + (items.length ? items.map(function (t) { var notes = runtime.snapshot.inquiryMessages.filter(function (message) { return message.inquiryId === t.id; }); return '<article><div class="ops-record-head"><span class="' + statusClass(t.status || 'open') + '">' + escapeHTML(label(t.status || 'open')) + '</span><span>' + escapeHTML(localDateTime(t.updatedAt || t.createdAt)) + '</span></div><h2>' + escapeHTML(text(t.subject, t.organization || label(t.kind || 'support') + ' inquiry')) + '</h2><p>' + escapeHTML(text(t.preview || t.lastMessage || t.message)) + '</p><div class="ops-thread-meta"><span>' + escapeHTML(text(t.name, 'Unknown sender')) + '</span><span>' + escapeHTML(label(t.kind || 'support')) + '</span></div>' + (notes.length ? '<div class="ops-note"><strong>Internal notes</strong><ul>' + notes.slice().reverse().map(function (note) { return '<li>' + escapeHTML(note.body) + '</li>'; }).join('') + '</ul></div>' : '') + (isStaff() ? '<div class="ops-card-actions"><button class="ops-link" type="button" data-ops-note-inquiry="' + attr(t.id) + '">Add internal note →</button><button class="ops-link" type="button" data-ops-resolve-inquiry="' + attr(t.id) + '">Record internal resolution →</button></div>' : '<span class="ops-kicker">This form saves a staff-review record; it does not send an email.</span>') + '</article>'; }).join('') : empty('No matching inquiries', 'Clear the filters or wait for a new vendor or partner inquiry.', '')) + (isStaff() ? resourcePageControls('inquiries') : '') + '</section>';
  }

  function supportForm() {
    return '<form class="ops-form ops-form-drawer" data-ops-form="inquiry.submit" data-public-operation="true" data-drawer="support-form" hidden novalidate><div class="ops-form-head"><div><span class="ops-kicker">Shared inquiry</span><h2>START WITH THE CONTEXT</h2></div><button type="button" data-ops-close="support-form" aria-label="Close inquiry form">×</button></div><div class="ops-form-grid">' + selectField('Inquiry type', 'kind', 'support', [['support','Vendor or customer support'],['property','Property / market location'],['sponsor','Sponsor / partner'],['media','Media']]) + field('Name', 'name', runtime.snapshot && runtime.snapshot.viewer.displayName, 'text', true, 'Your name') + field('Reply email', 'email', '', 'email', true, 'you@example.com') + field('Phone', 'phone', '', 'tel', false, 'Optional callback number') + field('Organization', 'organization', '', 'text', false, 'Business, city, or organization') + area('Message', 'message', '', 'Include the relevant application, booking, profile, or market ID in the message when applicable. Do not send passwords or payment-card data.', 'wide', true) + '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">Submit inquiry</button><p>This saves an inquiry for staff review. It does not prove that an email was sent or delivered.</p></div></form>';
  }

  function dataView() {
    var audit = resourceItems('audit', runtime.snapshot.audit);
    var backup = runtime.latestBackup;
    var preview = runtime.backupPreview;
    var ownerOrAdmin = ['owner', 'admin'].indexOf(runtime.snapshot.viewer.role) >= 0;
    return pageHead('09 / Records and recovery', 'TAKE THE RECORD WITH YOU.', 'Portable exports, activity history, verified snapshots, and non-destructive restore previews keep the operating record recoverable.', can('data.export') ? '<button class="ops-button ink" type="button" data-ops-export="full">Download visible archive</button>' : '') +
      '<section class="ops-data-grid"><article class="ops-board green"><span class="ops-kicker">Portable records</span><h2>EXPORT BY OPERATING AREA</h2><p>These downloads contain the records currently returned to this signed-in role.</p><div class="ops-export-buttons"><button type="button" data-ops-export="applications">Applications CSV</button><button type="button" data-ops-export="bookings">Bookings CSV</button><button type="button" data-ops-export="occurrences">Market calendar CSV</button><button type="button" data-ops-export="full">Visible JSON</button></div></article><article class="ops-panel"><span class="ops-kicker">Database recovery</span><h2>' + (preview ? 'PREVIEW VERIFIED' : backup ? 'SNAPSHOT CREATED' : 'NO SNAPSHOT SELECTED') + '</h2><p>Server snapshots are integrity-checked before preview. Restore is owner-only, preserves current rows, and returns only records missing from the current database.</p><p class="ops-note"><strong>Coverage:</strong> A server snapshot covers database rows. Uploaded photos and documents need a separate file backup before launch.</p>' + (ownerOrAdmin ? '<button class="ops-button primary" type="button" data-ops-backup-create>Create server snapshot</button><form class="ops-inline-form" data-ops-backup-preview><label for="ops-backup-id">Snapshot ID</label><input id="ops-backup-id" name="id" required value="' + attr(backup && backup.id || preview && preview.id || '') + '" placeholder="backup_…"><button class="ops-button outline" type="submit">Verify restore preview</button></form>' : '<p>Your role can export visible data but cannot create or restore server snapshots.</p>') + (backup ? '<p class="ops-note"><strong>Latest snapshot:</strong> ' + escapeHTML(backup.id) + '<br><strong>Integrity hash:</strong> ' + escapeHTML(backup.sha256) + '</p>' : '') + (preview ? '<div class="ops-note"><strong>Restore mode:</strong> Missing records only<br><strong>Created:</strong> ' + escapeHTML(localDateTime(preview.createdAt)) + '<br><strong>Snapshot counts:</strong> ' + escapeHTML(Object.keys(preview.counts || {}).map(function (key) { return key + ' ' + preview.counts[key]; }).join(' · ')) + '</div>' + (runtime.snapshot.viewer.role === 'owner' ? '<button class="ops-button danger" type="button" data-ops-backup-restore="' + attr(preview.id) + '">Restore missing records…</button>' : '') : '') + '</article></section>' +
      '<section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Launch connection checklist</span><h2>WHAT STILL NEEDS AN OWNER DECISION?</h2></div><span>Independent proposal status</span></div><div class="ops-checklist"><p><strong>Official authority:</strong> organizer approval, staff roles, market scopes, and operating policies.</p><p><strong>Domain and sender:</strong> final domain, DNS control, verified email sender, consent and unsubscribe rules, and real inbox delivery tests.</p><p><strong>Text messages:</strong> provider, sender registration, explicit opt-in records, quiet hours, STOP handling, and device delivery tests.</p><p><strong>Payments:</strong> approved provider and account owner, fee authority, refund/credit rules, reconciliation, disputes, and test transactions before any live charge path.</p><p><strong>Migration:</strong> source inventory, deduplication, record ownership, document retention, rehearsal import, reconciliation, and signed cutover approval.</p></div></section>' +
      '<section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Activity history</span><h2>WHO CHANGED WHAT?</h2></div></div>' + resourceToolbar('audit', [['','All activity']], false) + resourceNotice('audit') + '<div class="ops-audit-list">' + (audit.length ? audit.map(function (e) { return '<article><span>' + escapeHTML(localDateTime(e.createdAt || e.at)) + '</span><strong>' + escapeHTML(text(e.actorRole || e.actorSubject || e.actor, 'System')) + '</strong><b>' + escapeHTML(label(e.action)) + '</b><p>' + escapeHTML(text(e.summary || e.reason || e.entityType + ' ' + e.entityId)) + '</p></article>'; }).join('') : '<p>No matching activity events returned.</p>') + '</div>' + resourcePageControls('audit') + '</section>';
  }

  function marketOptions() {
    var seen = {};
    return runtime.snapshot.occurrences.reduce(function (result, item) {
      var id = text(item.marketId);
      if (!id || seen[id]) return result;
      seen[id] = true;
      result.push([id, occurrenceName(item)]);
      return result;
    }, []).sort(function (a, b) { return a[1].localeCompare(b[1]); });
  }

  function resourceToolbar(resource, statusOptions, allowDates) {
    var state = resourceState(resource);
    var filters = state.filters;
    var total = state.loaded && Number.isInteger(state.pageInfo.total) ? state.pageInfo.total : array(runtime.snapshot[resource]).length;
    var markets = marketOptions();
    var resetLabel = resource === 'occurrences' && filters.dateFrom && Object.keys(filters).length === 1 ? 'Show all dates' : 'Clear filters';
    return '<form class="ops-resource-toolbar" data-ops-resource-filter="' + attr(resource) + '">' +
      '<div class="ops-field ops-search-field"><label for="ops-' + attr(resource) + '-q">Search</label><input id="ops-' + attr(resource) + '-q" name="q" value="' + attr(filters.q || '') + '" maxlength="80" placeholder="Business, ID, market…"></div>' +
      '<div class="ops-field"><label for="ops-' + attr(resource) + '-status">Status</label><select id="ops-' + attr(resource) + '-status" name="status">' + statusOptions.map(function (option) { return '<option value="' + attr(option[0]) + '"' + selected(filters.status, option[0]) + '>' + escapeHTML(option[1]) + '</option>'; }).join('') + '</select></div>' +
      (markets.length ? '<div class="ops-field"><label for="ops-' + attr(resource) + '-market">Market</label><select id="ops-' + attr(resource) + '-market" name="marketId"><option value="">All authorized markets</option>' + markets.map(function (option) { return '<option value="' + attr(option[0]) + '"' + selected(filters.marketId, option[0]) + '>' + escapeHTML(option[1]) + '</option>'; }).join('') + '</select></div>' : '') +
      (allowDates ? '<div class="ops-field"><label for="ops-' + attr(resource) + '-from">From</label><input id="ops-' + attr(resource) + '-from" name="dateFrom" type="date" value="' + attr(filters.dateFrom || '') + '"></div><div class="ops-field"><label for="ops-' + attr(resource) + '-to">Through</label><input id="ops-' + attr(resource) + '-to" name="dateTo" type="date" value="' + attr(filters.dateTo || '') + '"></div>' : '') +
      '<div class="ops-filter-actions"><button class="ops-button primary" type="submit">Apply filters</button><button class="ops-link" type="button" data-ops-resource-reset="' + attr(resource) + '">' + escapeHTML(resetLabel) + '</button></div>' +
      '<div class="ops-filter-scope"><strong>' + escapeHTML(String(total)) + '</strong><span>matching records in your authorized scope</span>' + (can('data.export') || resource === 'roster' ? '<button class="ops-link" type="button" data-ops-export-matching="' + attr(resource) + '">Export all matching CSV ↓</button>' : '') + '</div>' +
    '</form>';
  }

  function resourcePageControls(resource) {
    var state = resourceState(resource);
    if (!state.loaded || !state.items.length && !state.previous.length || state.pageInfo.total <= state.pageInfo.limit && !state.previous.length) return '';
    var pageNumber = state.previous.length + 1;
    var start = state.previous.length * Number(state.pageInfo.limit || 50) + (state.items.length ? 1 : 0);
    var end = state.previous.length * Number(state.pageInfo.limit || 50) + state.items.length;
    return '<nav class="ops-pagination" aria-label="' + escapeHTML(label(resource)) + ' pages"><span>Page ' + pageNumber + ' · ' + start + '–' + end + ' of ' + escapeHTML(String(state.pageInfo.total)) + '</span><div><button class="ops-button outline" type="button" data-ops-page="previous" data-resource="' + attr(resource) + '"' + (state.previous.length ? '' : ' disabled') + '>← Previous</button><button class="ops-button outline" type="button" data-ops-page="next" data-resource="' + attr(resource) + '"' + (state.pageInfo.hasMore && state.pageInfo.nextCursor ? '' : ' disabled') + '>Next →</button></div></nav>';
  }

  function resourceNotice(resource) {
    var state = resourceState(resource);
    if (state.error) return '<section class="ops-limit-warning" role="alert"><strong>LIST NOT REFRESHED</strong><p>' + escapeHTML(state.error) + '</p><button class="ops-link" type="button" data-ops-resource-retry="' + attr(resource) + '">Try this list again</button></section>';
    if (state.loading) return '<p class="ops-resource-loading" role="status">Updating the authorized list…</p>';
    return '';
  }

  function field(labelText, name, value, type, required, placeholder, extraClass) {
    var numeric = type === 'number' ? (name === 'fee10x10Dollars' ? ' min="0" max="10000" step="0.01"' : name === 'capacity' ? ' min="1" max="2000" step="1"' : name === 'expiresInHours' ? ' min="1" max="168" step="1"' : ' step="1"') : '';
    return '<div class="ops-field ' + attr(extraClass || '') + '"><label for="ops-' + attr(name) + '">' + escapeHTML(labelText) + (required ? ' <span aria-hidden="true">*</span>' : ' <small>Optional</small>') + '</label><input id="ops-' + attr(name) + '" name="' + attr(name) + '" type="' + attr(type || 'text') + '" value="' + attr(value == null ? '' : value) + '"' + numeric + (placeholder ? ' placeholder="' + attr(placeholder) + '"' : '') + (required ? ' required' : '') + '></div>';
  }

  function area(labelText, name, value, placeholder, extraClass, required) {
    return '<div class="ops-field ' + attr(extraClass || '') + '"><label for="ops-' + attr(name) + '">' + escapeHTML(labelText) + (required ? ' <span aria-hidden="true">*</span>' : ' <small>Optional</small>') + '</label><textarea id="ops-' + attr(name) + '" name="' + attr(name) + '" rows="4" maxlength="1600"' + (placeholder ? ' placeholder="' + attr(placeholder) + '"' : '') + (required ? ' required' : '') + '>' + escapeHTML(value || '') + '</textarea></div>';
  }

  function selectField(labelText, name, value, options) {
    return '<div class="ops-field"><label for="ops-' + attr(name) + '">' + escapeHTML(labelText) + '</label><select id="ops-' + attr(name) + '" name="' + attr(name) + '">' + options.map(function (x) { return '<option value="' + attr(x[0]) + '"' + selected(value, x[0]) + '>' + escapeHTML(x[1]) + '</option>'; }).join('') + '</select></div>';
  }

  function checkboxField(labelText, name, value) {
    return '<label class="ops-check wide"><input type="checkbox" name="' + attr(name) + '"' + checked(value) + '><span>' + escapeHTML(labelText) + '</span></label>';
  }

  function viewForSection() {
    var allowed = isStaff() ? STAFF_SECTIONS : VENDOR_SECTIONS;
    if (allowed.indexOf(runtime.section) < 0) runtime.section = 'overview';
    if (isStaff()) {
      if (runtime.snapshot.viewer.role === 'check_in' && ['applications', 'bookings'].indexOf(runtime.section) >= 0) return pageHead('Scoped staff access', 'MARKET-DAY DETAILS ONLY.', 'Check-in staff use the selected occurrence roster. Applications, fees, documents, and general booking administration stay concealed.', '<a class="ops-button primary" href="#operations/roster">Open market-day roster →</a>');
      var required = { roster: 'checkin.manage', staff: 'staff.manage', policies: 'policies.manage', moderation: 'moderation.manage', support: 'inquiries.manage', data: 'data.export' }[runtime.section];
      var backupRole = runtime.section === 'data' && ['owner', 'admin'].indexOf(runtime.snapshot.viewer.role) >= 0;
      if (required && !can(required) && !backupRole) return pageHead('Scoped staff access', 'THIS ROLE DOES NOT HOLD THAT KEY.', 'An owner or administrator can change staff responsibilities and market scopes from Team access.', '<a class="ops-button outline" href="#operations">Return to control board →</a>');
    }
    var views = { overview: overviewView, calendar: calendarView, applications: applicationsView, bookings: bookingsView, roster: rosterView, staff: staffView, policies: policiesView, notifications: notificationsView, moderation: moderationView, support: supportView, data: dataView, apply: applicationVendorView, 'my-bookings': vendorBookingsView, visits: visitsView, invite: inviteView };
    return (views[runtime.section] || overviewView)();
  }

  function authorizationBanner() {
    if (!isStaff() || operatingRecordAuthorized()) return '';
    return '<section class="ops-authorization-warning" role="status"><strong>INDEPENDENT PREVIEW · LIVE OPERATIONS NOT AUTHORIZED</strong><p>Staff can configure dates, policies, and workflows for review. Until the organizer explicitly records authorization, this system must not be treated as the official source for booking, inventory, payment, or market status.</p>' + (can('policies.manage') ? '<a href="#operations/policies">Review authorization and operating rules →</a>' : '<span>Owner policy authorization is still required.</span>') + '</section>';
  }

  function boundedRecordsBanner() {
    if (isStaff() && sectionResource()) return '';
    var bySection = {
      overview: ['applications', 'bookings', 'notifications', 'reports', 'inquiries'],
      applications: ['applications'], apply: ['applications'],
      bookings: ['bookings'], 'my-bookings': ['bookings'], visits: ['bookings'],
      staff: ['staff', 'staffInvites'], notifications: ['notifications'],
      moderation: ['reports'], support: ['inquiries', 'inquiryMessages'],
      data: Object.keys(runtime.snapshot.pageInfo || {})
    };
    var labels = { applications: 'applications', bookings: 'bookings', staff: 'team members', staffInvites: 'staff invitations', notifications: 'notifications', reports: 'reports', inquiries: 'inquiries', inquiryMessages: 'inquiry notes', audit: 'activity events' };
    var limited = array(bySection[runtime.section]).filter(function (key) {
      var info = runtime.snapshot.pageInfo && runtime.snapshot.pageInfo[key];
      return info && info.hasMore === true;
    });
    if (!limited.length) return '';
    var details = limited.map(function (key) {
      var info = runtime.snapshot.pageInfo[key];
      return 'latest ' + (Number.isInteger(info.limit) ? info.limit + ' ' : '') + (labels[key] || label(key));
    }).join(', ');
    return '<section class="ops-limit-warning" role="status"><strong>BOUNDED HOME SUMMARY</strong><p>This page uses the ' + escapeHTML(details) + ' returned for its preview lists. Open a record area to search and page through the authorized set. Matching CSV export walks every filtered page within its safety limit; it is not a transactional snapshot.</p></section>';
  }

  function renderCurrent() {
    if (!runtime.root || !runtime.snapshot) return;
    updateShell();
    var content = runtime.root.querySelector('[data-ops-content]');
    if (content) content.innerHTML = authorizationBanner() + boundedRecordsBanner() + viewForSection();
    bindCurrent();
    var main = runtime.root.querySelector('[data-ops-main]');
    if (main) main.focus({ preventScroll: true });
    ensureCurrentResource();
  }

  function flushDeferredResourceRender() {
    if (consumeDeferredResourceRender(runtime.resources, hasActiveOperationsEditor(runtime.root))) renderCurrent();
  }

  function closeOperationsDialog(dialog) {
    var returnFocus = dialog && dialog._opsReturnFocus;
    try { dialog.close(); } catch {}
    dialog.remove();
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
    Promise.resolve().then(function () {
      if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
    });
    // Let a chained review dialog open before deciding whether the deferred
    // resource response can safely replace the page underneath it.
    setTimeout(flushDeferredResourceRender, 0);
  }

  function openOperationsDialog(dialog) {
    dialog._opsReturnFocus = document.activeElement;
    var heading = dialog.querySelector('h1,h2,h3');
    if (heading) {
      if (!heading.id) heading.id = 'ops-dialog-title-' + (++runtime.dialogSequence);
      dialog.setAttribute('aria-labelledby', heading.id);
    } else if (!dialog.hasAttribute('aria-label')) {
      dialog.setAttribute('aria-label', 'Operations dialog');
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  async function request(method, path, body, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    var authUserKey = window.FSMAuth && window.FSMAuth.getState && window.FSMAuth.getState().user && window.FSMAuth.getState().user.userKey || '';
    if (!authUserKey) { var noAccount = new Error('Sign in to continue.'); noAccount.status = 401; throw noAccount; }
    var token = await window.FSMAuth.getIdToken(options.force === true);
    if (!window.FSMAuth.getState().user || window.FSMAuth.getState().user.userKey !== authUserKey) throw new Error('The signed-in account changed. Reloading the current account…');
    headers.Authorization = 'Bearer ' + token;
    var response;
    try {
      if (method !== 'GET' && runtime.snapshot && runtime.snapshot.viewer.mode === 'vendor' && runtime.snapshot.viewer.account && runtime.snapshot.viewer.account.draftScope) {
        headers['X-Vendor-Account'] = runtime.snapshot.viewer.account.draftScope;
      }
      response = await window.fetch(apiUrl(path || API_PATH), { method: method, headers: headers, credentials: 'omit', cache: 'no-store', body: body ? JSON.stringify(body) : undefined, signal: options.signal });
    } catch (error) {
      if (error && error.name === 'AbortError') { var aborted = new Error('Request replaced.'); aborted.code = 'aborted'; throw aborted; }
      throw new Error('The network did not respond. Check the connection and try again.');
    }
    if (!window.FSMAuth.getState().user || window.FSMAuth.getState().user.userKey !== authUserKey) throw new Error('The signed-in account changed. Reloading the current account…');
    var data = null;
    try { data = await response.json(); } catch { data = null; }
    if (response.status === 401 && !options.retried) return request(method, path, body, Object.assign({}, options, { retried: true, force: true }));
    if (!response.ok) {
      var issue = data && array(data.issues)[0];
      var errorMessage = data && data.message || issue && issue.message || 'The operations request failed (' + response.status + ').';
      var requestError = new Error(errorMessage); requestError.status = response.status; requestError.data = data; throw requestError;
    }
    return data || {};
  }

  function sectionResource() {
    return { calendar: 'occurrences', applications: 'applications', bookings: 'bookings', roster: 'roster', notifications: 'notifications', moderation: 'reports', support: 'inquiries', data: 'audit' }[runtime.section] || '';
  }

  function updateRouteFilters(resource) {
    var state = resourceState(resource);
    var base = runtime.section === 'overview' ? '#operations' : '#operations/' + runtime.section;
    var params = new URLSearchParams();
    Object.keys(cleanFilters(state.filters)).forEach(function (key) { params.set(key, state.filters[key]); });
    var next = base + (params.toString() ? '?' + params.toString() : '');
    if (window.history && typeof window.history.replaceState === 'function') window.history.replaceState(null, '', next);
  }

  async function loadResource(resource, options) {
    options = options || {};
    var state = resourceState(resource);
    if (state.loading && !options.force) return;
    if (state.controller) state.controller.abort();
    state.loading = true;
    state.error = '';
    var requestId = ++state.requestId;
    state.controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (options.render !== false) {
      if (hasActiveOperationsEditor(runtime.root)) state.deferredRender = true;
      else { state.deferredRender = false; renderCurrent(); }
    }
    try {
      var data = await request('GET', API_PATH + '?' + buildResourceQuery(resource, state.filters, state.cursor, options.limit || 50), null, { signal: state.controller && state.controller.signal });
      if (requestId !== state.requestId || !runtime.root) return;
      state.items = normaliseResourceItems(resource, data.items);
      state.summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
      state.pageInfo = data.pageInfo && typeof data.pageInfo === 'object' ? data.pageInfo : {};
      state.occurrence = data.occurrence && typeof data.occurrence === 'object' ? data.occurrence : null;
      state.loaded = true;
      state.error = '';
    } catch (error) {
      if (error.code === 'aborted' || requestId !== state.requestId) return;
      state.error = error.message || 'This list could not be loaded.';
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        if (options.render !== false) {
          if (hasActiveOperationsEditor(runtime.root)) state.deferredRender = true;
          else { state.deferredRender = false; renderCurrent(); }
        }
      }
    }
  }

  async function loadHomeResources() {
    if (!isStaff() || runtime.section !== 'overview' || runtime.home.loading || runtime.home.loaded) return;
    runtime.home.loading = true;
    runtime.home.error = '';
    renderCurrent();
    var specs = [];
    if (can('applications.review')) specs.push(['applications:submitted', 'applications', 'submitted']);
    if (can('bookings.manage')) {
      specs.push(['bookings:requested', 'bookings', 'requested']);
      specs.push(['bookings:approved', 'bookings', 'approved']);
      specs.push(['bookings:payment_due', 'bookings', 'payment_due']);
    }
    if (can('moderation.manage')) specs.push(['reports:open', 'reports', 'open']);
    if (can('inquiries.manage')) specs.push(['inquiries:new', 'inquiries', 'new']);
    var accountKey = runtime.authUserKey;
    var responses = await Promise.all(specs.map(async function (spec) {
      try {
        var data = await request('GET', API_PATH + '?' + buildResourceQuery(spec[1], { status: spec[2] }, '', 4));
        return { key: spec[0], resource: spec[1], data: data };
      } catch (error) { return { key: spec[0], error: error.message || 'Could not load.' }; }
    }));
    if (!runtime.root || runtime.authUserKey !== accountKey) return;
    runtime.home.results = {};
    var errors = [];
    responses.forEach(function (response) {
      if (response.error) errors.push(response.error);
      else runtime.home.results[response.key] = Object.assign({}, response.data, { items: normaliseResourceItems(response.resource, response.data.items) });
    });
    runtime.home.loading = false;
    runtime.home.loaded = true;
    runtime.home.error = errors.length ? 'Some authorized work areas did not load. ' + errors[0] : '';
    renderCurrent();
  }

  function ensureCurrentResource() {
    if (!isStaff()) return;
    var resource = sectionResource();
    if (runtime.snapshot.viewer.role === 'check_in' && ['applications', 'bookings'].indexOf(resource) >= 0) return;
    if (resource) {
      var state = resourceState(resource);
      if (resource === 'roster' && !state.filters.occurrenceId) {
        var options = rosterOccurrenceOptions();
        if (options.length) state.filters.occurrenceId = options[0].id;
      }
      if (!state.loaded && !state.error && !state.loading && (resource !== 'roster' || state.filters.occurrenceId)) loadResource(resource);
    }
    if (runtime.section === 'overview') loadHomeResources();
  }

  function invalidateStaffLists() {
    Object.keys(runtime.resources).forEach(function (key) {
      var state = runtime.resources[key];
      if (state.controller) state.controller.abort();
      state.loaded = false;
      state.loading = false;
      state.error = '';
      state.cursor = '';
      state.previous = [];
      state.deferredRender = false;
      state.requestId += 1;
    });
    runtime.home = { loading: false, loaded: false, error: '', results: {} };
  }

  async function publicOperation(action, payload) {
    var response;
    try {
      response = await window.fetch(apiUrl('/api/operations/public'), {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, payload: payload || {} })
      });
    } catch {
      throw new Error('The network did not respond. Check the connection and try again.');
    }
    var data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) throw new Error(data && data.message || 'The inquiry could not be saved (' + response.status + ').');
    return data || {};
  }

  async function load(options) {
    var preserveOnError = !!(options && options.preserveOnError === true);
    if (!runtime.root || runtime.loading) return false;
    runtime.loading = true;
    var requestId = ++runtime.requestId;
    if (runtime.controller) runtime.controller.abort();
    runtime.controller = typeof AbortController === 'function' ? new AbortController() : null;
    try {
      if (!window.FSMAuth || typeof window.FSMAuth.ready !== 'function') throw new Error('Account sign-in could not load.');
      var auth = await window.FSMAuth.ready();
      if (requestId !== runtime.requestId || !runtime.root) return false;
      if (auth.phase !== 'authenticated') { renderAuthFallback(); return false; }
      var data = await request('GET', vendorSection() ? API_PATH + '?view=vendor' : API_PATH, null, { signal: runtime.controller && runtime.controller.signal });
      if (requestId !== runtime.requestId || !runtime.root) return false;
      runtime.snapshot = normalise(data);
      renderCurrent();
      return true;
    } catch (error) {
      if (error.code === 'aborted' || requestId !== runtime.requestId || !runtime.root) return false;
      if (error.status === 401 || error.status === 403 && error.data && error.data.error === 'email_verification_required') { renderAuthFallback(); return false; }
      if (preserveOnError) {
        announce((error.message || 'The latest records could not be loaded.') + ' Your unsaved values are still here.', 'error');
        return false;
      }
      var content = runtime.root.querySelector('[data-ops-content]');
      if (content) content.innerHTML = errorView(error.message);
      bindCurrent();
      return false;
    } finally {
      if (requestId === runtime.requestId) runtime.loading = false;
    }
  }

  function renderAuthFallback() {
    if (!runtime.root) return;
    runtime.snapshot = null;
    var nav = runtime.root.querySelector('[data-ops-nav]');
    var account = runtime.root.querySelector('[data-ops-account]');
    var content = runtime.root.querySelector('[data-ops-content]');
    if (nav) nav.innerHTML = '<a class="ops-nav-link is-active" href="#operations" aria-current="page"><span>00</span><b>Account required</b><small>Email/password or Google</small></a>';
    if (account) account.innerHTML = '<span class="ops-kicker">Signed out</span><strong>Private records concealed</strong>';
    if (!content) return;
    var vendorRoute = ['apply', 'my-bookings', 'visits'].indexOf(runtime.section) >= 0;
    var returnHref = workspaceReturnHref(runtime.section, window.location.hash);
    content.innerHTML = '<section class="ops-auth-entry"><div class="ops-auth-poster"><span class="ops-kicker">' + (vendorRoute ? 'Vendor account' : 'Owner and market team') + '</span><h1>' + (vendorRoute ? 'OPEN YOUR MARKET RECORD.' : 'OPEN THE DAILY FIELD OFFICE.') + '</h1><p>' + (vendorRoute ? 'Sign in with ordinary email/password or Google to return to applications, bookings, and arrival details saved across devices.' : 'Sign in with the account assigned by the owner to open only the markets and responsibilities in your role.') + '</p><ul><li>One account across phone, tablet, and computer</li><li>Role and market scope enforced by the operations service</li><li>Review saved staff decisions in the activity record</li></ul></div><div class="ops-auth-card"><span class="ops-kicker">Email/password or Google</span><h2>PRIVATE RECORDS STAY CONCEALED UNTIL SIGN-IN.</h2><p>The shared account screen handles sign-in, account creation, verification, and password reset, then returns you to this page.</p><a class="ops-button primary" href="' + attr(returnHref) + '">' + (vendorRoute ? 'Open vendor sign-in →' : 'Owner / market team sign-in →') + '</a>' + (vendorRoute ? '<a class="ops-link" href="#markets">Browse public markets instead →</a>' : '<a class="ops-link" href="#workspace">I am a vendor →</a>') + '</div></section>';
  }

  function formPayload(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (data[key] !== undefined) data[key] = array(data[key]).concat(String(value));
      else data[key] = String(value);
    });
    form.querySelectorAll('input[type="checkbox"]').forEach(function (input) { data[input.name] = input.checked; });
    ['version', 'capacity', 'fee10x10Dollars', 'expiresInHours'].forEach(function (key) { if (data[key] !== undefined && data[key] !== '') data[key] = Number(data[key]); });
    ['marketScopes', 'categories', 'documentIds'].forEach(function (key) { if (typeof data[key] === 'string') data[key] = data[key].split(',').map(function (x) { return x.trim(); }).filter(Boolean); });
    if (data.id === '') delete data.id;
    if (data.version === '') delete data.version;
    return data;
  }

  function occurrenceById(occurrenceId) {
    var resource = runtime.resources.occurrences;
    return runtime.snapshot && runtime.snapshot.occurrences.concat(resource && resource.items || []).find(function (item) { return String(item.id) === String(occurrenceId); }) || null;
  }

  function operationalRecord(resource, id) {
    var legacy = resource === 'reports' ? runtime.snapshot.reports : resource === 'inquiries' ? runtime.snapshot.partners.concat(runtime.snapshot.threads) : array(runtime.snapshot[resource]);
    var state = runtime.resources[resource];
    return legacy.concat(state && state.items || []).find(function (item) { return String(item.id) === String(id); }) || null;
  }

  function setFormValues(form, values) {
    Object.keys(values || {}).forEach(function (key) {
      var control = form.elements.namedItem(key);
      if (!control) return;
      var value = values[key];
      if (control.type === 'checkbox') control.checked = value === true;
      else if (Array.isArray(value)) control.value = value.join(', ');
      else control.value = value == null ? '' : String(value);
    });
  }

  async function submitApplication(payload, button) {
    var categories = array(payload.categories);
    var savePayload = {
      businessName: text(payload.businessName),
      primaryCategory: text(categories[0]),
      answers: {
        contactName: text(payload.contactName), city: text(payload.city), phone: text(payload.phone),
        productDescription: text(payload.productDescription), categories: categories,
        website: text(payload.website), complianceNotes: text(payload.complianceNotes), attested: payload.attested === true
      },
      documentIds: array(payload.documentIds)
    };
    if (payload.id) savePayload.id = payload.id;
    if (payload.version !== undefined) savePayload.version = payload.version;
    var saved = await mutate('application.save', savePayload, button, 'Application details saved. Submitting for review…');
    if (!saved) return null;
    var latest = runtime.snapshot.applications.find(function (item) { return payload.id && String(item.id) === String(payload.id); }) || runtime.snapshot.applications[0];
    if (!latest) { announce('The saved application could not be reloaded.', 'error'); return null; }
    return mutate('application.submit', { id: latest.id, version: latest.version }, null, 'Application submitted for review.');
  }

  function inquiryResolutionDialog(item) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog ops-resolution-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>INTERNAL RESOLUTION</span><strong aria-hidden="true">→</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(text(item.subject, 'Resolve inquiry')) + '</h2><p>This note stays in the operations record. It does not send an email or message to the person who submitted the inquiry.</p><div class="ops-field"><label for="ops-resolution-note">Internal resolution note</label><textarea id="ops-resolution-note" name="resolution" rows="6" maxlength="1200" required></textarea></div><div class="ops-field"><label for="ops-resolution-status">Status</label><select id="ops-resolution-status" name="status"><option value="in_progress">In progress</option><option value="closed">Closed</option></select></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button primary" type="submit">Save internal resolution</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(null); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(null); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(formPayload(event.currentTarget)); });
      openOperationsDialog(dialog);
      dialog.querySelector('textarea').focus();
    });
  }

  function staffAccessDialog(member) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>STAFF ACCESS</span><strong aria-hidden="true">→</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(text(member.displayName, 'Staff member')) + '</h2><p>Change only the responsibility and market scope this person needs. The access change is written to the activity history.</p><div class="ops-field"><label for="ops-member-role">Role</label><select id="ops-member-role" name="role"><option value="admin"' + selected(member.role,'admin') + '>Administrator</option><option value="operations"' + selected(member.role,'operations') + '>Operations</option><option value="market_manager"' + selected(member.role,'market_manager') + '>Market manager</option><option value="vendor_reviewer"' + selected(member.role,'vendor_reviewer') + '>Vendor reviewer</option><option value="content"' + selected(member.role,'content') + '>Content</option><option value="finance"' + selected(member.role,'finance') + '>Finance</option><option value="check_in"' + selected(member.role,'check_in') + '>Check-in staff</option><option value="readonly"' + selected(member.role,'readonly') + '>Read only</option></select></div><div class="ops-field"><label for="ops-member-markets">Market access</label><input id="ops-member-markets" name="marketScopes" value="' + attr(array(member.marketScopes).join(', ')) + '"></div><div class="ops-field"><label for="ops-member-status">Access status</label><select id="ops-member-status" name="status"><option value="active"' + selected(member.status || 'active','active') + '>Active</option><option value="disabled"' + selected(member.status,'disabled') + '>Disabled</option></select></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button primary" type="submit">Save access</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(null); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(null); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); finish(formPayload(event.currentTarget)); });
      openOperationsDialog(dialog);
      dialog.querySelector('select').focus();
    });
  }

  function showConflictRecovery(button, message) {
    if (!runtime.root) return;
    var target = button && typeof button.closest === 'function' ? button.closest('form') : null;
    if (!target) target = runtime.root.querySelector('[data-ops-content]');
    if (!target) return;
    var existing = target.querySelector('[data-ops-conflict-recovery]');
    if (existing) existing.remove();
    var panel = document.createElement('section');
    panel.className = 'ops-conflict-recovery';
    panel.dataset.opsConflictRecovery = 'true';
    panel.setAttribute('role', 'alert');
    panel.setAttribute('tabindex', '-1');
    var heading = document.createElement('h3');
    heading.textContent = 'This change needs review.';
    var copy = document.createElement('p');
    copy.textContent = conflictRecoveryMessage(message);
    var review = document.createElement('button');
    review.className = 'ops-button outline';
    review.type = 'button';
    review.textContent = 'Review latest record';
    review.addEventListener('click', async function () {
      review.disabled = true;
      review.setAttribute('aria-busy', 'true');
      review.textContent = 'Loading latest…';
      await load({ preserveOnError: true });
      if (review.isConnected) {
        review.disabled = false;
        review.removeAttribute('aria-busy');
        review.textContent = 'Review latest record';
      }
    });
    panel.append(heading, copy, review);
    target.insertBefore(panel, target.firstChild);
    panel.focus();
  }

  async function mutate(action, payload, button, message) {
    if (runtime.busy) return null;
    runtime.busy = true;
    setPending(button, true);
    try {
      var actionMap = {
        'occurrence.save': 'staff.occurrence.save',
        'occurrence.status': 'staff.occurrence.save',
        'application.submit': 'application.submit',
        'application.transition': 'staff.application.transition',
        'booking.transition': 'staff.booking.transition',
        'booking.withdraw': 'booking.cancel',
        'policies.save': 'staff.policy.save',
        'staff.invite': 'staff.invite.create',
        'staff.invite.create': 'staff.invite.create',
        'notification.read-all': 'notification.readMany',
        'report.transition': 'staff.report.resolve',
        'data.export': 'staff.export'
      };
      var mappedAction = actionMap[action] || action;
      var body = { action: mappedAction, payload: payload || {} };
      var result = await request('POST', operationsPath(), body);
      runtime.snapshot = normalise(result.snapshot || result.state || result);
      if (isStaff()) invalidateStaffLists();
      renderCurrent();
      announce(message || 'Saved.', 'success');
      return result;
    } catch (error) {
      if (error.status === 409) {
        var conflictMessage = conflictRecoveryMessage(error.message);
        showConflictRecovery(button, error.message);
        announce(conflictMessage, 'error');
        setPending(button, false);
        return null;
      }
      announce(error.message || 'The change could not be saved.', 'error');
      setPending(button, false);
      return null;
    } finally { runtime.busy = false; }
  }

  function setPending(button, pending) {
    if (!button) return;
    if (pending) { button.dataset.opsText = button.textContent; button.textContent = 'Saving…'; button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    else { button.textContent = button.dataset.opsText || button.textContent; button.disabled = false; button.removeAttribute('aria-busy'); }
  }

  function announce(message, kind) {
    var region = runtime.root && runtime.root.querySelector('[data-ops-live]');
    if (!region) return;
    region.className = 'ops-live is-visible ' + (kind === 'error' ? 'is-error' : 'is-success');
    region.textContent = message;
    clearTimeout(runtime.liveTimer);
    runtime.liveTimer = setTimeout(function () { if (region) region.className = 'ops-live'; }, 8000);
  }

  function confirmAction(title, body, labelText, danger) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>PLEASE CONFIRM</span><strong aria-hidden="true">!</strong></div><div class="ops-dialog-body"><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(body) + '</p><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button ' + (danger ? 'danger' : 'primary') + '" type="button" data-accept>' + escapeHTML(labelText) + '</button></div></div>';
      runtime.root.appendChild(dialog);
      var settled = false;
      function finish(value) { if (settled) return; settled = true; closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(false); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(false); });
      dialog.querySelector('[data-accept]').addEventListener('click', function () { finish(true); });
      openOperationsDialog(dialog);
      dialog.querySelector('[data-accept]').focus();
    });
  }

  function reasonDialog(title, body, labelText) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>REASON REQUIRED</span><strong aria-hidden="true">!</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(body) + '</p><div class="ops-field"><label for="ops-required-reason">Reason</label><textarea id="ops-required-reason" name="reason" rows="5" minlength="3" maxlength="1000" required></textarea></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button danger" type="submit">' + escapeHTML(labelText) + '</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(''); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(''); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(text(event.currentTarget.elements.reason.value)); });
      openOperationsDialog(dialog);
      dialog.querySelector('textarea').focus();
    });
  }

  function repeatOccurrenceDialog(item, draft, reviewIssue) {
    return new Promise(function (resolve) {
      var defaults = repeatFormDefaults(item, draft);
      var issue = reviewIssue ? '<section class="ops-callout warning" role="alert"><strong>Entries preserved.</strong><p>' + escapeHTML(reviewIssue) + '</p></section>' : '';
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog ops-repeat-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>REPEAT DATE · REVIEW FIRST</span><strong aria-hidden="true">＋</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(occurrenceName(item)) + '</h2><p>Enter each approved date on its own line. The preview checks the source version, exact Central-time conversion, and date conflicts before anything is created.</p>' + issue + '<p class="ops-dialog-error" role="alert" data-repeat-error hidden></p><div class="ops-field"><label for="ops-repeat-dates">New dates <small>1–12, one YYYY-MM-DD per line</small></label><textarea id="ops-repeat-dates" name="dates" rows="7" required placeholder="2026-12-05&#10;2026-12-12">' + escapeHTML(defaults.dates) + '</textarea></div><div class="ops-dialog-grid"><div class="ops-field"><label for="ops-repeat-start">Starts (Central)</label><input id="ops-repeat-start" name="startsLocal" type="time" value="' + attr(defaults.startsLocal) + '" required></div><div class="ops-field"><label for="ops-repeat-end">Ends (Central)</label><input id="ops-repeat-end" name="endsLocal" type="time" value="' + attr(defaults.endsLocal) + '" required></div></div><div class="ops-field"><label for="ops-repeat-source">Verification source</label><input id="ops-repeat-source" name="sourceUrl" type="url" value="' + attr(defaults.sourceUrl) + '" required></div><div class="ops-field"><label for="ops-repeat-checked">Source checked (Central)</label><input id="ops-repeat-checked" name="sourceCheckedAt" type="datetime-local" value="' + attr(defaults.sourceCheckedAt) + '" required></div><section class="ops-callout warning"><strong>No automatic publication or booking.</strong><p>Created records stay private drafts for staff review, with booking requests closed, no deadline, and no copied bookings. Staff must edit each draft and deliberately choose a public status.</p></section><div><button class="ops-button outline" type="button" data-cancel>Close</button><button class="ops-button primary" type="submit">Preview exact dates</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(null); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(null); });
      dialog.querySelector('form').addEventListener('submit', function (event) {
        event.preventDefault();
        var errorRegion = event.currentTarget.querySelector('[data-repeat-error]');
        errorRegion.hidden = true;
        if (!event.currentTarget.reportValidity()) return;
        var data = formPayload(event.currentTarget);
        var validation = validateRepeatDraft(data);
        if (!validation.valid) {
          errorRegion.textContent = validation.message;
          errorRegion.hidden = false;
          event.currentTarget.elements.namedItem(validation.field)?.focus();
          return;
        }
        finish({ sourceId: item.id, sourceVersion: item.version, dates: validation.dates, startsLocal: data.startsLocal, endsLocal: data.endsLocal, sourceUrl: data.sourceUrl, sourceCheckedAt: marketLocalToIso(data.sourceCheckedAt) });
      });
      openOperationsDialog(dialog);
      dialog.querySelector('textarea').focus();
    });
  }

  function repeatPreviewDialog(payload, result) {
    return new Promise(function (resolve) {
      var records = array(result.records);
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog ops-repeat-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>EXACT DATE PREVIEW</span><strong aria-hidden="true">✓</strong></div><div class="ops-dialog-body"><h2>REVIEW ' + records.length + ' PRIVATE DRAFT' + (records.length === 1 ? '' : 'S') + '.</h2><p>Times below are the server-validated timestamps. Conflicts block creation. New drafts are not public, keep booking requests closed, and do not copy vendors, deadlines, or reservations.</p><ol class="ops-repeat-preview">' + records.map(function (record) { return '<li class="' + (record.conflict ? 'has-conflict' : '') + '"><strong>' + escapeHTML(localDate(record.date)) + '</strong><span>' + escapeHTML(localDateTime(record.startsAt)) + ' – ' + escapeHTML(localDateTime(record.endsAt)) + '</span><b>' + escapeHTML(record.conflict ? text(record.conflict, 'Conflict') : 'No conflict found') + '</b></li>'; }).join('') + '</ol><div><button class="ops-button outline" type="button" data-close>Close preview</button><button class="ops-button outline" type="button" data-edit>Edit entered dates</button><button class="ops-button primary" type="button" data-create' + (result.canCreate === true ? '' : ' disabled') + '>Create private drafts</button></div></div>';
      runtime.root.appendChild(dialog);
      function finish(value) { closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish('close'); });
      dialog.querySelector('[data-close]').addEventListener('click', function () { finish('close'); });
      dialog.querySelector('[data-edit]').addEventListener('click', function () { finish('edit'); });
      dialog.querySelector('[data-create]').addEventListener('click', function () { finish('create'); });
      openOperationsDialog(dialog);
      dialog.querySelector(result.canCreate === true ? '[data-create]' : '[data-edit]').focus();
    });
  }

  function showCreatedDrafts(ids) {
    ids = array(ids);
    if (!ids.length) return;
    var dialog = document.createElement('dialog');
    dialog.className = 'ops-dialog';
    dialog.innerHTML = '<div class="ops-dialog-head"><span>PRIVATE DRAFTS CREATED</span><strong aria-hidden="true">→</strong></div><div class="ops-dialog-body"><h2>REVIEW EACH DATE BEFORE PUBLICATION.</h2><p>These records are private and bookings remain closed. Open every draft, verify the full venue, access, fee, cutoff, and status details, then deliberately promote it when authorized.</p><ol class="ops-created-drafts">' + ids.map(function (id, index) { return '<li><a href="#operations/calendar?status=draft&amp;q=' + encodeURIComponent(id) + '">Review draft ' + (index + 1) + ' <small>' + escapeHTML(id) + '</small> →</a></li>'; }).join('') + '</ol><button class="ops-button primary" type="button" data-close>Done</button></div>';
    runtime.root.appendChild(dialog);
    function close() { closeOperationsDialog(dialog); }
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.querySelector('[data-close]').addEventListener('click', close);
    openOperationsDialog(dialog);
    dialog.querySelector('a,button').focus();
  }

  async function runRepeatOccurrence(item, button) {
    var payload = await repeatOccurrenceDialog(item, null);
    if (!payload) return;
    try {
      while (payload) {
        setPending(button, true);
        var previewEnvelope;
        try {
          previewEnvelope = await request('POST', API_PATH, { action: 'staff.occurrence.repeat.preview', payload: payload });
        } catch (previewError) {
          setPending(button, false);
          runtime.repeatPreview = { payload: payload, result: null, error: previewError.message || 'Preview failed.' };
          announce((previewError.message || 'The exact-date preview could not be completed.') + ' Your entries were preserved.', 'error');
          payload = await repeatOccurrenceDialog(item, payload, (previewError.message || 'The exact-date preview did not finish.') + ' Your entries are preserved below; correct the problem and preview again.');
          continue;
        }
        var preview = previewEnvelope.result || {};
        runtime.repeatPreview = { payload: payload, result: preview };
        setPending(button, false);
        var decision = await repeatPreviewDialog(payload, preview);
        if (decision === 'edit') { payload = await repeatOccurrenceDialog(item, payload); continue; }
        if (decision !== 'create') { runtime.repeatPreview = null; return; }
        if (!await confirmAction('Create these private draft dates?', 'This creates only the reviewed dates. Every draft stays off the public schedule, keeps bookings closed, and requires staff review before publication.', 'Create private drafts', false)) { runtime.repeatPreview = null; return; }
        setPending(button, true);
        var createdEnvelope;
        try {
          createdEnvelope = await request('POST', API_PATH, { action: 'staff.occurrence.repeat.create', payload: Object.assign({}, payload, { previewHash: preview.previewHash, confirm: 'CREATE DATED RECORDS' }) });
        } catch (createError) {
          setPending(button, false);
          announce((createError.message || 'The site could not confirm draft creation.') + ' Your entries were preserved.', 'error');
          payload = await repeatOccurrenceDialog(item, payload, (createError.message || 'Draft creation was not confirmed.') + ' Your entries are preserved below. Check the calendar before retrying in case the request finished after the connection failed.');
          continue;
        }
        runtime.snapshot = normalise(createdEnvelope.snapshot || createdEnvelope.state || createdEnvelope);
        invalidateStaffLists();
        runtime.repeatPreview = null;
        renderCurrent();
        showCreatedDrafts(createdEnvelope.result && createdEnvelope.result.created);
        announce(String(createdEnvelope.result && createdEnvelope.result.count || payload.dates.length) + ' private draft dates created with bookings closed.', 'success');
        return;
      }
      runtime.repeatPreview = null;
    } catch (error) {
      announce(error.message || 'The repeat-date review could not be completed.', 'error');
    } finally { setPending(button, false); }
  }

  function internalNoteDialog(title) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>INTERNAL NOTE</span><strong aria-hidden="true">→</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(title) + '</h2><p>This note is visible to authorized staff in the operations record. It does not send a reply.</p><div class="ops-field"><label for="ops-internal-note">Note</label><textarea id="ops-internal-note" name="body" rows="6" maxlength="4000" required></textarea></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button primary" type="submit">Save internal note</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(''); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(''); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(text(event.currentTarget.elements.body.value)); });
      openOperationsDialog(dialog);
      dialog.querySelector('textarea').focus();
    });
  }

  function showInviteToken(result) {
    if (!result || !result.token) return;
    var dialog = document.createElement('dialog');
    dialog.className = 'ops-dialog';
    dialog.innerHTML = '<div class="ops-dialog-head"><span>ONE-TIME STAFF TOKEN</span><strong aria-hidden="true">→</strong></div><div class="ops-dialog-body"><h2>COPY IT NOW.</h2><p>This interface does not send an email. Share the token only with the intended teammate through a trusted channel. It expires ' + escapeHTML(localDateTime(result.expiresAt)) + '.</p><div class="ops-field"><label for="ops-created-token">Invitation token</label><textarea id="ops-created-token" rows="4" readonly>' + escapeHTML(result.token) + '</textarea></div><p>Ask the teammate to sign in, open <strong>#operations/invite</strong>, and submit this token. Their request still requires explicit staff approval.</p><div><button class="ops-button outline" type="button" data-copy>Copy token</button><button class="ops-button primary" type="button" data-close>Done</button></div></div>';
    runtime.root.appendChild(dialog);
    function close() { closeOperationsDialog(dialog); }
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.querySelector('[data-copy]').addEventListener('click', async function () { var value = result.token; try { await navigator.clipboard.writeText(value); announce('Invitation token copied.', 'success'); } catch { var field = dialog.querySelector('textarea'); field.focus(); field.select(); announce('Select and copy the highlighted token.', 'error'); } });
    openOperationsDialog(dialog);
    dialog.querySelector('textarea').focus();
  }

  function restoreConfirmationDialog(id) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>OWNER RECOVERY GATE</span><strong aria-hidden="true">!</strong></div><form class="ops-dialog-body"><h2>RESTORE MISSING RECORDS?</h2><p>The server preserves every current row and attempts to return only records missing from snapshot ' + escapeHTML(id) + '. Type <strong>RESTORE MISSING RECORDS</strong> to continue.</p><div class="ops-field"><label for="ops-restore-confirm">Confirmation phrase</label><input id="ops-restore-confirm" name="confirm" autocomplete="off" required pattern="RESTORE MISSING RECORDS"></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button danger" type="submit">Run missing-record recovery</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { closeOperationsDialog(dialog); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(false); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(false); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(true); });
      openOperationsDialog(dialog);
      dialog.querySelector('input').focus();
    });
  }

  function bindCurrent() {
    if (!runtime.root) return;
    var mobileNav = runtime.root.querySelector('[data-ops-nav]');
    var mobileNavToggle = runtime.root.querySelector('[data-ops-nav-toggle]');
    if (mobileNav && mobileNavToggle && mobileNavToggle.dataset.opsBound !== 'true') {
      mobileNavToggle.dataset.opsBound = 'true';
      mobileNav.classList.add('is-collapsible');
      function setMobileNavOpen(open) {
        mobileNav.classList.toggle('is-open', open);
        mobileNavToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        var label = mobileNavToggle.querySelector('[data-ops-nav-toggle-label]');
        if (label) label.textContent = open ? 'Hide sections ↑' : 'Show sections ↓';
      }
      mobileNavToggle.addEventListener('click', function () { setMobileNavOpen(mobileNavToggle.getAttribute('aria-expanded') !== 'true'); });
      mobileNav.addEventListener('click', function (event) {
        if (event.target.closest('a') && window.matchMedia && window.matchMedia('(max-width: 680px)').matches) setMobileNavOpen(false);
      });
    }
    var retry = runtime.root.querySelector('[data-ops-retry]'); if (retry) retry.addEventListener('click', load);
    runtime.root.querySelectorAll('[data-ops-resource-filter]').forEach(function (form) { form.addEventListener('submit', function (event) {
      event.preventDefault();
      var resource = form.dataset.opsResourceFilter;
      var payload = formPayload(form);
      if (payload.dateFrom && payload.dateTo && payload.dateFrom > payload.dateTo) { announce('The start date must be on or before the end date.', 'error'); form.elements.namedItem('dateFrom')?.focus(); return; }
      var state = resourceState(resource);
      state.filters = cleanFilters(payload);
      state.cursor = '';
      state.previous = [];
      state.loaded = false;
      updateRouteFilters(resource);
      loadResource(resource, { force: true });
    }); });
    var rosterSelect = runtime.root.querySelector('[data-ops-roster-select]'); if (rosterSelect) rosterSelect.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!rosterSelect.reportValidity()) return;
      var state = resourceState('roster');
      state.filters = cleanFilters(formPayload(rosterSelect));
      state.cursor = '';
      state.previous = [];
      state.loaded = false;
      state.occurrence = null;
      updateRouteFilters('roster');
      loadResource('roster', { force: true });
    });
    runtime.root.querySelectorAll('[data-ops-resource-reset]').forEach(function (button) { button.addEventListener('click', function () {
      var resource = button.dataset.opsResourceReset;
      var state = resourceState(resource);
      state.filters = resource === 'roster' && state.filters.occurrenceId ? { occurrenceId: state.filters.occurrenceId } : {};
      state.cursor = '';
      state.previous = [];
      state.loaded = false;
      updateRouteFilters(resource);
      loadResource(resource, { force: true });
    }); });
    runtime.root.querySelectorAll('[data-ops-resource-retry]').forEach(function (button) { button.addEventListener('click', function () { loadResource(button.dataset.opsResourceRetry, { force: true }); }); });
    runtime.root.querySelectorAll('[data-ops-page]').forEach(function (button) { button.addEventListener('click', function () {
      var state = resourceState(button.dataset.resource);
      if (button.dataset.opsPage === 'next' && state.pageInfo.nextCursor) { state.previous.push(state.cursor || ''); state.cursor = state.pageInfo.nextCursor; }
      else if (button.dataset.opsPage === 'previous' && state.previous.length) state.cursor = state.previous.pop();
      else return;
      state.loaded = false;
      loadResource(button.dataset.resource, { force: true });
    }); });
    runtime.root.querySelectorAll('[data-ops-export-matching]').forEach(function (button) { button.addEventListener('click', function () { exportMatchingResource(button.dataset.opsExportMatching, button); }); });
    var printRoster = runtime.root.querySelector('[data-ops-print-roster]'); if (printRoster) printRoster.addEventListener('click', function () { printMatchingRoster(printRoster); });
    runtime.root.querySelectorAll('[data-ops-roster-status]').forEach(function (button) { button.addEventListener('click', async function () {
      var record = operationalRecord('roster', button.dataset.id);
      if (!record) return;
      var status = button.dataset.opsRosterStatus;
      var reason = '';
      if (status === 'no_show') {
        reason = await reasonDialog('Record this vendor as a no-show?', 'The reason stays on the booking history. Confirm the vendor and selected market day before continuing.', 'Record no-show');
        if (!reason) return;
      }
      await mutate('booking.transition', { id: record.id, version: record.version, status: status, note: reason, reason: reason }, button, status === 'attended' ? 'Arrival recorded.' : 'No-show recorded.');
    }); });
    runtime.root.querySelectorAll('[data-ops-toggle]').forEach(function (button) { button.addEventListener('click', function () { var drawer = runtime.root.querySelector('[data-drawer="' + CSS.escape(button.dataset.opsToggle) + '"]'); if (drawer) { var focusTarget = ''; if (button.dataset.opsToggle === 'occurrence-form') focusTarget = prepareNewOccurrenceForm(drawer).focus; drawer.hidden = false; drawer.scrollIntoView({ behavior: 'smooth', block: 'start' }); (focusTarget ? drawer.elements.namedItem(focusTarget) : drawer.querySelector('input,select,textarea'))?.focus(); } }); });
    runtime.root.querySelectorAll('[data-ops-close]').forEach(function (button) { button.addEventListener('click', function () { var drawer = runtime.root.querySelector('[data-drawer="' + CSS.escape(button.dataset.opsClose) + '"]'); if (drawer) { drawer.hidden = true; flushDeferredResourceRender(); } }); });
    runtime.root.querySelectorAll('[data-ops-filter]').forEach(function (select) { select.addEventListener('change', function () { var list = runtime.root.querySelector('[data-ops-list="' + CSS.escape(select.dataset.opsFilter) + '"]'); if (!list) return; list.querySelectorAll('[data-filter-status]').forEach(function (item) { item.hidden = !!select.value && item.dataset.filterStatus !== select.value; }); }); });
    runtime.root.querySelectorAll('[data-ops-form]').forEach(function (form) { form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var action = form.dataset.opsForm;
      var payload = formPayload(form);
      if (action === 'application.submit' && payload.attested !== true) { announce('Confirm the application is accurate before submitting.', 'error'); return; }
      if (action === 'occurrence.save') {
        if (['delayed', 'cancelled'].indexOf(payload.status) >= 0 && !text(payload.loadInNotes)) { announce('Add clear delay or cancellation context in the load-in and status notes.', 'error'); form.elements.namedItem('loadInNotes')?.focus(); return; }
        payload.startsAt = marketLocalToIso(payload.startsAt);
        payload.endsAt = marketLocalToIso(payload.endsAt);
        payload.bookingDeadlineAt = payload.bookingDeadlineAt ? marketLocalToIso(payload.bookingDeadlineAt) : '';
        payload.sourceCheckedAt = marketLocalToIso(payload.sourceCheckedAt);
        payload.capacity = payload.capacity === '' || payload.capacity === undefined ? null : Number(payload.capacity);
        payload.fee10x10Cents = payload.fee10x10Dollars === '' || payload.fee10x10Dollars === undefined ? null : Math.round(Number(payload.fee10x10Dollars) * 100);
        delete payload.fee10x10Dollars;
        if (Date.parse(payload.endsAt) <= Date.parse(payload.startsAt)) { announce('End time must be after start time.', 'error'); form.elements.namedItem('endsAt')?.focus(); return; }
        if (payload.bookingsOpen && (payload.capacity === null || !payload.bookingDeadlineAt)) { announce('Set a capacity and booking cutoff before opening requests.', 'error'); return; }
      }
      if (action === 'policies.save' && payload.activate && (!payload.approved || !payload.operatorAuthorized)) { announce('Activation requires both policy approval and organizer authority confirmation.', 'error'); return; }
      if (form.dataset.publicOperation === 'true') {
        setPending(event.submitter, true);
        try { await publicOperation(action, payload); form.reset(); form.hidden = true; flushDeferredResourceRender(); announce('Inquiry saved for staff review. No external delivery is claimed.', 'success'); }
        catch (error) { announce(error.message, 'error'); setPending(event.submitter, false); }
        return;
      }
      if (action === 'staff.invite.accept') {
        setPending(event.submitter, true);
        try {
          await request('POST', API_PATH, { action: action, payload: { token: payload.token } });
          var content = runtime.root.querySelector('[data-ops-content]');
          if (content) content.innerHTML = '<section class="ops-state-panel"><span>PENDING</span><div><span class="ops-kicker">Verified account received</span><h1>AN AUTHORIZED MANAGER MUST APPROVE ACCESS.</h1><p>Your invitation request is saved. Staff access is not active yet.</p><a class="ops-button primary" href="#operations">Return to market desk →</a></div></section>';
          announce('Invitation accepted for staff approval.', 'success');
        } catch (error) { announce(error.message, 'error'); setPending(event.submitter, false); }
        return;
      }
      var result = action === 'application.submit' ? await submitApplication(payload, event.submitter) : await mutate(action, payload, event.submitter, 'Saved to the operations record.');
      if (action === 'staff.invite' && result && result.result) showInviteToken(result.result);
      if (result && form.dataset.drawer) form.hidden = true;
    }); });
    runtime.root.querySelectorAll('[data-ops-edit-occurrence]').forEach(function (button) { button.addEventListener('click', function () {
      var item = occurrenceById(button.dataset.opsEditOccurrence);
      var form = runtime.root.querySelector('[data-drawer="occurrence-form"]');
      if (!item || !form) return;
      setFormValues(form, item);
      setFormValues(form, { name: item.name || item.marketName, date: occurrenceDate(item), startsAt: marketDateTimeInput(item.startsAt), endsAt: marketDateTimeInput(item.endsAt), bookingDeadlineAt: marketDateTimeInput(item.bookingDeadlineAt), sourceCheckedAt: marketDateTimeInput(item.sourceCheckedAt), fee10x10Dollars: item.fee10x10Cents == null ? '' : item.fee10x10Cents / 100, status: button.dataset.nextStatus || item.status || 'draft', version: item.version });
      var mode = setOccurrenceFormMode(form, button.dataset.nextStatus || 'edit');
      form.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.elements.namedItem(mode.focus)?.focus();
    }); });
    runtime.root.querySelectorAll('[data-ops-repeat-occurrence]').forEach(function (button) { button.addEventListener('click', function () {
      var item = operationalRecord('occurrences', button.dataset.opsRepeatOccurrence);
      if (item) runRepeatOccurrence(item, button);
    }); });
    runtime.root.querySelectorAll('[data-ops-action]').forEach(function (button) { button.addEventListener('click', async function () {
      var action = button.dataset.opsAction;
      var sourceName = action.indexOf('application.') === 0 ? 'applications' : 'notifications';
      var record = operationalRecord(sourceName, button.dataset.id);
      if (!record) return;
      if (action === 'application.withdraw' && !await confirmAction('Withdraw this application?', 'The application leaves active review but remains in its recorded history.', 'Withdraw application', true)) return;
      var payload = { id: record.id };
      if (record.version !== undefined && action !== 'notification.read') payload.version = record.version;
      await mutate(action, payload, button, 'The record was updated.');
    }); });
    runtime.root.querySelectorAll('[data-ops-transition]').forEach(function (button) { button.addEventListener('click', async function () {
      var kind = button.dataset.opsTransition, recordId = button.dataset.id, status = button.dataset.status;
      var selector = kind === 'application' ? '[data-decision-note="' + CSS.escape(recordId) + '"]' : kind === 'booking' ? '[data-booking-note="' + CSS.escape(recordId) + '"]' : '[data-report-note="' + CSS.escape(recordId) + '"]';
      var noteField = runtime.root.querySelector(selector), note = text(noteField && noteField.value);
      var record = operationalRecord(kind === 'application' ? 'applications' : kind === 'booking' ? 'bookings' : 'reports', recordId);
      if (!record) return;
      if (kind === 'application') {
        var missingField = runtime.root.querySelector('[data-missing-items="' + CSS.escape(recordId) + '"]');
        var missingItems = text(missingField && missingField.value).split(/\n+/).map(function (line) { return line.trim(); }).filter(Boolean);
        if (status === 'needs_info' && !missingItems.length) { announce('List at least one specific missing item.', 'error'); missingField?.focus(); return; }
        if (status === 'rejected' && !note) { announce('Add a reason before declining the application.', 'error'); noteField?.focus(); return; }
        if (status === 'rejected' && !await confirmAction('Decline this application?', 'The explanation is saved with the decision and shown in the vendor record.', 'Decline application', true)) return;
        await mutate('application.transition', { id: record.id, version: record.version, status: status, missingItems: status === 'needs_info' ? missingItems : [], note: note, reason: status === 'rejected' ? note : '' }, button, label(status) + ' saved.');
        return;
      }
      if (kind === 'booking') {
        if (['rejected','cancelled','credited','no_show'].indexOf(status) >= 0 && !note) { announce('Add a reason before making that booking decision.', 'error'); noteField?.focus(); return; }
        if (['rejected','cancelled','credited','no_show'].indexOf(status) >= 0 && !await confirmAction('Record ' + label(status).toLowerCase() + '?', 'The explanation stays with the booking and its activity history.', label(status), true)) return;
        var bookingPayload = { id: record.id, version: record.version, status: status, note: note, reason: ['rejected','cancelled','credited','no_show'].indexOf(status) >= 0 ? note : '' };
        if (status === 'payment_due') {
          var feeField = runtime.root.querySelector('[data-booking-fee="' + CSS.escape(recordId) + '"]');
          var dollars = feeField && feeField.value;
          if (dollars === '' || !Number.isFinite(Number(dollars)) || Number(dollars) < 0) { announce('Set the approved fee before recording payment due.', 'error'); feeField?.focus(); return; }
          bookingPayload.feeCents = Math.round(Number(dollars) * 100);
        }
        await mutate('booking.transition', bookingPayload, button, label(status) + ' saved.');
        return;
      }
      if (!note) { announce('Add a resolution before closing the report.', 'error'); noteField?.focus(); return; }
      if (status === 'dismissed' && !await confirmAction('Dismiss this report?', 'The resolution remains recorded and the report closes without suspending the vendor.', 'Dismiss report', true)) return;
      await mutate('report.transition', { id: record.id, version: record.version, status: status, resolution: note }, button, label(status) + ' saved.');
    }); });
    var readAll = runtime.root.querySelector('[data-ops-read-all]'); if (readAll) readAll.addEventListener('click', async function () { var unreadIds = resourceItems('notifications', runtime.snapshot.notifications).filter(function (item) { return !item.readAt && item.read !== true; }).map(function (item) { return item.id; }); if (!unreadIds.length) return; await mutate('notification.read-all', { ids: unreadIds }, readAll, 'All visible notifications marked read.'); });
    runtime.root.querySelectorAll('[data-ops-resolve-inquiry]').forEach(function (button) { button.addEventListener('click', async function () { var item = operationalRecord('inquiries', button.dataset.opsResolveInquiry); if (!item) return; var resolution = await inquiryResolutionDialog(item); if (!resolution) return; await mutate('staff.inquiry.resolve', { id: item.id, version: item.version, status: resolution.status, resolution: resolution.resolution }, button, 'Internal inquiry resolution saved. No outbound message was sent.'); }); });
    runtime.root.querySelectorAll('[data-ops-note-inquiry]').forEach(function (button) { button.addEventListener('click', async function () { var item = operationalRecord('inquiries', button.dataset.opsNoteInquiry); if (!item) return; var body = await internalNoteDialog(text(item.organization, label(item.kind || 'support') + ' inquiry')); if (!body) return; await mutate('staff.inquiry.note', { id: item.id, body: body }, button, 'Internal note saved. No outbound reply was sent.'); }); });
    runtime.root.querySelectorAll('[data-ops-edit-staff]').forEach(function (button) { button.addEventListener('click', async function () { var member = runtime.snapshot.staff.find(function (item) { return item.issuer === button.dataset.issuer && item.subject === button.dataset.subject; }); if (!member) return; var change = await staffAccessDialog(member); if (!change) return; await mutate('staff.member.update', { issuer: member.issuer, subject: member.subject, role: change.role, marketScopes: array(change.marketScopes), status: change.status }, button, 'Staff access updated and recorded.'); }); });
    runtime.root.querySelectorAll('[data-ops-approve-invite]').forEach(function (button) { button.addEventListener('click', async function () { if (!await confirmAction('Approve this verified applicant?', 'This grants the invitation role and market scopes to the accepted account.', 'Grant staff access', false)) return; await mutate('staff.invite.approve', { id: button.dataset.opsApproveInvite }, button, 'Staff access approved.'); }); });
    runtime.root.querySelectorAll('[data-ops-moderate-vendor]').forEach(function (button) { button.addEventListener('click', async function () { var status = button.dataset.status === 'active' ? 'active' : 'suspended'; var reason = await reasonDialog(status === 'active' ? 'Reinstate this vendor profile?' : 'Suspend this vendor profile?', status === 'active' ? 'Reinstatement returns an otherwise publishable profile to active status. The reason is recorded.' : 'Suspension removes the vendor from active public publishing. The report remains separate until it is resolved or dismissed.', status === 'active' ? 'Reinstate profile' : 'Suspend profile'); if (!reason) return; await mutate('staff.vendor.moderate', { publicId: button.dataset.opsModerateVendor, status: status, reason: reason }, button, 'Vendor profile ' + (status === 'active' ? 'reinstated' : 'suspended') + ' and recorded.'); }); });
    runtime.root.querySelectorAll('[data-ops-cancel-booking]').forEach(function (button) { button.addEventListener('click', async function () { var record = runtime.snapshot.bookings.find(function (item) { return String(item.id) === String(button.dataset.opsCancelBooking); }); if (!record) return; var reason = await reasonDialog('Cancel this market request?', 'The reason replaces the vendor note on the cancelled booking and remains in the saved record.', 'Cancel request'); if (!reason) return; await mutate('booking.cancel', { id: record.id, version: record.version, reason: reason }, button, 'Booking request cancelled.'); }); });
    var backupCreate = runtime.root.querySelector('[data-ops-backup-create]'); if (backupCreate) backupCreate.addEventListener('click', async function () { var result = await mutate('staff.backup.create', {}, backupCreate, 'Server snapshot created.'); if (result && result.result) { runtime.latestBackup = result.result; renderCurrent(); announce('Server snapshot created with an integrity hash.', 'success'); } });
    var backupPreview = runtime.root.querySelector('[data-ops-backup-preview]'); if (backupPreview) backupPreview.addEventListener('submit', async function (event) { event.preventDefault(); if (!backupPreview.reportValidity()) return; var result = await mutate('staff.backup.preview', { id: text(backupPreview.elements.id.value) }, event.submitter, 'Snapshot integrity verified for restore preview.'); if (result && result.result) { runtime.backupPreview = result.result; renderCurrent(); announce('Restore preview verified. No records were changed.', 'success'); } });
    var backupRestore = runtime.root.querySelector('[data-ops-backup-restore]'); if (backupRestore) backupRestore.addEventListener('click', async function () { var backupId = backupRestore.dataset.opsBackupRestore; if (!await restoreConfirmationDialog(backupId)) return; var result = await mutate('staff.backup.restore', { id: backupId, confirm: 'RESTORE MISSING RECORDS' }, backupRestore, 'Missing-record recovery completed. Current records were preserved.'); if (result) { runtime.backupPreview = null; renderCurrent(); } });
    runtime.root.querySelectorAll('[data-ops-export]').forEach(function (button) { button.addEventListener('click', function () { exportLocal(button.dataset.opsExport); }); });
    runtime.root.querySelectorAll('[data-ops-download-file]').forEach(function (button) { button.addEventListener('click', function () { downloadAccountFile(button.dataset.opsDownloadFile, button); }); });
    var signout = runtime.root.querySelector('[data-ops-signout]'); if (signout) signout.addEventListener('click', async function () { setPending(signout, true); try { await window.FSMAuth.signOut(); window.location.hash = 'workspace'; } catch (error) { announce(error.message, 'error'); setPending(signout, false); } });
  }

  function downloadTextFile(content, mime, filename) {
    var url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  function rowsToCsv(rows, forcedKeys) {
    var keys = forcedKeys || Array.from(new Set(rows.flatMap(function (row) { return Object.keys(row); }))).filter(function (key) {
      return rows.every(function (row) { return row[key] == null || typeof row[key] !== 'object'; });
    });
    return [keys.map(csvCell).join(',')].concat(rows.map(function (row) { return keys.map(function (key) { return csvCell(row[key]); }).join(','); })).join('\r\n');
  }

  async function fetchAllMatchingRows(resource, filters, accountKey, maxRows) {
    var cursor = '';
    var rows = [];
    var expectedTotal = null;
    var seenCursors = new Set();
    var seenIds = new Set();
    maxRows = maxRows || 10000;
    for (var page = 0; page < 100; page += 1) {
      var data = await request('GET', API_PATH + '?' + buildResourceQuery(resource, filters, cursor, 100));
      if (runtime.authUserKey !== accountKey) throw new Error('The signed-in account changed while records were loading.');
      var pageInfo = data.pageInfo && typeof data.pageInfo === 'object' ? data.pageInfo : {};
      if (expectedTotal === null) {
        expectedTotal = Number(pageInfo.total);
        if (Number.isFinite(expectedTotal) && expectedTotal > maxRows) throw new Error('This filter matches ' + expectedTotal + ' records. Narrow the filters below ' + maxRows + ' records.');
      }
      if (Number(pageInfo.total) !== expectedTotal) throw new Error('The matching record count changed while pages were loading. Try again for a complete result.');
      var pageRows = normaliseResourceItems(resource, data.items);
      pageRows.forEach(function (row) {
        if (!row.id) return;
        if (seenIds.has(String(row.id))) throw new Error('A record appeared on more than one page. Try again for a complete result.');
        seenIds.add(String(row.id));
      });
      rows = rows.concat(pageRows);
      if (rows.length > maxRows) throw new Error('The result exceeded ' + maxRows + ' records. Narrow the filters and try again.');
      if (!pageInfo.hasMore) break;
      if (!pageInfo.nextCursor || seenCursors.has(pageInfo.nextCursor)) throw new Error('The server did not provide a safe next page. Try again.');
      seenCursors.add(pageInfo.nextCursor);
      cursor = pageInfo.nextCursor;
      if (page === 99) throw new Error('The result reached its 100-page safety limit. Narrow the filters and try again.');
    }
    if (Number.isFinite(expectedTotal) && rows.length !== expectedTotal) throw new Error('The matching record count changed while pages were loading. Try again for a complete result.');
    if (runtime.authUserKey !== accountKey) throw new Error('The signed-in account changed while records were loading.');
    return { rows: rows, total: expectedTotal };
  }

  async function exportMatchingResource(resource, button) {
    var state = resourceState(resource);
    var filters = cleanFilters(Object.assign({}, state.filters));
    var selectedOccurrenceRecord = state.occurrence || occurrenceById(state.filters.occurrenceId);
    var selectedOccurrence = selectedOccurrenceRecord ? Object.assign({}, selectedOccurrenceRecord) : null;
    var accountKey = runtime.authUserKey;
    setPending(button, true);
    try {
      var complete = await fetchAllMatchingRows(resource, filters, accountKey, 10000);
      var rows = complete.rows;
      if (!rows.length) { announce('No records match the current filters, so no file was created.', 'error'); return; }
      var keys;
      if (resource === 'roster') {
        var occurrence = selectedOccurrence || {};
        rows = rows.map(function (row) { return { marketDate: occurrence.date || '', marketName: occurrence.name || '', venue: occurrence.venue || '', slotNumber: row.slotNumber, businessName: row.businessName, publicId: row.publicId, boothSize: row.boothSize, status: row.status }; });
        keys = ['marketDate', 'marketName', 'venue', 'slotNumber', 'businessName', 'publicId', 'boothSize', 'status'];
      }
      downloadTextFile(rowsToCsv(rows, keys), 'text/csv', 'four-seasons-' + resource + '-matching-' + new Date().toISOString().slice(0, 10) + '.csv');
      announce('Downloaded ' + rows.length + ' rows returned across all matching pages for this authorized role. This is not a transactional snapshot.', 'success');
    } catch (error) {
      announce((error.message || 'The complete filtered export could not be created.') + ' No partial file was created.', 'error');
    } finally { setPending(button, false); }
  }

  async function printMatchingRoster(button) {
    var state = resourceState('roster');
    var filters = cleanFilters(Object.assign({}, state.filters));
    var occurrenceRecord = state.occurrence || occurrenceById(filters.occurrenceId);
    var occurrence = occurrenceRecord ? Object.assign({}, occurrenceRecord) : null;
    if (!filters.occurrenceId || !occurrence) { announce('Choose a market day before printing.', 'error'); return; }
    var accountKey = runtime.authUserKey;
    var sheet = null;
    setPending(button, true);
    try {
      var complete = await fetchAllMatchingRows('roster', filters, accountKey, 10000);
      var rows = complete.rows;
      if (!rows.length) { announce('No roster rows match the current filters, so nothing was printed.', 'error'); return; }
      var filterNote = [filters.status ? 'Arrival: ' + label(filters.status) : '', filters.q ? 'Search: ' + filters.q : ''].filter(Boolean).join(' · ');
      sheet = document.createElement('section');
      sheet.className = 'ops-print-roster-sheet';
      sheet.setAttribute('aria-hidden', 'true');
      sheet.innerHTML = '<div class="ops-print-roster-title"><span>FOUR SEASONS MARKETS · MARKET-DAY ROSTER</span><h1>' + escapeHTML(occurrenceName(occurrence)) + '</h1><p>' + escapeHTML(localDate(occurrenceDate(occurrence))) + (occurrenceHours(occurrence) ? ' · ' + escapeHTML(occurrenceHours(occurrence)) : '') + ' · ' + escapeHTML(text(occurrence.venue, 'Venue not supplied')) + '</p><strong>' + rows.length + ' MATCHING VENDOR' + (rows.length === 1 ? '' : 'S') + '</strong>' + (filterNote ? '<small>' + escapeHTML(filterNote) + '</small>' : '') + '</div><table><thead><tr><th>Slot</th><th>Business</th><th>Public ID</th><th>Booth</th><th>Arrival</th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><td>' + escapeHTML(rosterSlot(row.slotNumber)) + '</td><td>' + escapeHTML(text(row.businessName, 'Vendor')) + '</td><td>' + escapeHTML(text(row.publicId, '—')) + '</td><td>' + escapeHTML(text(row.boothSize, '—')) + '</td><td>' + escapeHTML(label(row.status)) + '</td></tr>'; }).join('') + '</tbody></table>';
      runtime.root.appendChild(sheet);
      runtime.root.classList.add('is-printing-roster');
      window.print();
      announce('Prepared all ' + rows.length + ' matching roster rows returned across the authorized pages for the print dialog.', 'success');
    } catch (error) {
      announce((error.message || 'The complete roster could not be prepared.') + ' Nothing was printed.', 'error');
    } finally {
      if (runtime.root) runtime.root.classList.remove('is-printing-roster');
      if (sheet) sheet.remove();
      setPending(button, false);
    }
  }

  function exportLocal(kind) {
    var list = kind === 'full' ? runtime.snapshot.raw : runtime.snapshot[kind] || [];
    var content, mime, extension;
    if (kind === 'full') { content = JSON.stringify(list, null, 2); mime = 'application/json'; extension = 'json'; }
    else { var rows = array(list); content = rowsToCsv(rows); mime = 'text/csv'; extension = 'csv'; }
    downloadTextFile(content, mime, 'four-seasons-' + kind + '-' + new Date().toISOString().slice(0,10) + '.' + extension); announce('Export downloaded from the records currently visible to this account.', 'success');
  }

  async function downloadAccountFile(fileId, button) {
    setPending(button, true);
    try {
      var authUserKey = window.FSMAuth.getState().user && window.FSMAuth.getState().user.userKey || '';
      var token = await window.FSMAuth.getIdToken();
      if (!authUserKey || !window.FSMAuth.getState().user || window.FSMAuth.getState().user.userKey !== authUserKey) throw new Error('The signed-in account changed.');
      var headers = { 'Authorization': 'Bearer ' + token };
      if (!isStaff() && runtime.snapshot.viewer.account && runtime.snapshot.viewer.account.draftScope) headers['X-Vendor-Account'] = runtime.snapshot.viewer.account.draftScope;
      var response = await window.fetch(apiUrl('/api/files?id=' + encodeURIComponent(fileId)), { method: 'GET', headers: headers, credentials: 'omit', cache: 'no-store' });
      if (!window.FSMAuth.getState().user || window.FSMAuth.getState().user.userKey !== authUserKey) throw new Error('The signed-in account changed.');
      if (!response.ok) { var message = 'The document could not be downloaded.'; try { var body = await response.json(); message = body.message || message; } catch {} throw new Error(message); }
      var blob = await response.blob();
      var disposition = response.headers.get('content-disposition') || '';
      var match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition);
      var filename = match ? decodeURIComponent(match[1]) : 'four-seasons-document';
      filename = filename.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 140) || 'four-seasons-document';
      var url = URL.createObjectURL(blob); var link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      announce('Document downloaded.', 'success');
    } catch (error) { announce(error.message, 'error'); }
    finally { setPending(button, false); }
  }

  async function initOperationsApp(section) {
    runtime.section = VALID_SECTIONS.indexOf(section) >= 0 ? section : 'overview';
    runtime.root = document.querySelector('[data-operations-app]');
    if (!runtime.root) return;
    var activeResource = sectionResource();
    if (activeResource && runtime.resources[activeResource]) reconcileResourceFilters(runtime.resources[activeResource], activeResource, routeQuery());
    if (runtime.unsubscribe) runtime.unsubscribe();
    if (window.FSMAuth && typeof window.FSMAuth.onChange === 'function') {
      runtime.unsubscribe = window.FSMAuth.onChange(function (state) {
        if (!runtime.root || !runtime.root.isConnected) return;
        var nextKey = state.user && state.user.userKey || '';
        var changed = runtime.authUserKey !== nextKey;
        if (changed) {
          Object.keys(runtime.resources).forEach(function (key) { if (runtime.resources[key].controller) runtime.resources[key].controller.abort(); });
          runtime.authUserKey = nextKey;
          runtime.snapshot = null;
          runtime.staffAccessSeen = false;
          runtime.latestBackup = null;
          runtime.backupPreview = null;
          runtime.resources = {};
          runtime.home = { loading: false, loaded: false, error: '', results: {} };
          runtime.repeatPreview = null;
          runtime.busy = false;
          runtime.loading = false;
          runtime.requestId += 1;
          if (runtime.controller) runtime.controller.abort();
          var content = runtime.root.querySelector('[data-ops-content]');
          if (content) content.innerHTML = loadingView();
        }
        if (state.phase === 'loading') return;
        if (state.phase === 'authenticated') { if (!runtime.snapshot && !runtime.loading) load(); }
        else if (!runtime.loading) renderAuthFallback();
      });
    }
    await load();
  }

  window.renderOperationsApp = renderOperationsApp;
  window.initOperationsApp = initOperationsApp;
  window.FSMOperationsLogic = Object.freeze({
    buildResourceQuery: buildResourceQuery,
    cleanFilters: cleanFilters,
    upcomingOccurrences: upcomingOccurrences,
    csvCell: csvCell,
    rowsToCsv: rowsToCsv,
    parseRepeatDates: parseRepeatDates,
    validateRepeatDraft: validateRepeatDraft,
    rosterSlot: rosterSlot,
    initialResourceFilters: initialResourceFilters,
    reconcileResourceFilters: reconcileResourceFilters,
    filterOccurrenceItems: filterOccurrenceItems,
    repeatFormDefaults: repeatFormDefaults,
    workspaceReturnHref: workspaceReturnHref,
    occurrenceActionState: occurrenceActionState,
    occurrenceFormMode: occurrenceFormMode,
    prepareNewOccurrenceForm: prepareNewOccurrenceForm,
    hasActiveOperationsEditor: hasActiveOperationsEditor,
    consumeDeferredResourceRender: consumeDeferredResourceRender,
    conflictRecoveryMessage: conflictRecoveryMessage
  });
})();
