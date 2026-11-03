(function () {
  'use strict';

  var API_URL = '/api/workspace';
  var STORAGE_PREFIX = 'fsm-github-preview-drafts-v1:';
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
    lastFocusedId: ''
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
    return {
      version: Number.isFinite(Number(payload.version)) ? Number(payload.version) : Number(state.version) || 0,
      user: {
        displayName: safeString((payload.user && payload.user.displayName) || (state.user && state.user.displayName) || 'Vendor', 120)
      },
      profile: normaliseProfile(state.profile),
      reservations: (Array.isArray(state.reservations) ? state.reservations : []).map(normaliseReservation),
      offers: (Array.isArray(state.offers) ? state.offers : []).map(normaliseOffer),
      promotions: (Array.isArray(state.promotions) ? state.promotions : (Array.isArray(state.campaigns) ? state.campaigns : [])).map(normalisePromotion)
    };
  }

  function readDraft(name) {
    try {
      var raw = window.localStorage.getItem(STORAGE_PREFIX + name);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function writeDraft(name, value) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
      return true;
    } catch (_error) {
      announce('This browser could not save the unfinished draft. Keep this page open until you save.', 'error');
      return false;
    }
  }

  function clearDraft(name) {
    try { window.localStorage.removeItem(STORAGE_PREFIX + name); } catch (_error) { /* no-op */ }
  }

  function navItem(section, number, label, note) {
    var href = section === 'overview' ? '#workspace' : '#workspace/' + section;
    var active = runtime.section === section;
    return '<a class="vapp-nav-link' + (active ? ' is-active' : '') + '" href="' + href + '"' + (active ? ' aria-current="page"' : '') + '>' +
      '<span class="vapp-nav-number">' + number + '</span><span><strong>' + escapeHTML(label) + '</strong><small>' + escapeHTML(note) + '</small></span></a>';
  }

  function renderVendorApp(section) {
    runtime.section = VALID_SECTIONS.indexOf(section) > -1 ? section : 'overview';
    return '<section class="vapp" data-vendor-app>' +
      '<div class="vapp-preview-bar"><strong>Vendor demo</strong><span aria-hidden="true">·</span><span>Saved in this browser only · No real bookings</span></div>' +
      '<div class="vapp-frame">' +
        '<aside class="vapp-sidebar">' +
          '<div class="vapp-side-head"><span class="vapp-kicker">Vendor workspace</span><a href="#workspace" class="vapp-wordmark">MARKET<br>DESK</a><p>Plan your markets. Promote your business.</p></div>' +
          '<nav class="vapp-nav" aria-label="Vendor workspace">' +
            navItem('overview', '00', 'Overview', 'What needs attention') +
            navItem('reservations', '01', 'Reservations', 'Request market space') +
            navItem('offers', '02', 'Offers', 'Give shoppers a reason') +
            navItem('profile', '03', 'Profile', 'Publish your storefront') +
            navItem('promotions', '04', 'Promotions', 'Make market-day media') +
          '</nav>' +
          '<div class="vapp-side-foot"><span>Demo records stay in this browser</span><a href="#vendors">View shopper directory ↗</a></div>' +
        '</aside>' +
        '<div class="vapp-main" id="vapp-main" tabindex="-1">' +
          '<div class="vapp-live" data-vapp-live role="status" aria-live="polite" aria-atomic="true"></div>' +
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
    return '<section class="vapp-error-panel" role="alert"><span class="vapp-panel-number">STORAGE</span><div><h1>The market desk did not open.</h1><p>' + escapeHTML(message || 'The saved workspace could not be loaded.') + '</p><button class="vapp-button primary" type="button" data-vapp-retry>Try again</button><p class="vapp-fine">Any unfinished form draft already saved in this browser is still here.</p></div></section>';
  }

  async function apiRequest(method, body) {
    var response;
    try {
      response = await window.FSMPreview.request(API_URL, {
        method: method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', 'Accept': 'application/json' } : { 'Accept': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (_error) {
      var networkError = new Error('Browser storage did not respond. Allow local storage for this site and try again.');
      networkError.code = 'network';
      throw networkError;
    }

    var data = null;
    try { data = await response.json(); } catch (_error) { data = null; }

    if (!response.ok) {
      var errorMessages = {
        duplicate_reservation_request: 'A request for that market date is already saved. Cancel it before creating another.',
        reservation_already_cancelled: 'That request is already cancelled.',
        reservation_not_found: 'That saved request could not be found. Reload the workspace and try again.',
        offer_not_found: 'That offer could not be found. Reload the workspace and try again.',
        offer_already_archived: 'That offer is already archived.',
        promotion_not_found: 'That campaign could not be found. Reload the workspace and try again.',
        occurrence_not_verified: 'That market and date pair is not available in this preview.',
        past_occurrence: 'That market occurrence has passed and can no longer be requested.',
        reservation_market_mismatch: 'The selected reservation does not match this campaign market.',
        offer_market_mismatch: 'The selected offer is not associated with this campaign market.',
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
    if (!runtime.root || runtime.loading) return;
    if (!force && runtime.snapshot && Date.now() - runtime.loadedAt < 60000) {
      renderCurrentSection();
      return;
    }

    runtime.loading = true;
    var requestId = ++runtime.requestId;
    var content = runtime.root.querySelector('[data-vapp-content]');
    if (!runtime.snapshot && content) content.innerHTML = loadingView();

    try {
      var payload = await apiRequest('GET');
      if (requestId !== runtime.requestId || !runtime.root) return;
      runtime.snapshot = normaliseSnapshot(payload);
      runtime.loadedAt = Date.now();
      renderCurrentSection();
    } catch (error) {
      if (requestId !== runtime.requestId || !runtime.root) return;
      if (content) content.innerHTML = errorView(error.message);
      bindRetry();
    } finally {
      runtime.loading = false;
    }
  }

  async function mutate(action, payload, button, successMessage) {
    if (runtime.busy || !runtime.snapshot) return null;
    runtime.busy = true;
    setPending(button, true);
    try {
      var result = await apiRequest('PATCH', {
        version: runtime.snapshot.version,
        action: action,
        payload: payload
      });
      var previousUser = runtime.snapshot.user;
      runtime.snapshot = normaliseSnapshot(result);
      if (!result.user) runtime.snapshot.user = previousUser;
      runtime.loadedAt = Date.now();
      renderCurrentSection();
      announce(successMessage || 'Saved.', 'success');
      return result;
    } catch (error) {
      if (error.status === 409 && error.data && error.data.state) {
        var conflictUser = runtime.snapshot.user;
        runtime.snapshot = normaliseSnapshot(error.data);
        runtime.snapshot.user = conflictUser;
        runtime.loadedAt = Date.now();
        renderCurrentSection();
        announce('This workspace changed in another tab. The latest saved version is now shown; your unfinished browser draft was kept.', 'error');
      } else {
        setPending(button, false);
        announce(error.message || 'The change could not be saved. Your unfinished draft was kept.', 'error');
      }
      return null;
    } finally {
      runtime.busy = false;
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
    var labels = { requested: 'Requested in preview', cancelled: 'Cancelled', draft: 'Draft', published: 'Published', archived: 'Archived' };
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
    var activeReservations = state.reservations.filter(function (item) { return item.status === 'requested'; });
    var publishedOffers = state.offers.filter(function (item) { return item.status === 'published'; });
    var name = state.profile.businessName || state.user.displayName || 'Vendor';
    var recent = state.reservations.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 3);
    var needs = [];
    if (!state.profile.businessName) needs.push('<a href="#workspace/profile"><span>01</span><strong>Start your demo profile</strong><small>Give shoppers a name, city, and reason to stop.</small></a>');
    else if (!state.profile.published) needs.push('<a href="#workspace/profile"><span>01</span><strong>Publish your profile</strong><small>Your saved profile is still a draft.</small></a>');
    if (!activeReservations.length) needs.push('<a href="#workspace/reservations"><span>02</span><strong>Request a market date</strong><small>Choose one of the currently sourced November 7–8 dates.</small></a>');
    if (!publishedOffers.length) needs.push('<a href="#workspace/offers"><span>03</span><strong>Make a shopper offer</strong><small>Save a draft or publish it to your new directory profile.</small></a>');
    if (activeReservations.length && !state.promotions.length) needs.push('<a href="#workspace/promotions"><span>04</span><strong>Build market-day creative</strong><small>Turn a reservation and offer into a post-ready graphic.</small></a>');

    return pageHeader('Vendor overview', 'HELLO, ' + name.toUpperCase(), 'One desk for your preview directory and market-day planning.', '<a class="vapp-button ink" href="#workspace/reservations">Plan a market date →</a>') +
      '<section class="vapp-scoreboard" aria-label="Workspace totals">' +
        metric('01', String(activeReservations.length), 'Requested dates', 'Not booth approvals') +
        metric('02', state.profile.published ? 'ON' : 'OFF', 'Directory profile', state.profile.published ? 'Published in preview' : 'Draft in this browser') +
        metric('03', String(publishedOffers.length), 'Published offers', 'In your local directory') +
        metric('04', String(state.promotions.length), 'Saved campaigns', 'Not posted to social media') +
      '</section>' +
      '<div class="vapp-overview-grid">' +
        '<section class="vapp-poster-panel mustard"><div class="vapp-panel-title"><span>UP NEXT</span><h2>Keep the stall moving.</h2></div><div class="vapp-task-list">' +
          (needs.length ? needs.slice(0, 4).join('') : '<div class="vapp-all-set"><strong>Everything in this preview has a saved next step.</strong><p>Review dates and offers whenever your plans change.</p></div>') +
        '</div></section>' +
        '<section class="vapp-ledger"><div class="vapp-section-bar"><div><span class="vapp-kicker">Reservation ledger</span><h2>Recent requests</h2></div><a href="#workspace/reservations">See all →</a></div>' +
          (recent.length ? recent.map(reservationRow).join('') : emptyState('00', 'No requests yet', 'Choose a sourced market date to start a preview request.', '<a class="vapp-text-link" href="#workspace/reservations">Open reservations →</a>')) +
        '</section>' +
      '</div>' +
      '<section class="vapp-ground-rules"><strong>What this preview does</strong><p>It saves demo records in this browser. Publishing adds profiles and offers to your local directory; they are not shared with other browsers. Anyone using this browser profile can see the saved work. Clearing browser data removes it. It does not charge a card, allocate a booth, or send requests to market staff.</p></section>';
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
    return pageHeader('01 / Reservations', 'REQUEST A MARKET DATE', 'Choose a sourced date and save a demo request in this browser. It is not sent to staff or confirmed as a booking.', '') +
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
          '<div class="vapp-form-actions"><button class="vapp-button primary" type="submit">Save request</button><p>Creates “Requested in preview.” No charge or booth allocation.</p></div>' +
        '</form>' +
        '<section class="vapp-stack"><div class="vapp-section-bar"><div><span class="vapp-kicker">Your request ledger</span><h2>Saved requests</h2></div><span>' + requests.length + ' total</span></div>' +
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
    return '<span>REVIEW</span><strong>' + escapeHTML(item.short + ' · ' + booth) + '</strong><b>' + escapeHTML(price) + '</b><small>Requested in preview · not approved</small>';
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
    var marketSelect = form.querySelector('[name="marketId"]');
    var notes = form.querySelector('[name="notes"]');

    function capture() {
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
      }, event.submitter, 'Request saved as “Requested in preview.” No booth was allocated and no charge was made.');
      if (result) { clearDraft('reservation'); renderCurrentSection(); }
    });

    runtime.root.querySelectorAll('[data-cancel-reservation]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (!window.confirm('Cancel this preview request? This does not affect any reservation outside the redesigned site.')) return;
        await mutate('reservation.cancel', { id: button.getAttribute('data-cancel-reservation') }, button, 'Preview request cancelled.');
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
    return pageHeader('02 / Offers', 'MAKE THE OFFER CLEAR', 'Build a date-limited reason to visit. Publish only when the copy, dates, and market association are ready.', '<button class="vapp-button ink" type="button" data-new-offer>New offer +</button>') +
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
    return '<article class="vapp-record offer-record' + (offer.status === 'archived' ? ' is-muted' : '') + '"><div class="vapp-record-top"><span class="vapp-status ' + attr(offer.status) + '">' + escapeHTML(statusLabel(offer.status)) + '</span><span>' + escapeHTML(formatTimestamp(offer.updatedAt || offer.createdAt)) + '</span></div><h3>' + escapeHTML(offer.title || 'Untitled offer') + '</h3><p>' + escapeHTML(offer.description || 'No shopper-facing details yet.') + '</p><div class="vapp-tag-row">' + markets.map(function (name) { return '<span>' + escapeHTML(name) + '</span>'; }).join('') + '</div><dl><div><dt>Date limit</dt><dd>' + escapeHTML(offer.startDate ? formatDate(offer.startDate, false) : 'Not set') + ' → ' + escapeHTML(offer.endDate ? formatDate(offer.endDate, false) : 'Not set') + '</dd></div></dl>' +
      (offer.status === 'published' ? '<p class="vapp-visibility"><strong>VISIBLE IN YOUR LOCAL DEMO</strong><span>Only in this browser, while the offer is in date and the demo profile is published.</span></p>' : '') +
      '<div class="vapp-record-actions"><button class="vapp-text-button" type="button" data-edit-offer="' + attr(offer.id) + '">Edit</button>' + (offer.status !== 'archived' ? '<button class="vapp-text-button danger" type="button" data-archive-offer="' + attr(offer.id) + '">Archive</button>' : '') + '</div></article>';
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
    function capture() {
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
      }
      offer.status = intent;
      if (!offer.id) delete offer.id;
      var result = await mutate('offer.save', offer, event.submitter, intent === 'published' ? 'Demo offer saved in this browser’s directory.' : 'Offer draft saved.');
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
    runtime.root.querySelectorAll('[data-archive-offer]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (!window.confirm('Archive this offer? It will stop appearing in the new directory.')) return;
        await mutate('offer.archive', { id: button.getAttribute('data-archive-offer') }, button, 'Offer archived and removed from this browser’s demo directory.');
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
    return pageHeader('03 / Profile', 'YOUR MARKET TABLE', 'Build a demo storefront and preview it in your local directory. Your saved profile appears only in this browser’s demo directory.', '') +
      (restored ? '<div class="vapp-draft-notice"><strong>UNFINISHED BROWSER DRAFT RESTORED</strong><span>Save or publish when you are ready.</span><button type="button" data-discard-profile>Discard local draft</button></div>' : '') +
      '<div class="vapp-profile-grid">' +
        '<form class="vapp-editor" id="vapp-profile-form" novalidate data-server-published="' + String(server.published) + '">' +
          '<div class="vapp-editor-head mustard"><span>PROFILE EDITOR</span><strong>Useful beats clever.</strong></div>' +
          '<div class="vapp-two-fields"><div class="vapp-field"><label for="vapp-business-name">Business name</label><input id="vapp-business-name" name="businessName" maxlength="80" autocomplete="organization" required value="' + attr(draft.businessName) + '" placeholder="Your market business"></div><div class="vapp-field"><label for="vapp-city">Home city</label><input id="vapp-city" name="city" maxlength="80" autocomplete="address-level2" value="' + attr(draft.city) + '" placeholder="City, Texas"></div></div>' +
          '<div class="vapp-field"><label for="vapp-profile-short">Short description</label><textarea id="vapp-profile-short" name="shortDescription" maxlength="120" rows="3" required placeholder="One direct sentence about what shoppers will find.">' + escapeHTML(draft.shortDescription) + '</textarea><div class="vapp-count" data-count-for="vapp-profile-short">' + String(draft.shortDescription.length) + ' / 120</div></div>' +
          '<div class="vapp-field"><label for="vapp-profile-about">About the business</label><textarea id="vapp-profile-about" name="about" maxlength="350" rows="6" placeholder="Share the people, process, or purpose behind the products.">' + escapeHTML(draft.about) + '</textarea><div class="vapp-count" data-count-for="vapp-profile-about">' + String(draft.about.length) + ' / 350</div></div>' +
          '<fieldset class="vapp-fieldset"><legend>Product categories</legend><div class="vapp-three-fields">' + [0, 1, 2].map(function (index) { return '<div class="vapp-field"><label for="vapp-category-' + index + '">' + (index === 0 ? 'Primary' : 'Category ' + (index + 1)) + '</label><input id="vapp-category-' + index + '" name="category' + index + '" maxlength="50" value="' + attr(draft.categories[index]) + '" placeholder="' + (index === 0 ? 'Produce, baked goods…' : 'Optional') + '"></div>'; }).join('') + '</div></fieldset>' +
          '<fieldset class="vapp-fieldset"><legend>Website and social</legend><div class="vapp-two-fields">' +
            socialField('website', 'Website', draft.website, 'https://yourbusiness.com') + socialField('instagram', 'Instagram', draft.instagram, 'https://instagram.com/yourbusiness') +
          '</div></fieldset>' +
          '<fieldset class="vapp-fieldset"><legend>Profile photo</legend><div class="vapp-photo-control"><div class="vapp-photo-thumb" data-profile-thumb>' + profilePhoto(draft.photoData, draft.businessName) + '</div><div><label class="vapp-button outline small" for="vapp-profile-photo">Choose raster image</label><input class="vapp-visually-hidden" id="vapp-profile-photo" type="file" accept="image/png,image/jpeg,image/webp"><p>PNG, JPEG, or WebP · 700 KB maximum.</p><button class="vapp-text-button danger" type="button" data-remove-profile-photo' + (draft.photoData ? '' : ' hidden') + '>Remove photo</button></div></div><input type="hidden" name="photoData" value="' + attr(draft.photoData) + '"></fieldset>' +
          '<div class="vapp-form-actions split"><div><button class="vapp-button outline" type="submit" name="intent" value="save">' + (server.published ? 'Save changes' : 'Save draft') + '</button><button class="vapp-button primary" type="submit" name="intent" value="' + (server.published ? 'unpublish' : 'publish') + '">' + (server.published ? 'Unpublish profile' : 'Publish profile') + '</button></div><p>' + (server.published ? 'Visible in this browser’s demo directory.' : 'Currently a draft.') + '</p></div>' +
        '</form>' +
        '<aside class="vapp-profile-preview-wrap"><div class="vapp-section-bar"><div><span class="vapp-kicker">Immediate preview</span><h2>What shoppers read</h2></div><span data-profile-visibility>' + (server.published ? 'PUBLISHED IN PREVIEW' : 'DRAFT') + '</span></div><div data-profile-preview>' + profilePreview(draft, server.published) + '</div><p class="vapp-fine">This preview uses only what you enter here. No information has been imported from the original vendor account.</p></aside>' +
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

  function profilePreview(profile, published) {
    var links = [
      ['Website', profile.website], ['Instagram', profile.instagram]
    ].filter(function (item) { return !!safeWebUrl(item[1]); });
    return '<article class="vapp-directory-card"><div class="vapp-directory-image">' + profilePhoto(profile.photoData, profile.businessName) + '<span>' + (published ? 'PUBLISHED IN PREVIEW DIRECTORY' : 'DRAFT PREVIEW') + '</span></div><div class="vapp-directory-body"><p class="vapp-directory-city">' + escapeHTML(profile.city || 'Your city') + '</p><h3>' + escapeHTML(profile.businessName || 'Your business name') + '</h3><div class="vapp-tag-row">' + profile.categories.filter(Boolean).map(function (category) { return '<span>' + escapeHTML(category) + '</span>'; }).join('') + '</div><p class="vapp-directory-short">' + escapeHTML(profile.shortDescription || 'A direct description will tell shoppers what they will find at your table.') + '</p>' + (profile.about ? '<p>' + escapeHTML(profile.about) + '</p>' : '') + '<div class="vapp-directory-links">' + links.map(function (item) { return '<a href="' + attr(item[1]) + '" target="_blank" rel="noopener">' + escapeHTML(item[0]) + ' ↗</a>'; }).join('') + '</div></div></article>';
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
    function capture() {
      var draft = profileFromForm(form);
      writeDraft('profile', draft);
      var preview = runtime.root.querySelector('[data-profile-preview]');
      if (preview) preview.innerHTML = profilePreview(draft, form.dataset.serverPublished === 'true');
      [['shortDescription', 'vapp-profile-short', 120], ['about', 'vapp-profile-about', 350]].forEach(function (item) {
        var counter = form.querySelector('[data-count-for="' + item[1] + '"]');
        if (counter) counter.textContent = draft[item[0]].length + ' / ' + item[2];
      });
    }
    form.addEventListener('input', function (event) { if (event.target.type !== 'file') capture(); });
    form.addEventListener('change', function (event) { if (event.target.type !== 'file') capture(); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var profile = profileFromForm(form);
      var intent = event.submitter ? event.submitter.value : 'save';
      if (!profile.businessName) {
        announce('Add the business name before saving the profile.', 'error');
        form.elements.businessName.focus();
        return;
      }
      if (intent === 'publish' && (!profile.shortDescription || !profile.categories.filter(Boolean).length)) {
        announce('Publishing needs a short description and at least one product category.', 'error');
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
      profile.published = intent === 'publish' ? true : intent === 'unpublish' ? false : form.dataset.serverPublished === 'true';
      var result = await mutate('profile.save', profile, event.submitter, profile.published ? 'Demo profile saved in this browser’s directory.' : 'Profile draft saved in this browser.');
      if (result) { clearDraft('profile'); renderCurrentSection(); }
    });

    var photoInput = form.querySelector('#vapp-profile-photo');
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file) return;
      if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) === -1) {
        photoInput.value = '';
        announce('Choose a PNG, JPEG, or WebP raster image.', 'error');
        return;
      }
      if (file.size > PHOTO_LIMIT) {
        photoInput.value = '';
        announce('That photo is larger than 700 KB. Choose a smaller raster image.', 'error');
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var value = safePhoto(reader.result);
        if (!value) {
          announce('The selected image could not be read safely.', 'error');
          return;
        }
        form.elements.photoData.value = value;
        var thumb = form.querySelector('[data-profile-thumb]');
        if (thumb) thumb.innerHTML = profilePhoto(value, form.elements.businessName.value);
        var remove = form.querySelector('[data-remove-profile-photo]');
        if (remove) remove.hidden = false;
        capture();
      };
      reader.onerror = function () { announce('The selected image could not be read.', 'error'); };
      reader.readAsDataURL(file);
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
    return pageHeader('04 / Promotions', 'MAKE SOME MARKET NOISE', 'Compose a caption and export a post-ready PNG tied to a saved preview reservation. Saving here does not post to social media.', '') +
      '<div class="vapp-promo-grid">' +
        '<form class="vapp-editor" id="vapp-promotion-form" novalidate><input type="hidden" name="id" value="' + attr(draft.id) + '">' +
          '<div class="vapp-editor-head tomato"><span>PROMOTION COMPOSER</span><strong>One date. One clear reason.</strong></div>' +
          (reservations.length ? '' : '<div class="vapp-inline-warning"><strong>A requested date comes first.</strong><p>Save a preview reservation before building market-specific creative.</p><a href="#workspace/reservations">Request a date →</a></div>') +
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
    function capture() {
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
        announce('Caption copied to the clipboard.', 'success');
      } catch (_error) {
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
        if (!window.confirm('Delete this saved campaign? Any PNG already exported will stay on your device.')) return;
        await mutate('promotion.delete', { id: button.getAttribute('data-delete-promotion') }, button, 'Saved campaign deleted.');
      });
    });
    drawPromotion(promotionFromForm(form));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (runtime.root) drawPromotion(promotionFromForm(form)); });
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

  async function initVendorApp(section) {
    runtime.section = VALID_SECTIONS.indexOf(section) > -1 ? section : 'overview';
    runtime.root = document.querySelector('[data-vendor-app]');
    if (!runtime.root) return;
    if (runtime.snapshot && Date.now() - runtime.loadedAt < 60000) renderCurrentSection();
    else await loadWorkspace(true);
  }

  window.renderVendorApp = renderVendorApp;
  window.initVendorApp = initVendorApp;
})();
