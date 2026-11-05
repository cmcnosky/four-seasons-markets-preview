(function () {
  'use strict';

  var API_PATH = '/api/operations';
  var VALID_SECTIONS = ['overview', 'calendar', 'applications', 'bookings', 'staff', 'policies', 'notifications', 'moderation', 'support', 'data', 'apply', 'my-bookings', 'visits', 'invite'];
  var STAFF_SECTIONS = ['overview', 'calendar', 'applications', 'bookings', 'staff', 'policies', 'notifications', 'moderation', 'support', 'data', 'invite'];
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
    backupPreview: null
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

  function routeHref(section) { return section === 'overview' ? '#operations' : '#operations/' + section; }

  function navItem(section, number, title, note) {
    var active = runtime.section === section;
    return '<a class="ops-nav-link' + (active ? ' is-active' : '') + '" href="' + routeHref(section) + '"' + (active ? ' aria-current="page"' : '') + '>' +
      '<span>' + escapeHTML(number) + '</span><b>' + escapeHTML(title) + '</b><small>' + escapeHTML(note) + '</small></a>';
  }

  function staffNav() {
    return navItem('overview', '00', 'Control board', 'Today at a glance') +
      navItem('calendar', '01', 'Markets', 'Dates, status, capacity') +
      navItem('applications', '02', 'Applications', 'Review the queue') +
      navItem('bookings', '03', 'Bookings', 'Place every vendor') +
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
    return '<section class="ops" data-operations-app>' +
      '<div class="ops-ribbon"><strong>ONE OPERATING RECORD</strong><span>Dates · decisions · vendors · public updates</span></div>' +
      '<div class="ops-layout">' +
        '<aside class="ops-rail"><header><span class="ops-kicker">Market operations</span><a href="#operations" class="ops-wordmark">FIELD<br>OFFICE</a><p>One desk for the work behind every market day.</p></header>' +
          '<nav class="ops-nav" aria-label="Market operations" data-ops-nav><div class="ops-nav-skeleton">Opening your desk…</div></nav>' +
          '<div class="ops-account" data-ops-account><span>Checking account…</span></div>' +
        '</aside>' +
        '<main class="ops-main" tabindex="-1" data-ops-main><div class="ops-live" role="status" aria-live="polite" aria-atomic="true" data-ops-live></div><div data-ops-content>' + loadingView() + '</div></main>' +
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
    if (account) account.innerHTML = '<span class="ops-kicker">Signed in · ' + escapeHTML(label(runtime.snapshot.viewer.role)) + '</span><strong>' + escapeHTML(runtime.snapshot.viewer.displayName) + '</strong><small>' + (isStaff() ? 'Staff actions are recorded in the activity log.' : 'Your saved records follow this account.') + '</small>' + (isStaff() ? '<a class="ops-link" href="#operations/apply">My vendor record →</a>' : '') + '<button type="button" data-ops-signout>Sign out ↗</button>';
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

  function overviewView() {
    var s = runtime.snapshot;
    if (!isStaff()) return vendorOverviewView();
    var openApplications = countStatus(s.applications, ['submitted', 'needs_info', 'needs_information']);
    var pendingBookings = countStatus(s.bookings, ['requested', 'waitlisted', 'approved', 'payment_due']);
    var liveMarkets = countStatus(s.occurrences, ['scheduled', 'delayed']);
    var unresolved = countStatus(s.reports, ['open', 'pending', 'reviewing']) + countStatus(s.partners, ['open', 'pending', 'in_progress']);
    var queue = [];
    s.applications.filter(function (x) { return x.status === 'submitted'; }).slice(0, 4).forEach(function (x) { queue.push({ type: 'APPLICATION', title: text(x.businessName || x.vendorName, 'Vendor application'), meta: 'Submitted ' + localDateTime(x.submittedAt || x.updatedAt), href: '#operations/applications' }); });
    s.bookings.filter(function (x) { return ['requested', 'waitlisted'].indexOf(x.status) >= 0; }).slice(0, 4).forEach(function (x) { queue.push({ type: 'BOOKING', title: bookingBusinessName(x), meta: text(x.marketName, 'Market') + ' · ' + localDate(x.date), href: '#operations/bookings' }); });
    return pageHead('00 / Owner and manager home', 'RUN THE NEXT MARKET.', 'Decisions, disruptions, and handoffs that need a person—not another spreadsheet.', '<a class="ops-button ink" href="#operations/calendar">Update a market →</a>') +
      '<section class="ops-metrics" aria-label="Operations totals">' +
        metric('01', String(openApplications), 'Application queue', openApplications ? 'Needs a reviewer' : 'Caught up') +
        metric('02', String(pendingBookings), 'Booking decisions', pendingBookings ? 'Awaiting placement' : 'No pending requests') +
        metric('03', String(liveMarkets), 'Active listings', 'Scheduled or delayed') +
        metric('04', String(unresolved), 'Open conversations', 'Reports and support') +
      '</section>' +
      '<div class="ops-two-col"><section class="ops-board mustard"><div class="ops-section-head"><div><span class="ops-kicker">Action queue</span><h2>WHO IS WAITING ON US?</h2></div><span>' + queue.length + ' shown</span></div>' +
        (queue.length ? '<div class="ops-queue">' + queue.map(function (item, index) { return '<a href="' + item.href + '"><span>' + String(index + 1).padStart(2, '0') + '</span><div><b>' + escapeHTML(item.type) + '</b><h3>' + escapeHTML(item.title) + '</h3><p>' + escapeHTML(item.meta) + '</p></div><strong aria-hidden="true">→</strong></a>'; }).join('') + '</div>' : empty('Nothing is waiting', 'New applications and booking decisions will appear here.', '')) +
        '</section><section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Next on the ground</span><h2>UPCOMING MARKETS</h2></div><a href="#operations/calendar">Full calendar →</a></div>' + occurrenceList(s.occurrences.slice().sort(sortDate).slice(0, 5), true) + '</section></div>' +
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
    return '<section class="ops-readiness"><div><span class="ops-kicker">Operating readiness</span><h2>' + set + ' OF ' + required.length + ' CORE RULES SET</h2><p>Booking automation stays visibly gated until the owner records the deadlines and decision rules staff must follow.</p></div><div class="ops-progress" aria-label="' + set + ' of ' + required.length + ' operating rules set"><span style="width:' + (set / required.length * 100) + '%"></span></div>' + (can('policies.manage') ? '<a class="ops-button outline" href="#operations/policies">Review rules →</a>' : '<span class="ops-kicker">Owner action required</span>') + '</section>';
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
    var items = runtime.snapshot.occurrences.slice().sort(sortDate);
    var calendarCallout = operatingRecordAuthorized()
      ? '<section class="ops-callout"><strong>Organizer-authorized status lives here.</strong><p>Changing a date or status updates this operating record. Notification delivery still requires configured channels and is logged separately.</p><a href="' + attr(apiUrl('/api/calendar')) + '" target="_blank" rel="noopener">Open calendar feed ↗</a></section>'
      : '<section class="ops-callout warning"><strong>Configuration and preview record.</strong><p>Dates and status changes remain a proposed operating record until the organizer approves the policies, records authority, and activates operations.</p><a href="' + attr(apiUrl('/api/calendar')) + '" target="_blank" rel="noopener">Preview calendar feed ↗</a></section>';
    return pageHead('01 / Market calendar', 'CHANGE IT ONCE.', 'One dated occurrence feeds public status, vendor availability, confirmed lineups, calendar feeds, and notices.', can('occurrences.manage') ? '<button class="ops-button ink" type="button" data-ops-toggle="occurrence-form">Add occurrence +</button>' : '') +
      calendarCallout +
      (can('occurrences.manage') ? occurrenceForm() : '') +
      '<div class="ops-toolbar"><div class="ops-field"><label for="ops-calendar-filter">Show</label><select id="ops-calendar-filter" data-ops-filter="occurrences"><option value="">All statuses</option><option value="published_listing">Published listing</option><option value="scheduled">Scheduled</option><option value="delayed">Delayed</option><option value="cancelled">Cancelled</option></select></div><p>' + items.length + ' dated records</p></div>' +
      '<section class="ops-record-grid" data-ops-list="occurrences">' + (items.length ? items.map(occurrenceCard).join('') : empty('No dated markets yet', 'Add a market occurrence after the organizer confirms its date and operating details.', '')) + '</section>';
  }

  function occurrenceForm(item) {
    item = item || {};
    return '<form class="ops-form ops-form-drawer" data-ops-form="occurrence.save" data-drawer="occurrence-form" hidden novalidate><input type="hidden" name="id" value="' + attr(item.id || '') + '"><input type="hidden" name="version" value="' + attr(item.version == null ? '' : item.version) + '"><div class="ops-form-head"><div><span class="ops-kicker">Market occurrence</span><h2>' + (item.id ? 'EDIT THE DATED RECORD' : 'ADD A DATED MARKET') + '</h2></div><button type="button" data-ops-close="occurrence-form" aria-label="Close occurrence form">×</button></div><div class="ops-form-grid">' +
      field('Market ID', 'marketId', item.marketId, 'text', true, 'richardson') + field('Market name', 'name', item.name || item.marketName, 'text', true, 'Richardson Farmers Market') +
      field('Venue', 'venue', item.venue, 'text', true, 'Dal-Rich Towne Square') + field('Date', 'date', occurrenceDate(item), 'date', true) +
      field('Street address', 'address', item.address, 'text', true, '101 S Coit Rd', 'wide') + field('City', 'city', item.city, 'text', true, 'Richardson') + field('Postal code', 'postalCode', item.postalCode, 'text', true, '75080') +
      field('Starts (Central time)', 'startsAt', marketDateTimeInput(item.startsAt), 'datetime-local', true) + field('Ends (Central time)', 'endsAt', marketDateTimeInput(item.endsAt), 'datetime-local', true) +
      selectField('Status', 'status', item.status || 'published_listing', [['published_listing','Published listing'],['scheduled','Scheduled'],['delayed','Delayed'],['cancelled','Cancelled']]) +
      field('Vendor cutoff (Central time)', 'bookingDeadlineAt', marketDateTimeInput(item.bookingDeadlineAt), 'datetime-local', false) + field('10 × 10 fee in dollars', 'fee10x10Dollars', item.fee10x10Cents == null ? '' : item.fee10x10Cents / 100, 'number', false, '45.00') +
      field('Booth capacity', 'capacity', item.capacity, 'number', false, '40') + checkboxField('Open this occurrence for booking requests after all operating-policy gates pass.', 'bookingsOpen', item.bookingsOpen === true) +
      area('Parking notes', 'parkingNotes', item.parkingNotes, 'Where vendors and shoppers should park.', 'wide') +
      area('Accessibility and venue notes', 'accessNotes', item.accessNotes, 'Step-free route, accessible parking, restrooms, pet rules, and contact details.', 'wide') +
      area('Load-in and status notes', 'loadInNotes', item.loadInNotes, 'Unload window, entry route, and clear context if the market is delayed or cancelled.', 'wide') +
      field('Source URL', 'sourceUrl', item.sourceUrl, 'url', true, 'https://www.fourseasonsmarkets.com/') + field('Source checked (Central time)', 'sourceCheckedAt', marketDateTimeInput(item.sourceCheckedAt), 'datetime-local', true) +
      '<input type="hidden" name="timeZone" value="America/Chicago">' +
      '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">Save occurrence</button><p>No automatic charge or message is sent by this save.</p></div></form>';
  }

  function occurrenceCard(item) {
    var capacity = item.capacity == null ? NaN : Number(item.capacity), occupied = occupiedCount(item.id);
    return '<article class="ops-record" data-filter-status="' + attr(item.status || 'published_listing') + '"><div class="ops-record-head"><span class="' + statusClass(item.status) + '">' + escapeHTML(label(item.status || 'published_listing')) + '</span><span>Updated ' + escapeHTML(localDateTime(item.updatedAt)) + '</span></div><h2>' + escapeHTML(occurrenceName(item)) + '</h2><p class="ops-record-lead">' + escapeHTML(localDate(occurrenceDate(item))) + (occurrenceHours(item) ? ' · ' + escapeHTML(occurrenceHours(item)) : '') + '</p><dl><div><dt>Venue</dt><dd>' + escapeHTML(text(item.venue, 'Not set')) + '</dd></div><div><dt>Booking cutoff</dt><dd>' + escapeHTML(localDateTime(item.bookingDeadlineAt)) + '</dd></div><div><dt>Fee</dt><dd>' + escapeHTML(moneyCents(item.fee10x10Cents)) + '</dd></div><div><dt>Capacity</dt><dd>' + (Number.isFinite(capacity) ? occupied + ' / ' + capacity + ' allocated or occupied' : 'Not set') + '</dd></div></dl>' + (item.loadInNotes ? '<p class="ops-note">' + escapeHTML(item.loadInNotes) + '</p>' : '') + (can('occurrences.manage') ? '<div class="ops-card-actions"><button class="ops-link" type="button" data-ops-edit-occurrence="' + attr(item.id) + '">Edit details</button><button class="ops-link" type="button" data-ops-edit-occurrence="' + attr(item.id) + '" data-next-status="delayed">Mark delayed</button><button class="ops-link danger" type="button" data-ops-edit-occurrence="' + attr(item.id) + '" data-next-status="cancelled">Cancel market</button></div>' : '') + '</article>';
  }

  function applicationsView() {
    if (!isStaff()) return applicationVendorView();
    var items = runtime.snapshot.applications.slice().sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    return pageHead('02 / Vendor applications', 'REVIEW THE BUSINESS ONCE.', 'Eligibility, documents, questions, and the decision stay attached to one reusable application.', '') + filterBar('applications', [['','All applications'],['submitted','Submitted'],['needs_info','Needs information'],['approved','Approved'],['rejected','Declined'],['withdrawn','Withdrawn']], items.length + ' applications') +
      '<section class="ops-review-list" data-ops-list="applications">' + (items.length ? items.map(applicationReviewCard).join('') : empty('No applications in the queue', 'Submitted applications will appear here with their review history.', '')) + '</section>';
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
    var items = runtime.snapshot.bookings.slice().sort(function (a, b) { return String(occurrenceDate(a)).localeCompare(String(occurrenceDate(b))); });
    return pageHead('03 / Booking control', 'PLACE EVERY VENDOR.', 'Capacity, waitlists, decisions, arrival status, and cancellation history stay with the dated market.', '') + filterBar('bookings', [['','All bookings'],['requested','Requested'],['waitlisted','Waitlisted'],['approved','Approved'],['payment_due','Payment due'],['confirmed','Confirmed'],['attended','Attended'],['cancelled','Cancelled'],['rejected','Declined']], items.length + ' booking records') +
      '<section class="ops-booking-table" data-ops-list="bookings">' + (items.length ? items.map(bookingManagerRow).join('') : empty('No booking requests', 'Vendor market-date requests will appear here after submission.', '')) + '</section>';
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
    var items = runtime.snapshot.notifications;
    var unread = items.filter(function (x) { return !x.readAt && x.read !== true; }).length;
    return pageHead(isStaff() ? '05 / Notification center' : '04 / Account messages', 'THE UPDATE AND ITS DELIVERY.', isStaff() ? 'Operational notices stay in the signed-in account with the delivery state returned by the service.' : 'Application, booking, and market-day updates stay attached to your account.', unread ? '<button class="ops-button outline" type="button" data-ops-read-all>Mark all read</button>' : '') +
      '<div class="ops-notice-layout"><section class="ops-notice-list">' + (items.length ? items.map(function (n) { var delivery = Object.keys(n.delivery || {}).map(function (key) { return key + ': ' + n.delivery[key]; }).join(' · '); var href = typeof n.href === 'string' && /^#operations(?:\/|$)/.test(n.href) ? '<a class="ops-link" href="' + attr(n.href) + '">Open related record →</a>' : ''; return '<article class="' + (!n.readAt && n.read !== true ? 'is-unread' : '') + '"><div><span class="ops-kicker">' + escapeHTML(label(n.kind || n.type || n.channel || 'Update')) + '</span><h2>' + escapeHTML(text(n.title, 'Account update')) + '</h2><p>' + escapeHTML(text(n.message || n.body)) + '</p><small>' + escapeHTML(localDateTime(n.createdAt)) + ' · ' + escapeHTML(delivery || n.deliveryStatus || 'In-account record') + '</small>' + href + '</div>' + (!n.readAt && n.read !== true ? '<button class="ops-link" type="button" data-ops-action="notification.read" data-id="' + attr(n.id) + '">Mark read</button>' : '') + '</article>'; }).join('') : empty('No account messages', 'Decisions and operational updates will appear here.', '')) + '</section>' + preferencePanel() + '</div>';
  }

  function preferencePanel() {
    return '<aside class="ops-panel ops-preferences"><span class="ops-kicker">Delivery status</span><h2>IN-ACCOUNT FIRST.</h2><p>These notices are saved with the signed-in account. Email and text delivery remain inactive until the organizer connects verified sending services, records consent rules, and tests delivery.</p><a class="ops-link" href="#account">Review account details →</a></aside>';
  }

  function moderationView() {
    var items = runtime.snapshot.reports;
    var canModerateVendor = runtime.snapshot.viewer.role !== 'market_manager' && can('moderation.manage');
    return pageHead('06 / Public content review', 'KEEP THE DIRECTORY TRUSTWORTHY.', 'Visitor reports, staff resolution, and separate vendor suspension or reinstatement actions stay recorded.', '') +
      '<section class="ops-review-list">' + (items.length ? items.map(function (r) { var actions = '<div class="ops-action-stack">' + (['resolved','dismissed'].indexOf(r.status) < 0 ? '<button class="ops-button primary" type="button" data-ops-transition="report" data-id="' + attr(r.id) + '" data-status="resolved">Resolve report</button><button class="ops-button outline" type="button" data-ops-transition="report" data-id="' + attr(r.id) + '" data-status="dismissed">Dismiss report</button>' : '') + (canModerateVendor && r.publicVendorId ? '<button class="ops-link danger" type="button" data-ops-moderate-vendor="' + attr(r.publicVendorId) + '" data-status="suspended">Suspend vendor profile</button><button class="ops-link" type="button" data-ops-moderate-vendor="' + attr(r.publicVendorId) + '" data-status="active">Reinstate vendor profile</button>' : '') + '</div>'; return '<article class="ops-review-card"><div class="ops-review-main"><div class="ops-record-head"><span class="' + statusClass(r.status) + '">' + escapeHTML(label(r.status)) + '</span><span>' + escapeHTML(localDateTime(r.createdAt)) + '</span></div><h2>' + escapeHTML(text(r.businessName || r.subject, 'Directory report')) + '</h2><p>' + escapeHTML(text(r.reason || r.details || r.message)) + '</p><dl><div><dt>Reported item</dt><dd>' + escapeHTML(text(r.targetType, 'Profile')) + '</dd></div><div><dt>Contact supplied</dt><dd>' + escapeHTML(text(r.contact, 'None')) + '</dd></div></dl></div><aside><label for="report-note-' + attr(r.id) + '">Report resolution</label><textarea id="report-note-' + attr(r.id) + '" rows="5" maxlength="2000" data-report-note="' + attr(r.id) + '"></textarea>' + actions + '</aside></article>'; }).join('') : empty('No reports awaiting review', 'New directory reports will appear here.', '')) + '</section>';
  }

  function supportView() {
    var items = runtime.snapshot.threads.concat(runtime.snapshot.partners);
    return pageHead(isStaff() ? '07 / Shared operations inbox' : '05 / Support', isStaff() ? 'KEEP THE CONTEXT WITH THE QUESTION.' : 'ASK ON THE RIGHT RECORD.', isStaff() ? 'Vendor and partner inquiries, internal notes, and resolution status stay visible to authorized staff.' : 'Include the relevant application, booking, profile, or market ID so staff can review the right record.', '<button class="ops-button ink" type="button" data-ops-toggle="support-form">New inquiry +</button>') + supportForm() +
      '<section class="ops-thread-list">' + (items.length ? items.map(function (t) { var notes = runtime.snapshot.inquiryMessages.filter(function (message) { return message.inquiryId === t.id; }); return '<article><div class="ops-record-head"><span class="' + statusClass(t.status || 'open') + '">' + escapeHTML(label(t.status || 'open')) + '</span><span>' + escapeHTML(localDateTime(t.updatedAt || t.createdAt)) + '</span></div><h2>' + escapeHTML(text(t.subject, t.organization || label(t.kind || 'support') + ' inquiry')) + '</h2><p>' + escapeHTML(text(t.preview || t.lastMessage || t.message)) + '</p><div class="ops-thread-meta"><span>' + escapeHTML(text(t.name, 'Unknown sender')) + '</span><span>' + escapeHTML(label(t.kind || 'support')) + '</span></div>' + (notes.length ? '<div class="ops-note"><strong>Internal notes</strong><ul>' + notes.slice().reverse().map(function (note) { return '<li>' + escapeHTML(note.body) + '</li>'; }).join('') + '</ul></div>' : '') + (isStaff() ? '<div class="ops-card-actions"><button class="ops-link" type="button" data-ops-note-inquiry="' + attr(t.id) + '">Add internal note →</button><button class="ops-link" type="button" data-ops-resolve-inquiry="' + attr(t.id) + '">Record internal resolution →</button></div>' : '<span class="ops-kicker">This form saves a staff-review record; it does not send an email.</span>') + '</article>'; }).join('') : empty('No open inquiries', 'Questions and partner inquiries will appear here with their linked records.', '')) + '</section>';
  }

  function supportForm() {
    return '<form class="ops-form ops-form-drawer" data-ops-form="inquiry.submit" data-public-operation="true" data-drawer="support-form" hidden novalidate><div class="ops-form-head"><div><span class="ops-kicker">Shared inquiry</span><h2>START WITH THE CONTEXT</h2></div><button type="button" data-ops-close="support-form" aria-label="Close inquiry form">×</button></div><div class="ops-form-grid">' + selectField('Inquiry type', 'kind', 'support', [['support','Vendor or customer support'],['property','Property / market location'],['sponsor','Sponsor / partner'],['media','Media']]) + field('Name', 'name', runtime.snapshot && runtime.snapshot.viewer.displayName, 'text', true, 'Your name') + field('Reply email', 'email', '', 'email', true, 'you@example.com') + field('Phone', 'phone', '', 'tel', false, 'Optional callback number') + field('Organization', 'organization', '', 'text', false, 'Business, city, or organization') + area('Message', 'message', '', 'Include the relevant application, booking, profile, or market ID in the message when applicable. Do not send passwords or payment-card data.', 'wide', true) + '</div><div class="ops-form-actions"><button class="ops-button primary" type="submit">Submit inquiry</button><p>This saves an inquiry for staff review. It does not prove that an email was sent or delivered.</p></div></form>';
  }

  function dataView() {
    var audit = runtime.snapshot.audit;
    var backup = runtime.latestBackup;
    var preview = runtime.backupPreview;
    var ownerOrAdmin = ['owner', 'admin'].indexOf(runtime.snapshot.viewer.role) >= 0;
    return pageHead('09 / Records and recovery', 'TAKE THE RECORD WITH YOU.', 'Portable exports, activity history, verified snapshots, and non-destructive restore previews keep the operating record recoverable.', can('data.export') ? '<button class="ops-button ink" type="button" data-ops-export="full">Download visible archive</button>' : '') +
      '<section class="ops-data-grid"><article class="ops-board green"><span class="ops-kicker">Portable records</span><h2>EXPORT BY OPERATING AREA</h2><p>These downloads contain the records currently returned to this signed-in role.</p><div class="ops-export-buttons"><button type="button" data-ops-export="applications">Applications CSV</button><button type="button" data-ops-export="bookings">Bookings CSV</button><button type="button" data-ops-export="occurrences">Market calendar CSV</button><button type="button" data-ops-export="full">Visible JSON</button></div></article><article class="ops-panel"><span class="ops-kicker">Database recovery</span><h2>' + (preview ? 'PREVIEW VERIFIED' : backup ? 'SNAPSHOT CREATED' : 'NO SNAPSHOT SELECTED') + '</h2><p>Server snapshots are integrity-checked before preview. Restore is owner-only, preserves current rows, and returns only records missing from the current database.</p>' + (ownerOrAdmin ? '<button class="ops-button primary" type="button" data-ops-backup-create>Create server snapshot</button><form class="ops-inline-form" data-ops-backup-preview><label for="ops-backup-id">Snapshot ID</label><input id="ops-backup-id" name="id" required value="' + attr(backup && backup.id || preview && preview.id || '') + '" placeholder="backup_…"><button class="ops-button outline" type="submit">Verify restore preview</button></form>' : '<p>Your role can export visible data but cannot create or restore server snapshots.</p>') + (backup ? '<p class="ops-note"><strong>Latest snapshot:</strong> ' + escapeHTML(backup.id) + '<br><strong>Integrity hash:</strong> ' + escapeHTML(backup.sha256) + '</p>' : '') + (preview ? '<div class="ops-note"><strong>Restore mode:</strong> Missing records only<br><strong>Created:</strong> ' + escapeHTML(localDateTime(preview.createdAt)) + '<br><strong>Snapshot counts:</strong> ' + escapeHTML(Object.keys(preview.counts || {}).map(function (key) { return key + ' ' + preview.counts[key]; }).join(' · ')) + '</div>' + (runtime.snapshot.viewer.role === 'owner' ? '<button class="ops-button danger" type="button" data-ops-backup-restore="' + attr(preview.id) + '">Restore missing records…</button>' : '') : '') + '</article></section>' +
      '<section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Launch connection checklist</span><h2>WHAT STILL NEEDS AN OWNER DECISION?</h2></div><span>Independent proposal status</span></div><div class="ops-checklist"><p><strong>Official authority:</strong> organizer approval, staff roles, market scopes, and operating policies.</p><p><strong>Domain and sender:</strong> final domain, DNS control, verified email sender, consent and unsubscribe rules, and real inbox delivery tests.</p><p><strong>Text messages:</strong> provider, sender registration, explicit opt-in records, quiet hours, STOP handling, and device delivery tests.</p><p><strong>Payments:</strong> approved provider and account owner, fee authority, refund/credit rules, reconciliation, disputes, and test transactions before any live charge path.</p><p><strong>Migration:</strong> source inventory, deduplication, record ownership, document retention, rehearsal import, reconciliation, and signed cutover approval.</p></div></section>' +
      '<section class="ops-panel"><div class="ops-section-head"><div><span class="ops-kicker">Activity history</span><h2>WHO CHANGED WHAT?</h2></div><span>' + audit.length + ' events</span></div><div class="ops-audit-list">' + (audit.length ? audit.slice(0, 100).map(function (e) { return '<article><span>' + escapeHTML(localDateTime(e.createdAt || e.at)) + '</span><strong>' + escapeHTML(text(e.actorRole || e.actorSubject || e.actor, 'System')) + '</strong><b>' + escapeHTML(label(e.action)) + '</b><p>' + escapeHTML(text(e.summary || e.reason || e.entityType + ' ' + e.entityId)) + '</p></article>'; }).join('') : '<p>No activity events returned.</p>') + '</div></section>';
  }

  function filterBar(name, options, count) {
    return '<div class="ops-toolbar"><div class="ops-field"><label for="ops-filter-' + attr(name) + '">Show</label><select id="ops-filter-' + attr(name) + '" data-ops-filter="' + attr(name) + '">' + options.map(function (x) { return '<option value="' + attr(x[0]) + '">' + escapeHTML(x[1]) + '</option>'; }).join('') + '</select></div><p>' + escapeHTML(count) + '</p></div>';
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
      var required = { staff: 'staff.manage', policies: 'policies.manage', moderation: 'moderation.manage', support: 'inquiries.manage', data: 'data.export' }[runtime.section];
      var backupRole = runtime.section === 'data' && ['owner', 'admin'].indexOf(runtime.snapshot.viewer.role) >= 0;
      if (required && !can(required) && !backupRole) return pageHead('Scoped staff access', 'THIS ROLE DOES NOT HOLD THAT KEY.', 'An owner or administrator can change staff responsibilities and market scopes from Team access.', '<a class="ops-button outline" href="#operations">Return to control board →</a>');
    }
    var views = { overview: overviewView, calendar: calendarView, applications: applicationsView, bookings: bookingsView, staff: staffView, policies: policiesView, notifications: notificationsView, moderation: moderationView, support: supportView, data: dataView, apply: applicationVendorView, 'my-bookings': vendorBookingsView, visits: visitsView, invite: inviteView };
    return (views[runtime.section] || overviewView)();
  }

  function authorizationBanner() {
    if (!isStaff() || operatingRecordAuthorized()) return '';
    return '<section class="ops-authorization-warning" role="status"><strong>INDEPENDENT PREVIEW · LIVE OPERATIONS NOT AUTHORIZED</strong><p>Staff can configure dates, policies, and workflows for review. Until the organizer explicitly records authorization, this system must not be treated as the official source for booking, inventory, payment, or market status.</p>' + (can('policies.manage') ? '<a href="#operations/policies">Review authorization and operating rules →</a>' : '<span>Owner policy authorization is still required.</span>') + '</section>';
  }

  function boundedRecordsBanner() {
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
    return '<section class="ops-limit-warning" role="status"><strong>BOUNDED ADMIN VIEW</strong><p>Showing the ' + escapeHTML(details) + ' returned to this account. Older records are not included in this view or its exports.</p></section>';
  }

  function renderCurrent() {
    if (!runtime.root || !runtime.snapshot) return;
    updateShell();
    var content = runtime.root.querySelector('[data-ops-content]');
    if (content) content.innerHTML = authorizationBanner() + boundedRecordsBanner() + viewForSection();
    bindCurrent();
    var main = runtime.root.querySelector('[data-ops-main]');
    if (main) main.focus({ preventScroll: true });
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

  async function load() {
    if (!runtime.root || runtime.loading) return;
    runtime.loading = true;
    var requestId = ++runtime.requestId;
    if (runtime.controller) runtime.controller.abort();
    runtime.controller = typeof AbortController === 'function' ? new AbortController() : null;
    try {
      if (!window.FSMAuth || typeof window.FSMAuth.ready !== 'function') throw new Error('Account sign-in could not load.');
      var auth = await window.FSMAuth.ready();
      if (requestId !== runtime.requestId || !runtime.root) return;
      if (auth.phase !== 'authenticated') { renderAuthFallback(); return; }
      var data = await request('GET', vendorSection() ? API_PATH + '?view=vendor' : API_PATH, null, { signal: runtime.controller && runtime.controller.signal });
      if (requestId !== runtime.requestId || !runtime.root) return;
      runtime.snapshot = normalise(data);
      renderCurrent();
    } catch (error) {
      if (error.code === 'aborted' || requestId !== runtime.requestId || !runtime.root) return;
      if (error.status === 401 || error.status === 403 && error.data && error.data.error === 'email_verification_required') { renderAuthFallback(); return; }
      var content = runtime.root.querySelector('[data-ops-content]');
      if (content) content.innerHTML = errorView(error.message);
      bindCurrent();
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
    if (typeof window.renderVendorApp === 'function') {
      content.innerHTML = '<div class="ops-auth-gate">' + window.renderVendorApp('overview') + '</div>';
      if (typeof window.initVendorApp === 'function') window.initVendorApp('overview');
    } else {
      content.innerHTML = '<section class="ops-state-panel"><span>ACCOUNT</span><div><h1>SIGN IN TO CONTINUE.</h1><p>Use email/password or Google sign-in to open applications, bookings, and staff tools.</p><a class="ops-button primary" href="#workspace">Open account sign-in →</a></div></section>';
    }
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
    return runtime.snapshot && runtime.snapshot.occurrences.find(function (item) { return String(item.id) === String(occurrenceId); }) || null;
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
      function finish(value) { try { dialog.close(); } catch {} dialog.remove(); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(null); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(null); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(formPayload(event.currentTarget)); });
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      dialog.querySelector('textarea').focus();
    });
  }

  function staffAccessDialog(member) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>STAFF ACCESS</span><strong aria-hidden="true">→</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(text(member.displayName, 'Staff member')) + '</h2><p>Change only the responsibility and market scope this person needs. The access change is written to the activity history.</p><div class="ops-field"><label for="ops-member-role">Role</label><select id="ops-member-role" name="role"><option value="admin"' + selected(member.role,'admin') + '>Administrator</option><option value="operations"' + selected(member.role,'operations') + '>Operations</option><option value="market_manager"' + selected(member.role,'market_manager') + '>Market manager</option><option value="vendor_reviewer"' + selected(member.role,'vendor_reviewer') + '>Vendor reviewer</option><option value="content"' + selected(member.role,'content') + '>Content</option><option value="finance"' + selected(member.role,'finance') + '>Finance</option><option value="check_in"' + selected(member.role,'check_in') + '>Check-in staff</option><option value="readonly"' + selected(member.role,'readonly') + '>Read only</option></select></div><div class="ops-field"><label for="ops-member-markets">Market access</label><input id="ops-member-markets" name="marketScopes" value="' + attr(array(member.marketScopes).join(', ')) + '"></div><div class="ops-field"><label for="ops-member-status">Access status</label><select id="ops-member-status" name="status"><option value="active"' + selected(member.status || 'active','active') + '>Active</option><option value="disabled"' + selected(member.status,'disabled') + '>Disabled</option></select></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button primary" type="submit">Save access</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { try { dialog.close(); } catch {} dialog.remove(); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(null); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(null); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); finish(formPayload(event.currentTarget)); });
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      dialog.querySelector('select').focus();
    });
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
      renderCurrent();
      announce(message || 'Saved.', 'success');
      return result;
    } catch (error) {
      if (error.status === 409) await load();
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
      function finish(value) { if (settled) return; settled = true; try { dialog.close(); } catch {} dialog.remove(); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(false); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(false); });
      dialog.querySelector('[data-accept]').addEventListener('click', function () { finish(true); });
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      dialog.querySelector('[data-accept]').focus();
    });
  }

  function reasonDialog(title, body, labelText) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>REASON REQUIRED</span><strong aria-hidden="true">!</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(title) + '</h2><p>' + escapeHTML(body) + '</p><div class="ops-field"><label for="ops-required-reason">Reason</label><textarea id="ops-required-reason" name="reason" rows="5" minlength="3" maxlength="1000" required></textarea></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button danger" type="submit">' + escapeHTML(labelText) + '</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { try { dialog.close(); } catch {} dialog.remove(); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(''); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(''); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(text(event.currentTarget.elements.reason.value)); });
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      dialog.querySelector('textarea').focus();
    });
  }

  function internalNoteDialog(title) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>INTERNAL NOTE</span><strong aria-hidden="true">→</strong></div><form class="ops-dialog-body"><h2>' + escapeHTML(title) + '</h2><p>This note is visible to authorized staff in the operations record. It does not send a reply.</p><div class="ops-field"><label for="ops-internal-note">Note</label><textarea id="ops-internal-note" name="body" rows="6" maxlength="4000" required></textarea></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button primary" type="submit">Save internal note</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { try { dialog.close(); } catch {} dialog.remove(); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(''); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(''); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(text(event.currentTarget.elements.body.value)); });
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      dialog.querySelector('textarea').focus();
    });
  }

  function showInviteToken(result) {
    if (!result || !result.token) return;
    var dialog = document.createElement('dialog');
    dialog.className = 'ops-dialog';
    dialog.innerHTML = '<div class="ops-dialog-head"><span>ONE-TIME STAFF TOKEN</span><strong aria-hidden="true">→</strong></div><div class="ops-dialog-body"><h2>COPY IT NOW.</h2><p>This interface does not send an email. Share the token only with the intended teammate through a trusted channel. It expires ' + escapeHTML(localDateTime(result.expiresAt)) + '.</p><div class="ops-field"><label for="ops-created-token">Invitation token</label><textarea id="ops-created-token" rows="4" readonly>' + escapeHTML(result.token) + '</textarea></div><p>Ask the teammate to sign in, open <strong>#operations/invite</strong>, and submit this token. Their request still requires explicit staff approval.</p><div><button class="ops-button outline" type="button" data-copy>Copy token</button><button class="ops-button primary" type="button" data-close>Done</button></div></div>';
    runtime.root.appendChild(dialog);
    function close() { try { dialog.close(); } catch {} dialog.remove(); }
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.querySelector('[data-copy]').addEventListener('click', async function () { var value = result.token; try { await navigator.clipboard.writeText(value); announce('Invitation token copied.', 'success'); } catch { var field = dialog.querySelector('textarea'); field.focus(); field.select(); announce('Select and copy the highlighted token.', 'error'); } });
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.querySelector('textarea').focus();
  }

  function restoreConfirmationDialog(id) {
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'ops-dialog';
      dialog.innerHTML = '<div class="ops-dialog-head"><span>OWNER RECOVERY GATE</span><strong aria-hidden="true">!</strong></div><form class="ops-dialog-body"><h2>RESTORE MISSING RECORDS?</h2><p>The server preserves every current row and attempts to return only records missing from snapshot ' + escapeHTML(id) + '. Type <strong>RESTORE MISSING RECORDS</strong> to continue.</p><div class="ops-field"><label for="ops-restore-confirm">Confirmation phrase</label><input id="ops-restore-confirm" name="confirm" autocomplete="off" required pattern="RESTORE MISSING RECORDS"></div><div><button class="ops-button outline" type="button" data-cancel>Go back</button><button class="ops-button danger" type="submit">Run missing-record recovery</button></div></form>';
      runtime.root.appendChild(dialog);
      function finish(value) { try { dialog.close(); } catch {} dialog.remove(); resolve(value); }
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(false); });
      dialog.querySelector('[data-cancel]').addEventListener('click', function () { finish(false); });
      dialog.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; finish(true); });
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      dialog.querySelector('input').focus();
    });
  }

  function bindCurrent() {
    if (!runtime.root) return;
    var retry = runtime.root.querySelector('[data-ops-retry]'); if (retry) retry.addEventListener('click', load);
    runtime.root.querySelectorAll('[data-ops-toggle]').forEach(function (button) { button.addEventListener('click', function () { var drawer = runtime.root.querySelector('[data-drawer="' + CSS.escape(button.dataset.opsToggle) + '"]'); if (drawer) { drawer.hidden = false; drawer.scrollIntoView({ behavior: 'smooth', block: 'start' }); drawer.querySelector('input,select,textarea')?.focus(); } }); });
    runtime.root.querySelectorAll('[data-ops-close]').forEach(function (button) { button.addEventListener('click', function () { var drawer = runtime.root.querySelector('[data-drawer="' + CSS.escape(button.dataset.opsClose) + '"]'); if (drawer) drawer.hidden = true; }); });
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
        try { await publicOperation(action, payload); form.reset(); form.hidden = true; announce('Inquiry saved for staff review. No external delivery is claimed.', 'success'); }
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
      setFormValues(form, { name: item.name || item.marketName, date: occurrenceDate(item), startsAt: marketDateTimeInput(item.startsAt), endsAt: marketDateTimeInput(item.endsAt), bookingDeadlineAt: marketDateTimeInput(item.bookingDeadlineAt), sourceCheckedAt: marketDateTimeInput(item.sourceCheckedAt), fee10x10Dollars: item.fee10x10Cents == null ? '' : item.fee10x10Cents / 100, status: button.dataset.nextStatus || item.status || 'published_listing', version: item.version });
      form.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (button.dataset.nextStatus) form.elements.namedItem('loadInNotes')?.focus(); else form.elements.namedItem('name')?.focus();
    }); });
    runtime.root.querySelectorAll('[data-ops-action]').forEach(function (button) { button.addEventListener('click', async function () {
      var action = button.dataset.opsAction;
      var source = action.indexOf('application.') === 0 ? runtime.snapshot.applications : runtime.snapshot.notifications;
      var record = source.find(function (item) { return String(item.id) === String(button.dataset.id); });
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
      var source = kind === 'application' ? runtime.snapshot.applications : kind === 'booking' ? runtime.snapshot.bookings : runtime.snapshot.reports;
      var record = source.find(function (item) { return String(item.id) === String(recordId); });
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
    var readAll = runtime.root.querySelector('[data-ops-read-all]'); if (readAll) readAll.addEventListener('click', async function () { var unreadIds = runtime.snapshot.notifications.filter(function (item) { return !item.readAt && item.read !== true; }).map(function (item) { return item.id; }); if (!unreadIds.length) return; await mutate('notification.read-all', { ids: unreadIds }, readAll, 'All visible notifications marked read.'); });
    runtime.root.querySelectorAll('[data-ops-resolve-inquiry]').forEach(function (button) { button.addEventListener('click', async function () { var item = runtime.snapshot.partners.concat(runtime.snapshot.threads).find(function (candidate) { return String(candidate.id) === String(button.dataset.opsResolveInquiry); }); if (!item) return; var resolution = await inquiryResolutionDialog(item); if (!resolution) return; await mutate('staff.inquiry.resolve', { id: item.id, version: item.version, status: resolution.status, resolution: resolution.resolution }, button, 'Internal inquiry resolution saved. No outbound message was sent.'); }); });
    runtime.root.querySelectorAll('[data-ops-note-inquiry]').forEach(function (button) { button.addEventListener('click', async function () { var item = runtime.snapshot.partners.find(function (candidate) { return String(candidate.id) === String(button.dataset.opsNoteInquiry); }); if (!item) return; var body = await internalNoteDialog(text(item.organization, label(item.kind || 'support') + ' inquiry')); if (!body) return; await mutate('staff.inquiry.note', { id: item.id, body: body }, button, 'Internal note saved. No outbound reply was sent.'); }); });
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

  function exportLocal(kind) {
    var list = kind === 'full' ? runtime.snapshot.raw : runtime.snapshot[kind] || [];
    var content, mime, extension;
    if (kind === 'full') { content = JSON.stringify(list, null, 2); mime = 'application/json'; extension = 'json'; }
    else { var rows = array(list); var keys = Array.from(new Set(rows.flatMap(function (row) { return Object.keys(row); }))).filter(function (key) { return typeof (rows[0] || {})[key] !== 'object'; }); var csvCell = function (value) { var cell = String(value == null ? '' : value); if (/^[=+\-@]/.test(cell.trimStart())) cell = "'" + cell; return '"' + cell.replace(/"/g, '""') + '"'; }; content = [keys.map(csvCell).join(',')].concat(rows.map(function (row) { return keys.map(function (key) { return csvCell(row[key]); }).join(','); })).join('\r\n'); mime = 'text/csv'; extension = 'csv'; }
    var url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' })); var link = document.createElement('a'); link.href = url; link.download = 'four-seasons-' + kind + '-' + new Date().toISOString().slice(0,10) + '.' + extension; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 3000); announce('Export downloaded from the records currently visible to this account.', 'success');
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
    if (runtime.unsubscribe) runtime.unsubscribe();
    if (window.FSMAuth && typeof window.FSMAuth.onChange === 'function') {
      runtime.unsubscribe = window.FSMAuth.onChange(function (state) {
        if (!runtime.root || !runtime.root.isConnected) return;
        var nextKey = state.user && state.user.userKey || '';
        var changed = runtime.authUserKey !== nextKey;
        if (changed) {
          runtime.authUserKey = nextKey;
          runtime.snapshot = null;
          runtime.staffAccessSeen = false;
          runtime.latestBackup = null;
          runtime.backupPreview = null;
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
})();
