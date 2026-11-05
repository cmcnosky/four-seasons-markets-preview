(function () {
  'use strict';

  var FORMAT = {
    square: { width: 1080, height: 1080, label: 'Square post', detail: '1080 × 1080 PNG' },
    story: { width: 1080, height: 1920, label: 'Story', detail: '1080 × 1920 PNG' },
    poster: { width: 1275, height: 1650, label: 'Print poster', detail: '8.5 × 11 ratio · 150 dpi' }
  };
  var COLORS = {
    green: '#173d2d', ink: '#1e2923', paper: '#fff9ee', tomato: '#c34b2b', mustard: '#e8bd52', sage: '#e8ebdb', white: '#fffdf7'
  };
  var runtime = {
    root: null,
    data: null,
    mode: 'vendor',
    selectionId: '',
    offerId: '',
    format: 'square',
    requestId: 0,
    controller: null,
    loading: false,
    drawId: 0,
    qrPromise: null,
    qrError: '',
    image: null,
    imageSource: '',
    authListenerBound: false,
    authUserKey: ''
  };

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function attr(value) { return escapeHTML(value).replace(/`/g, '&#96;'); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value, max) {
    var result = typeof value === 'string' ? value.trim() : '';
    return max ? result.slice(0, max) : result;
  }

  function safeId(value) {
    var result = text(value, 160);
    return /^[A-Za-z0-9_-]+$/.test(result) ? result : '';
  }

  function safePhoto(value) {
    value = text(value, 960000);
    return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  }

  function apiOrigin() {
    return window.FSMAuth && typeof window.FSMAuth.apiOrigin === 'function'
      ? window.FSMAuth.apiOrigin()
      : window.location.origin;
  }

  function apiUrl(path) { return new URL(path, apiOrigin()).href; }

  function canonicalHashUrl(hash) {
    var source = typeof window.FSM_CANONICAL_URL === 'string' && window.FSM_CANONICAL_URL.trim()
      ? window.FSM_CANONICAL_URL.trim()
      : window.location.href;
    try {
      var url = new URL(source, window.location.href);
      url.search = '';
      url.hash = String(hash || '').replace(/^#/, '');
      return url.href;
    } catch (_error) {
      return String(hash || '#');
    }
  }

  function vendorShareUrl(publicId) {
    return safeId(publicId)
      ? new URL('/share/vendor/' + encodeURIComponent(publicId), apiOrigin()).href
      : '';
  }

  function marketDate(value, includeYear) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 'Date not set';
    var parsed = new Date(value + 'T12:00:00Z');
    if (isNaN(parsed.getTime())) return 'Date not set';
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: includeYear === false ? undefined : 'numeric', timeZone: 'UTC'
    }).format(parsed);
  }

  function marketHours(item) {
    if (!item || !item.startsAt || !item.endsAt) return '';
    var start = new Date(item.startsAt);
    var end = new Date(item.endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
    var format = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: item.timeZone || 'America/Chicago' });
    return format.format(start) + '–' + format.format(end) + ' CT';
  }

  function marketToday() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      var values = {};
      parts.forEach(function (part) { values[part.type] = part.value; });
      return values.year + '-' + values.month + '-' + values.day;
    } catch (_error) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function statusLabel(value) {
    var labels = {
      approved: 'Approved · final confirmation pending',
      confirmed: 'Confirmed appearance',
      attended: 'Recorded attended',
      scheduled: 'Scheduled', delayed: 'Delayed', cancelled: 'Cancelled',
      requested: 'Requested', waitlisted: 'Waitlisted'
    };
    return labels[value] || String(value || 'Unknown').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function normaliseProfile(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      businessName: text(raw.businessName || raw.name, 80),
      city: text(raw.city, 80),
      shortDescription: text(raw.shortDescription || raw.description, 120),
      categories: list(raw.categories).map(function (item) { return text(item, 50); }).filter(Boolean).slice(0, 3),
      photoData: safePhoto(raw.photoData || raw.photoDataUrl || raw.photo),
      published: raw.published === true
    };
  }

  function normaliseOffer(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      id: safeId(raw.id), title: text(raw.title, 80), description: text(raw.description, 150), value: text(raw.value, 60),
      marketIds: list(raw.marketIds).map(safeId).filter(Boolean), startDate: text(raw.startDate, 10), endDate: text(raw.endDate, 10),
      status: text(raw.status, 20)
    };
  }

  function isPublicOffer(offer, profile) {
    var today = marketToday();
    return profile.published && offer.status === 'published' && /^\d{4}-\d{2}-\d{2}$/.test(offer.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(offer.endDate) && offer.startDate <= today && offer.endDate >= today;
  }

  function normaliseData(vendorPayload, workspacePayload, managerPayload, schedulePayload) {
    vendorPayload = vendorPayload && typeof vendorPayload === 'object' ? vendorPayload : {};
    workspacePayload = workspacePayload && typeof workspacePayload === 'object' ? workspacePayload : {};
    managerPayload = managerPayload && typeof managerPayload === 'object' ? managerPayload : {};
    schedulePayload = schedulePayload && typeof schedulePayload === 'object' ? schedulePayload : {};
    var state = workspacePayload.state && typeof workspacePayload.state === 'object' ? workspacePayload.state : {};
    var profile = normaliseProfile(state.profile);
    var occurrences = list(vendorPayload.occurrences);
    var occurrenceById = new Map(occurrences.map(function (item) { return [String(item.id || ''), item]; }));
    var bookings = list(vendorPayload.bookings).filter(function (item) {
      var occurrence = occurrenceById.get(String(item.occurrenceId || ''));
      return (item.status === 'approved' || item.status === 'confirmed') && occurrence && occurrence.status !== 'cancelled';
    }).map(function (item) {
      return { booking: item, occurrence: occurrenceById.get(String(item.occurrenceId || '')) };
    });
    var excludedBookingCounts = list(vendorPayload.bookings).reduce(function (counts, item) {
      var key = text(item.status, 30) || 'other';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    var schedule = list(schedulePayload.occurrences);
    var scheduleById = new Map(schedule.map(function (item) { return [String(item.id || ''), item]; }));
    var staffViewer = managerPayload.viewer && managerPayload.viewer.mode === 'staff' ? managerPayload.viewer : null;
    var managerSelections = staffViewer ? list(managerPayload.occurrences).filter(function (item) {
      var publicItem = scheduleById.get(String(item.id || ''));
      return (item.status === 'scheduled' || item.status === 'delayed') && publicItem && list(publicItem.lineup).length > 0;
    }).map(function (item) {
      return { occurrence: item, publicOccurrence: scheduleById.get(String(item.id || '')) };
    }) : [];
    var publicId = safeId((workspacePayload.account && workspacePayload.account.publicId) ||
      (vendorPayload.viewer && vendorPayload.viewer.account && vendorPayload.viewer.account.publicId));
    var profilePublished = Boolean(
      profile.published && workspacePayload.account && workspacePayload.account.profilePublished === true,
    );
    var marketNames = {};
    occurrences.forEach(function (item) {
      var marketId = safeId(item && item.marketId);
      if (marketId && !marketNames[marketId]) marketNames[marketId] = text(item.name, 120) || marketId;
    });
    return {
      profile: profile,
      offers: list(state.offers).map(normaliseOffer).filter(function (offer) { return isPublicOffer(offer, profile); }),
      publicId: publicId,
      profilePublished: profilePublished,
      vendorName: text(workspacePayload.user && workspacePayload.user.displayName, 120) || text(vendorPayload.viewer && vendorPayload.viewer.displayName, 120) || 'Vendor',
      bookings: bookings,
      marketNames: marketNames,
      excludedBookingCounts: excludedBookingCounts,
      staffViewer: staffViewer,
      managerSelections: managerSelections,
      scheduleUpdatedAt: Number(schedulePayload.updatedAt) || 0
    };
  }

  function loadingMarkup() {
    return '<div class="promo-loading" aria-label="Opening promotion kit"><span>PRESS CHECK</span><h1>BUILDING YOUR MARKET-DAY KIT.</h1><div class="promo-loading-rule"></div><p>Checking the saved profile, public offers, and real booking status…</p></div>';
  }

  function renderPromotionKit() {
    return '<section class="promo-kit" data-promotion-kit>' + loadingMarkup() + '</section>';
  }

  function authMarkup() {
    return '<div class="promo-state"><span class="promo-state-number">ACCOUNT</span><div><span class="promo-kicker">Promotion kit</span><h1>YOUR SAVED RECORDS STAY PRIVATE.</h1><p>Sign in with email/password or Google to build artwork from your published profile and actual market decisions.</p><a class="promo-button primary" href="#workspace">Open vendor sign-in →</a></div></div>';
  }

  function errorMarkup(message) {
    return '<div class="promo-state" role="alert"><span class="promo-state-number">PAUSE</span><div><span class="promo-kicker">Promotion kit</span><h1>THE SOURCE CHECK DID NOT FINISH.</h1><p>' + escapeHTML(message || 'The current records could not be loaded.') + '</p><button class="promo-button primary" type="button" data-promo-retry>Try again</button></div></div>';
  }

  function selections() {
    if (runtime.mode === 'staff') return runtime.data.managerSelections;
    var items = runtime.data.bookings.slice();
    if (runtime.data.profilePublished && runtime.data.publicId) {
      items.push({
        profileOnly: true,
        booking: { id: 'profile-only', status: 'profile' },
        occurrence: {
          id: 'profile-only', marketId: '', name: 'My published business profile',
          venue: runtime.data.profile.city, address: '', date: '', status: 'profile'
        }
      });
    }
    return items;
  }

  function currentSelection() {
    return selections().find(function (item) {
      var occurrence = item.occurrence;
      return String(occurrence && occurrence.id || '') === String(runtime.selectionId || '');
    }) || null;
  }

  function selectionStatus(selection) {
    return runtime.mode === 'staff' ? 'confirmed_lineup' : text(selection && selection.booking && selection.booking.status, 30);
  }

  function offersFor(selection) {
    if (selection && selection.profileOnly) return runtime.mode === 'vendor' ? runtime.data.offers : [];
    var marketId = text(selection && selection.occurrence && selection.occurrence.marketId, 80);
    return runtime.mode === 'vendor'
      ? runtime.data.offers.filter(function (offer) { return offer.marketIds.indexOf(marketId) >= 0; })
      : [];
  }

  function currentOffer(selection) {
    return offersFor(selection).find(function (offer) { return offer.id === runtime.offerId; }) || null;
  }

  function selectionLink(selection) {
    if (!selection) return '';
    return runtime.mode === 'vendor'
      ? vendorShareUrl(runtime.data.publicId)
      : canonicalHashUrl('#market/' + safeId(selection.occurrence.marketId));
  }

  function defaultHeadline(selection) {
    if (!selection) return 'MARKET-DAY READY';
    if (runtime.mode === 'staff') return 'MEET THIS MARKET\'S MAKERS';
    if (selection.profileOnly) return 'SHOP SMALL. MEET THE MAKER.';
    return selection.booking.status === 'confirmed' ? 'FIND US AT THE MARKET' : 'MARKET DATE UPDATE';
  }

  function offerMarketNames(offer) {
    return list(offer && offer.marketIds).map(function (marketId) {
      return runtime.data.marketNames[marketId] || String(marketId).replace(/-/g, ' ');
    }).filter(Boolean);
  }

  function conciseLineup(lineup) {
    var names = list(lineup).map(function (item) { return text(item.name, 80); }).filter(Boolean);
    if (names.length <= 5) return names.join(', ');
    return names.slice(0, 5).join(', ') + ', and ' + (names.length - 5) + ' more';
  }

  function defaultCaption(selection, offer) {
    if (!selection) return '';
    var occurrence = selection.occurrence;
    var when = marketDate(occurrence.date, true) + (marketHours(occurrence) ? ' · ' + marketHours(occurrence) : '');
    var place = [text(occurrence.venue, 120), text(occurrence.address, 180)].filter(Boolean).join(' · ');
    var link = selectionLink(selection);
    if (selection.profileOnly) {
      var profileBusiness = runtime.data.profile.businessName || runtime.data.vendorName || 'This business';
      var profileLines = [
        profileBusiness + (runtime.data.profile.shortDescription ? ' — ' + runtime.data.profile.shortDescription : '.'),
      ];
      if (offer) {
        var applicableMarkets = offerMarketNames(offer);
        profileLines.push(
          offer.title + (offer.value ? ' · ' + offer.value : '') + ': ' + offer.description +
          (applicableMarkets.length ? ' Available for ' + applicableMarkets.join(', ') + ' during the published offer dates.' : ''),
        );
      }
      profileLines.push('Explore the current public profile and offers: ' + link);
      profileLines.push('This post does not claim a specific market appearance.');
      return profileLines.filter(Boolean).join('\n\n').slice(0, 1200);
    }
    if (runtime.mode === 'staff') {
      var publicOccurrence = selection.publicOccurrence || {};
      var lineup = conciseLineup(publicOccurrence.lineup);
      var lines = [occurrence.name + ' · ' + when + '.', place + '.'];
      if (lineup) lines.push('Confirmed lineup currently includes ' + lineup + '.');
      if (occurrence.status === 'delayed') lines.push('The market is currently marked delayed. Check the live market page before traveling.');
      lines.push('See the current market details and lineup: ' + link);
      return lines.filter(Boolean).join('\n\n').slice(0, 1200);
    }
    var business = runtime.data.profile.businessName || runtime.data.vendorName || 'Our business';
    if (selection.booking.status === 'approved') {
      return [
        business + ' has an approved booking for ' + occurrence.name + ' on ' + when + '.',
        'Final attendance confirmation is still pending. Please check our public profile before planning a trip.',
        offer ? offer.title + (offer.value ? ' · ' + offer.value : '') + ': ' + offer.description : '',
        link
      ].filter(Boolean).join('\n\n').slice(0, 1200);
    }
    return [
      'Come find ' + business + ' at ' + occurrence.name + ' on ' + when + '.',
      place ? place + '.' : '',
      offer ? offer.title + (offer.value ? ' · ' + offer.value : '') + ': ' + offer.description : '',
      'See our current profile and offer details: ' + link
    ].filter(Boolean).join('\n\n').slice(0, 1200);
  }

  function formatOptions() {
    return Object.keys(FORMAT).map(function (key) {
      var item = FORMAT[key];
      return '<label class="promo-format"><input type="radio" name="promoFormat" value="' + key + '"' + (runtime.format === key ? ' checked' : '') + '><span><b>' + escapeHTML(item.label) + '</b><small>' + escapeHTML(item.detail) + '</small></span></label>';
    }).join('');
  }

  function selectionOptions() {
    return selections().map(function (item) {
      var occurrence = item.occurrence;
      if (item.profileOnly) {
        return '<option value="' + attr(occurrence.id) + '"' + (occurrence.id === runtime.selectionId ? ' selected' : '') +
          '>My business / no market date — no attendance claim</option>';
      }
      var note = runtime.mode === 'staff'
        ? list(item.publicOccurrence && item.publicOccurrence.lineup).length + ' confirmed vendors'
        : item.profileOnly ? 'No market attendance claim' : statusLabel(item.booking.status);
      return '<option value="' + attr(occurrence.id) + '"' + (occurrence.id === runtime.selectionId ? ' selected' : '') + '>' +
        escapeHTML(occurrence.name + ' — ' + marketDate(occurrence.date, false) + ' · ' + note) + '</option>';
    }).join('');
  }

  function offerOptions(selection) {
    return '<option value="">No featured offer</option>' + offersFor(selection).map(function (offer) {
      return '<option value="' + attr(offer.id) + '"' + (offer.id === runtime.offerId ? ' selected' : '') + '>' + escapeHTML(offer.title + (offer.value ? ' · ' + offer.value : '')) + '</option>';
    }).join('');
  }

  function sourceReceipt(selection) {
    if (!selection) return '';
    var occurrence = selection.occurrence;
    if (runtime.mode === 'staff') {
      var count = list(selection.publicOccurrence && selection.publicOccurrence.lineup).length;
      return '<div><dt>Public lineup</dt><dd>' + count + ' confirmed / attended published profiles</dd></div>' +
        '<div><dt>Occurrence</dt><dd>' + escapeHTML(statusLabel(occurrence.status)) + ' · version ' + escapeHTML(occurrence.version == null ? '—' : occurrence.version) + '</dd></div>' +
        '<div><dt>Scope</dt><dd>Names come only from the public schedule response.</dd></div>';
    }
    if (selection.profileOnly) {
      return '<div><dt>Source</dt><dd>Current published business profile</dd></div>' +
        '<div><dt>Attendance</dt><dd>No specific market appearance claimed</dd></div>' +
        '<div><dt>Offers</dt><dd>Only active published offers are selectable.</dd></div>';
    }
    return '<div><dt>Booking decision</dt><dd>' + escapeHTML(statusLabel(selection.booking.status)) + '</dd></div>' +
      '<div><dt>Booking record</dt><dd>' + escapeHTML(selection.booking.id || '—') + ' · version ' + escapeHTML(selection.booking.version == null ? '—' : selection.booking.version) + '</dd></div>' +
      '<div><dt>Public profile</dt><dd>' + (runtime.data.profilePublished ? 'Published' : 'Not published') + '</dd></div>';
  }

  function isExportAllowed(selection) {
    if (!selection) return false;
    if (runtime.mode === 'staff') return list(selection.publicOccurrence && selection.publicOccurrence.lineup).length > 0;
    if (selection.profileOnly) return runtime.data.profilePublished && !!runtime.data.publicId;
    return runtime.data.profilePublished && !!runtime.data.publicId &&
      (selection.booking.status === 'approved' || selection.booking.status === 'confirmed');
  }

  function truthBanner(selection) {
    if (runtime.mode === 'staff') {
      return '<strong>MARKET-WIDE MODE</strong><span>Only confirmed or attended vendors from the public schedule can appear in this artwork.</span>';
    }
    if (!runtime.data.profilePublished) {
      return '<strong>PRIVATE PREVIEW ONLY</strong><span>Publish the business profile before exporting customer-facing artwork or a public link.</span>';
    }
    if (selection && selection.profileOnly) {
      return '<strong>PUBLISHED PROFILE · NO MARKET CLAIM</strong><span>Use this general business kit without naming a market date or implying attendance.</span>';
    }
    if (selection && selection.booking.status === 'approved') {
      return '<strong>APPROVED · NOT FINAL</strong><span>The kit labels final attendance as pending. It does not turn an approval into a confirmed appearance.</span>';
    }
    return '<strong>CONFIRMED SOURCE</strong><span>Customer-facing attendance wording is available only for the selected confirmed booking.</span>';
  }

  function emptyMessage() {
    if (runtime.mode === 'staff') {
      return '<div class="promo-empty"><span>00</span><h2>NO CONFIRMED PUBLIC LINEUP YET.</h2><p>A market-wide kit becomes available only after a scheduled or delayed occurrence has at least one confirmed vendor with a published profile in the public schedule.</p><a href="#operations/bookings">Review booking decisions →</a></div>';
    }
    var requested = runtime.data.excludedBookingCounts.requested || 0;
    var waitlisted = runtime.data.excludedBookingCounts.waitlisted || 0;
    return '<div class="promo-empty"><span>00</span><h2>PUBLISH THE BUSINESS FIRST.</h2><p>A published profile unlocks a general business kit with no attendance claim. Market-specific kits remain limited to approved or confirmed bookings. ' +
      (requested || waitlisted ? 'Your other records include ' + requested + ' requested and ' + waitlisted + ' waitlisted; neither is presented as attendance.' : 'Request a date, then wait for a recorded decision.') +
      '</p><a href="#workspace/profile">Open business profile →</a></div>';
  }

  function renderLoaded() {
    if (!runtime.root || !runtime.data) return;
    var available = selections();
    if (!available.some(function (item) { return item.occurrence.id === runtime.selectionId; })) {
      runtime.selectionId = available[0] ? available[0].occurrence.id : '';
      runtime.offerId = '';
    }
    var selection = currentSelection();
    var offer = currentOffer(selection);
    var headline = defaultHeadline(selection);
    var caption = defaultCaption(selection, offer);
    var link = selectionLink(selection);
    var allowed = isExportAllowed(selection);
    var staffToggle = runtime.data.staffViewer ? '<div class="promo-mode" role="group" aria-label="Promotion kit mode">' +
      '<button type="button" data-promo-mode="vendor" aria-pressed="' + (runtime.mode === 'vendor') + '">MY BUSINESS</button>' +
      '<button type="button" data-promo-mode="staff" aria-pressed="' + (runtime.mode === 'staff') + '">MARKET-WIDE</button></div>' : '';
    runtime.root.innerHTML =
      '<header class="promo-hero"><div><span class="promo-kicker">MARKET PRESS · ACCOUNT EDITION</span><h1>MAKE THE MARKET<br><em>WORTH THE TRIP.</em></h1><p>Turn verified booking decisions, published offers, and confirmed public lineups into useful artwork—without overstating who will be there.</p></div><div class="promo-hero-stamp"><span>3</span><b>READY-TO-SHARE<br>FORMATS</b></div></header>' +
      '<div class="promo-truth" role="status">' + truthBanner(selection) + '</div>' +
      staffToggle +
      (available.length ?
        '<div class="promo-workbench">' +
          '<form class="promo-controls" data-promo-form>' +
            '<div class="promo-section-head"><span>01</span><div><b>THE SOURCE</b><small>Choose a real decision, never a wish.</small></div></div>' +
            '<label class="promo-field"><span>Market date</span><select data-promo-selection>' + selectionOptions() + '</select></label>' +
            (runtime.mode === 'vendor' ? '<label class="promo-field"><span>Published offer <small>Optional · public now</small></span><select data-promo-offer>' + offerOptions(selection) + '</select></label>' : '') +
            '<div class="promo-section-head"><span>02</span><div><b>THE FORMAT</b><small>Export stays on this device until you share it.</small></div></div>' +
            '<fieldset class="promo-format-grid"><legend class="visually-hidden">Artwork format</legend>' + formatOptions() + '</fieldset>' +
            '<div class="promo-section-head"><span>03</span><div><b>THE MESSAGE</b><small>Useful details first. Hype second.</small></div></div>' +
            '<label class="promo-field"><span>Graphic headline</span><input data-promo-headline maxlength="80" value="' + attr(headline) + '"></label>' +
            '<label class="promo-field"><span>Caption</span><textarea data-promo-caption maxlength="1200" rows="10">' + escapeHTML(caption) + '</textarea><small class="promo-count" data-promo-count>' + caption.length + ' / 1200</small></label>' +
            '<label class="promo-field"><span>Public link</span><div class="promo-link-field"><input data-promo-link readonly value="' + attr(link) + '"><button type="button" data-copy-link>Copy</button></div></label>' +
            '<div class="promo-actions" data-promo-actions>' +
              '<button class="promo-button primary" type="button" data-download-image' + (allowed ? '' : ' disabled') + '>Download PNG ↓</button>' +
              '<button class="promo-button light" type="button" data-share-kit' + (allowed ? '' : ' disabled') + '>Share kit ↗</button>' +
              '<button class="promo-button outline" type="button" data-copy-caption>Copy caption</button>' +
              '<button class="promo-button outline" type="button" data-download-copy' + (allowed ? '' : ' disabled') + '>Download copy .txt</button>' +
              '<button class="promo-button outline" type="button" data-print-poster' + (allowed ? '' : ' disabled') + '>Print QR poster</button>' +
            '</div>' +
            '<p class="promo-action-note">No post, email, text, payment, or booking action is sent from this kit. Share and print happen only after you press a button.</p>' +
          '</form>' +
          '<aside class="promo-preview-column"><div class="promo-preview-head"><div><span class="promo-kicker">LIVE ARTWORK</span><h2 data-promo-format-label>' + escapeHTML(FORMAT[runtime.format].label) + '</h2></div><button type="button" data-promo-refresh>Refresh records ↻</button></div>' +
            '<div class="promo-canvas-frame"><canvas width="' + FORMAT[runtime.format].width + '" height="' + FORMAT[runtime.format].height + '" data-promo-canvas role="img" aria-label="Promotion artwork preview"></canvas><span class="promo-rendering" data-promo-rendering>Drawing verified details…</span></div>' +
            '<p class="promo-canvas-note">The QR code uses a first-party public profile or market link. The artwork contains no tracking pixel and is rendered in this browser.</p>' +
            '<section class="promo-receipt"><span class="promo-kicker">SOURCE RECEIPT</span><dl data-promo-receipt>' + sourceReceipt(selection) + '</dl></section>' +
          '</aside>' +
        '</div>' : emptyMessage()) +
      '<footer class="promo-kit-footer"><b>FOUR SEASONS MARKETS</b><span>LOCAL FOOD · LOCAL GOODS · PEOPLE YOU CAN MEET</span><small>Independent redesign preview · operating adoption and live service connections require organizer approval.</small></footer>' +
      '<div class="promo-live" role="status" aria-live="polite" aria-atomic="true" data-promo-live></div>';
    bindLoaded();
    if (selection) drawCurrent();
  }

  function announce(message, tone) {
    var live = runtime.root && runtime.root.querySelector('[data-promo-live]');
    if (!live) return;
    live.textContent = message;
    live.dataset.tone = tone || 'info';
    live.classList.add('is-visible');
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(function () { if (live) live.classList.remove('is-visible'); }, 4500);
  }

  function refreshOfferControl(selection) {
    var control = runtime.root && runtime.root.querySelector('[data-promo-offer]');
    if (!control) return;
    var offers = offersFor(selection);
    if (!offers.some(function (offer) { return offer.id === runtime.offerId; })) runtime.offerId = '';
    control.innerHTML = offerOptions(selection);
    control.value = runtime.offerId;
  }

  function refreshGeneratedCopy() {
    var selection = currentSelection();
    refreshOfferControl(selection);
    var offer = currentOffer(selection);
    var headline = runtime.root.querySelector('[data-promo-headline]');
    var caption = runtime.root.querySelector('[data-promo-caption]');
    var link = runtime.root.querySelector('[data-promo-link]');
    if (headline) headline.value = defaultHeadline(selection);
    if (caption) caption.value = defaultCaption(selection, offer);
    if (link) link.value = selectionLink(selection);
    updateCount();
    var receipt = runtime.root.querySelector('[data-promo-receipt]');
    if (receipt) receipt.innerHTML = sourceReceipt(selection);
    drawCurrent();
  }

  function updateCount() {
    var caption = runtime.root && runtime.root.querySelector('[data-promo-caption]');
    var count = runtime.root && runtime.root.querySelector('[data-promo-count]');
    if (caption && count) count.textContent = caption.value.length + ' / 1200';
  }

  function bindLoaded() {
    if (!runtime.root) return;
    runtime.root.querySelectorAll('[data-promo-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        var mode = button.getAttribute('data-promo-mode');
        if (mode === runtime.mode || (mode === 'staff' && !runtime.data.staffViewer)) return;
        runtime.mode = mode;
        runtime.selectionId = '';
        runtime.offerId = '';
        renderLoaded();
      });
    });
    var selection = runtime.root.querySelector('[data-promo-selection]');
    if (selection) selection.addEventListener('change', function () {
      runtime.selectionId = selection.value;
      runtime.offerId = '';
      refreshGeneratedCopy();
    });
    var offer = runtime.root.querySelector('[data-promo-offer]');
    if (offer) offer.addEventListener('change', function () {
      runtime.offerId = offer.value;
      refreshGeneratedCopy();
    });
    runtime.root.querySelectorAll('input[name="promoFormat"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.checked || !FORMAT[input.value]) return;
        runtime.format = input.value;
        var label = runtime.root.querySelector('[data-promo-format-label]');
        if (label) label.textContent = FORMAT[runtime.format].label;
        drawCurrent();
      });
    });
    var headline = runtime.root.querySelector('[data-promo-headline]');
    if (headline) headline.addEventListener('input', scheduleDraw);
    var caption = runtime.root.querySelector('[data-promo-caption]');
    if (caption) caption.addEventListener('input', function () { updateCount(); scheduleDraw(); });
    bindButton('[data-copy-link]', function () {
      var control = runtime.root.querySelector('[data-promo-link]');
      return copyText(control ? control.value : '').then(function (copied) { announce(copied ? 'Public link copied.' : 'The link is selected for manual copying.', copied ? 'success' : 'error'); });
    });
    bindButton('[data-copy-caption]', function () {
      var control = runtime.root.querySelector('[data-promo-caption]');
      return copyText(control ? control.value : '', control).then(function (copied) { announce(copied ? 'Caption copied.' : 'The caption is selected for manual copying.', copied ? 'success' : 'error'); });
    });
    bindButton('[data-download-image]', downloadImage);
    bindButton('[data-download-copy]', downloadCopy);
    bindButton('[data-share-kit]', shareKit);
    bindButton('[data-print-poster]', printPoster);
    bindButton('[data-promo-refresh]', function () { return load(true); });
  }

  function bindButton(selector, handler) {
    var button = runtime.root && runtime.root.querySelector(selector);
    if (!button) return;
    button.addEventListener('click', function () {
      if (button.disabled) return;
      Promise.resolve(handler(button)).catch(function (error) {
        announce(error && error.message ? error.message : 'That action did not finish.', 'error');
      });
    });
  }

  function scheduleDraw() {
    window.clearTimeout(scheduleDraw.timer);
    scheduleDraw.timer = window.setTimeout(drawCurrent, 90);
  }

  function currentComposition() {
    var selection = currentSelection();
    var headline = runtime.root && runtime.root.querySelector('[data-promo-headline]');
    var caption = runtime.root && runtime.root.querySelector('[data-promo-caption]');
    return {
      selection: selection,
      offer: currentOffer(selection),
      headline: text(headline && headline.value, 80) || defaultHeadline(selection),
      caption: text(caption && caption.value, 1200) || defaultCaption(selection, currentOffer(selection)),
      link: selectionLink(selection),
      format: runtime.format
    };
  }

  function setRendering(active) {
    var indicator = runtime.root && runtime.root.querySelector('[data-promo-rendering]');
    if (indicator) indicator.hidden = !active;
  }

  function loadQRCode() {
    if (window.QRCode && typeof window.QRCode.toCanvas === 'function') return Promise.resolve(window.QRCode);
    if (runtime.qrPromise) return runtime.qrPromise;
    runtime.qrPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-fsm-qrcode]');
      var script = existing || document.createElement('script');
      function ready() {
        if (window.QRCode && typeof window.QRCode.toCanvas === 'function') resolve(window.QRCode);
        else reject(new Error('The local QR renderer did not load.'));
      }
      script.addEventListener('load', ready, { once: true });
      script.addEventListener('error', function () { reject(new Error('The local QR renderer could not be loaded.')); }, { once: true });
      if (!existing) {
        script.src = new URL('vendor/qrcode.min.js', document.baseURI).href;
        script.async = true;
        script.dataset.fsmQrcode = 'true';
        document.head.appendChild(script);
      }
    }).catch(function (error) {
      runtime.qrError = error.message;
      runtime.qrPromise = null;
      throw error;
    });
    return runtime.qrPromise;
  }

  function loadProfileImage(source) {
    if (!source) return Promise.resolve(null);
    if (runtime.image && runtime.imageSource === source && runtime.image.complete) return Promise.resolve(runtime.image);
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () { runtime.image = image; runtime.imageSource = source; resolve(image); };
      image.onerror = function () { resolve(null); };
      image.src = source;
    });
  }

  async function drawCurrent() {
    if (!runtime.root || !runtime.data) return;
    var canvas = runtime.root.querySelector('[data-promo-canvas]');
    var composition = currentComposition();
    if (!canvas || !composition.selection) return;
    var drawId = ++runtime.drawId;
    setRendering(true);
    var spec = FORMAT[composition.format] || FORMAT.square;
    if (canvas.width !== spec.width || canvas.height !== spec.height) {
      canvas.width = spec.width;
      canvas.height = spec.height;
    }
    try {
      var results = await Promise.all([
        loadQRCode(),
        loadProfileImage(runtime.mode === 'vendor' ? runtime.data.profile.photoData : ''),
        document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
      ]);
      if (drawId !== runtime.drawId || !canvas.isConnected) return;
      var qrCanvas = document.createElement('canvas');
      await results[0].toCanvas(qrCanvas, composition.link, {
        errorCorrectionLevel: 'M', margin: 1, width: composition.format === 'square' ? 185 : 235,
        color: { dark: COLORS.green, light: COLORS.paper }
      });
      if (drawId !== runtime.drawId || !canvas.isConnected) return;
      paintKit(canvas, composition, results[1], qrCanvas);
      runtime.qrError = '';
      setRendering(false);
    } catch (error) {
      if (drawId !== runtime.drawId) return;
      setRendering(false);
      paintKit(canvas, composition, null, null);
      announce(error.message + ' PNG export remains paused until it is available.', 'error');
      runtime.root.querySelectorAll('[data-download-image],[data-share-kit],[data-print-poster]').forEach(function (button) { button.disabled = true; });
    }
  }

  function artworkGeometry(format, width, height) {
    var safeFormat = FORMAT[format] ? format : 'square';
    var isSquare = safeFormat === 'square';
    var isStory = safeFormat === 'story';
    var scale = width / 1080;
    var pad = Math.round(62 * scale);
    var headerH = isSquare ? 170 * scale : 220 * scale;
    var featureY = isSquare ? 520 * scale : isStory ? 760 * scale : 640 * scale;
    var featureH = isSquare ? 300 * scale : isStory ? 600 * scale : 410 * scale;
    var footerY = featureY + featureH + (isSquare ? 22 : 34) * scale;
    var qrSize = (isSquare ? 126 : isStory ? 225 : 170) * scale;
    var qrQuiet = 10 * scale;
    var qrLabelFont = (isSquare ? 15 : 19) * scale;
    var qrLabelGap = 6 * scale;
    var qrLabelBottomGap = (isSquare ? 12 : 18) * scale;
    var bottomBandH = (isSquare ? 28 : 40) * scale;
    var bottomBandBottom = (isSquare ? 20 : 28) * scale;
    var bottomBandY = height - bottomBandBottom - bottomBandH;
    var qrLabelBaseline = bottomBandY - qrLabelBottomGap;
    var qrLabelTop = qrLabelBaseline - qrLabelFont;
    var qrY = qrLabelTop - qrLabelGap - qrQuiet - qrSize;
    var qrX = width - pad - qrSize;
    var qrQuietX = qrX - qrQuiet;
    var qrQuietY = qrY - qrQuiet;
    var qrQuietSize = qrSize + qrQuiet * 2;
    var badgeY = footerY + (isSquare ? 22 : 35) * scale;
    var badgeH = (isSquare ? 44 : 54) * scale;
    var badgeRight = qrQuietX - 18 * scale;
    var calloutY = footerY + (isSquare ? 112 : 145) * scale;
    var copyY = footerY + (isSquare ? 148 : 187) * scale;
    var copyLineHeight = (isSquare ? 23 : 35) * scale;
    var copyMaxLines = isStory ? 5 : 2;
    var copyFontSize = (isSquare ? 18 : 23) * scale;
    return {
      scale: scale,
      pad: pad,
      headerH: headerH,
      featureY: featureY,
      featureH: featureH,
      footerY: footerY,
      qrX: qrX,
      qrY: qrY,
      qrSize: qrSize,
      qrQuiet: qrQuiet,
      qrQuietX: qrQuietX,
      qrQuietY: qrQuietY,
      qrQuietSize: qrQuietSize,
      qrLabelTop: qrLabelTop,
      qrLabelBaseline: qrLabelBaseline,
      qrLabelFont: qrLabelFont,
      badgeX: pad,
      badgeY: badgeY,
      badgeW: Math.max(0, badgeRight - pad),
      badgeH: badgeH,
      badgeBaseline: badgeY + (isSquare ? 29 : 35) * scale,
      calloutY: calloutY,
      copyY: copyY,
      copyLineHeight: copyLineHeight,
      copyMaxLines: copyMaxLines,
      copyFontSize: copyFontSize,
      footerTextW: Math.max(0, badgeRight - pad),
      bottomBandX: 28 * scale,
      bottomBandY: bottomBandY,
      bottomBandW: width - 56 * scale,
      bottomBandH: bottomBandH,
      bottomTextY: bottomBandY + bottomBandH * .67
    };
  }

  function paintKit(canvas, composition, photo, qrCanvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    var isSquare = composition.format === 'square';
    var isStory = composition.format === 'story';
    var geometry = artworkGeometry(composition.format, w, h);
    var scale = geometry.scale;
    var pad = geometry.pad;
    var headerH = geometry.headerH;
    var selection = composition.selection;
    var occurrence = selection.occurrence;
    var isProfileOnly = runtime.mode === 'vendor' && selection.profileOnly === true;
    var isApproved = runtime.mode === 'vendor' && selection.booking.status === 'approved';
    var business = runtime.mode === 'vendor' ? (runtime.data.profile.businessName || runtime.data.vendorName) : 'FOUR SEASONS MARKETS';
    var badge = runtime.mode === 'staff'
      ? 'CONFIRMED PUBLIC LINEUP'
      : isProfileOnly
        ? 'PUBLISHED BUSINESS PROFILE · NO ATTENDANCE CLAIM'
        : isApproved
          ? 'APPROVED · FINAL CONFIRMATION PENDING'
          : 'CONFIRMED MARKET APPEARANCE';
    var featureY = geometry.featureY;
    var featureH = geometry.featureH;
    var footerY = geometry.footerY;
    var qrSize = geometry.qrSize;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(0, 0, w, headerH);
    ctx.fillStyle = COLORS.mustard;
    ctx.fillRect(0, headerH, w, 18 * scale);
    ctx.fillStyle = COLORS.tomato;
    ctx.fillRect(w - 175 * scale, 0, 175 * scale, headerH);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 12 * scale;
    ctx.strokeRect(18 * scale, 18 * scale, w - 36 * scale, h - 36 * scale);

    ctx.fillStyle = COLORS.paper;
    ctx.font = '800 ' + Math.round(37 * scale) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    fitText(ctx, business.toUpperCase(), pad, 70 * scale, w - pad * 2 - 170 * scale, 37 * scale, 22 * scale);
    ctx.font = '600 ' + Math.round(23 * scale) + 'px "DM Sans", Arial, sans-serif';
    ctx.fillText('FOUR SEASONS · MARKET PRESS KIT', pad, 122 * scale);
    ctx.textAlign = 'center';
    ctx.font = '800 ' + Math.round(24 * scale) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    ['SHOP', 'MEET', 'REPEAT'].forEach(function (word, index) {
      ctx.fillText(word, w - 87 * scale, 63 * scale + index * 31 * scale);
    });
    ctx.textAlign = 'left';

    ctx.fillStyle = COLORS.ink;
    var headlineFont = (isSquare ? 100 : isStory ? 132 : 122) * scale;
    ctx.font = '800 ' + Math.round(headlineFont) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    var headlineY = headerH + (isSquare ? 110 : 125) * scale;
    drawWrapped(ctx, composition.headline.toUpperCase(), pad, headlineY, w - pad * 2, headlineFont * .87, isSquare ? 2 : 3, true);

    if (photo) {
      drawCover(ctx, photo, pad, featureY, w - pad * 2, featureH);
      ctx.fillStyle = 'rgba(23,61,45,.78)';
      ctx.fillRect(pad, featureY, w - pad * 2, featureH);
    } else {
      ctx.fillStyle = COLORS.mustard;
      ctx.fillRect(pad, featureY, w - pad * 2, featureH);
      ctx.save();
      ctx.globalAlpha = .07;
      ctx.fillStyle = COLORS.green;
      for (var stripe = -h; stripe < w * 2; stripe += 58 * scale) {
        ctx.save();
        ctx.translate(stripe, featureY);
        ctx.rotate(-Math.PI / 4);
        ctx.fillRect(0, 0, 18 * scale, featureH * 2);
        ctx.restore();
      }
      ctx.restore();
    }
    var featureColor = photo ? COLORS.paper : COLORS.green;
    ctx.fillStyle = featureColor;
    ctx.font = '800 ' + Math.round((isSquare ? 52 : 62) * scale) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    var featureTitle = isProfileOnly
      ? (runtime.data.profile.shortDescription || 'PUBLISHED BUSINESS PROFILE')
      : text(occurrence.name, 120);
    drawWrapped(ctx, featureTitle.toUpperCase(), pad + 38 * scale, featureY + 70 * scale, w - pad * 2 - 76 * scale, (isSquare ? 53 : 63) * scale, 2, true);
    ctx.font = '700 ' + Math.round((isSquare ? 23 : 28) * scale) + 'px "DM Sans", Arial, sans-serif';
    var detailLine = isProfileOnly
      ? (runtime.data.profile.categories.join(' · ') || 'INDEPENDENT BUSINESS')
      : marketDate(occurrence.date, true) + (marketHours(occurrence) ? ' · ' + marketHours(occurrence) : '');
    ctx.fillText(detailLine.toUpperCase(), pad + 38 * scale, featureY + (isSquare ? 180 : 205) * scale);
    ctx.font = '500 ' + Math.round((isSquare ? 20 : 25) * scale) + 'px "DM Sans", Arial, sans-serif';
    var placeLine = isProfileOnly
      ? [runtime.data.profile.city, 'SCAN TO SEE THE CURRENT PROFILE'].filter(Boolean).join(' · ')
      : [occurrence.venue, occurrence.address].filter(Boolean).join(' · ');
    drawWrapped(ctx, placeLine, pad + 38 * scale, featureY + (isSquare ? 222 : 255) * scale, w - pad * 2 - 76 * scale, 34 * scale, 2, false);
    if (composition.offer && runtime.mode === 'vendor') {
      var offerHeight = isSquare ? 62 * scale : 82 * scale;
      var offerY = featureY + featureH - offerHeight - 22 * scale;
      ctx.fillStyle = COLORS.tomato;
      ctx.fillRect(pad + 38 * scale, offerY, w - pad * 2 - 76 * scale, offerHeight);
      ctx.fillStyle = COLORS.paper;
      ctx.font = '800 ' + Math.round((isSquare ? 26 : 34) * scale) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
      fitText(ctx, (composition.offer.title + (composition.offer.value ? ' · ' + composition.offer.value : '')).toUpperCase(), pad + 58 * scale, offerY + offerHeight * .65, w - pad * 2 - 116 * scale, (isSquare ? 26 : 34) * scale, 18 * scale);
    } else if (runtime.mode === 'staff') {
      var count = list(selection.publicOccurrence && selection.publicOccurrence.lineup).length;
      ctx.fillStyle = COLORS.tomato;
      ctx.fillRect(pad + 38 * scale, featureY + featureH - 82 * scale, 300 * scale, 62 * scale);
      ctx.fillStyle = COLORS.paper;
      ctx.font = '800 ' + Math.round(29 * scale) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
      ctx.fillText(count + ' CONFIRMED MAKER' + (count === 1 ? '' : 'S'), pad + 58 * scale, featureY + featureH - 42 * scale);
    }

    ctx.fillStyle = COLORS.green;
    ctx.fillRect(0, footerY, w, h - footerY);
    ctx.fillStyle = isApproved ? COLORS.mustard : COLORS.tomato;
    ctx.fillRect(geometry.badgeX, geometry.badgeY, geometry.badgeW, geometry.badgeH);
    ctx.fillStyle = isApproved ? COLORS.ink : COLORS.paper;
    ctx.font = '800 ' + Math.round((isSquare ? 23 : 28) * scale) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    fitText(ctx, badge, geometry.badgeX + 20 * scale, geometry.badgeBaseline, geometry.badgeW - 40 * scale, (isSquare ? 23 : 28) * scale, 17 * scale);
    var qrX = geometry.qrX;
    var qrY = geometry.qrY;
    if (qrCanvas) {
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(geometry.qrQuietX, geometry.qrQuietY, geometry.qrQuietSize, geometry.qrQuietSize);
      ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);
    }
    ctx.fillStyle = COLORS.paper;
    ctx.font = '800 ' + Math.round((isSquare ? 30 : 41) * scale) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    var callout = runtime.mode === 'staff'
      ? 'PLAN YOUR VISIT.'
      : isProfileOnly
        ? 'SEE WHAT WE MAKE.'
        : isApproved
          ? 'FOLLOW FOR CONFIRMATION.'
          : 'COME SAY HELLO.';
    ctx.fillText(callout, pad, geometry.calloutY);
    ctx.font = '500 ' + Math.round(geometry.copyFontSize) + 'px "DM Sans", Arial, sans-serif';
    var footerCopy = runtime.mode === 'staff'
      ? conciseLineup(selection.publicOccurrence && selection.publicOccurrence.lineup)
      : runtime.data.profile.shortDescription;
    drawWrapped(ctx, footerCopy || 'Scan for current public details.', pad, geometry.copyY, geometry.footerTextW, geometry.copyLineHeight, geometry.copyMaxLines, false);
    ctx.font = '800 ' + Math.round(geometry.qrLabelFont) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    fitText(
      ctx,
      qrCanvas ? (isSquare ? 'SCAN FOR DETAILS' : 'SCAN FOR CURRENT DETAILS') : 'PUBLIC LINK IN COPY BUNDLE',
      qrX + qrSize / 2,
      geometry.qrLabelBaseline,
      geometry.qrQuietSize,
      geometry.qrLabelFont,
      11 * scale
    );
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.mustard;
    ctx.fillRect(geometry.bottomBandX, geometry.bottomBandY, geometry.bottomBandW, geometry.bottomBandH);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.font = '800 ' + Math.round((isSquare ? 14 : 18) * scale) + 'px "DM Sans", Arial, sans-serif';
    var caveat = runtime.mode === 'staff'
      ? 'LINEUP FROM CURRENT PUBLIC SCHEDULE · CHECK FOR CHANGES'
      : isProfileOnly
        ? 'PROFILE AND OFFERS · NO SPECIFIC MARKET APPEARANCE CLAIMED'
        : isApproved
          ? 'FINAL ATTENDANCE NOT YET CONFIRMED'
          : 'CONFIRMED BOOKING · CHECK FOR SCHEDULE CHANGES';
    ctx.fillText(caveat, w / 2, geometry.bottomTextY);
    ctx.textAlign = 'left';
    canvas.setAttribute(
      'aria-label',
      isProfileOnly
        ? composition.headline + '. ' + business + '. ' + badge + '.'
        : composition.headline + '. ' + occurrence.name + ', ' + marketDate(occurrence.date, true) + '. ' + badge + '.',
    );
    return geometry;
  }

  function fitText(ctx, value, x, y, maxWidth, preferred, minimum) {
    var size = preferred;
    var font = ctx.font;
    var family = font.slice(font.indexOf('px') + 2);
    var weight = font.split(' ')[0];
    while (size > minimum && ctx.measureText(value).width > maxWidth) {
      size -= 1;
      ctx.font = weight + ' ' + Math.round(size) + 'px ' + family;
    }
    ctx.fillText(value, x, y);
  }

  function drawWrapped(ctx, value, x, y, maxWidth, lineHeight, maxLines, breakLong) {
    var words = String(value || '').split(/\s+/).filter(Boolean);
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    lines = lines.slice(0, maxLines);
    if (lines.length && (words.length > lines.join(' ').split(/\s+/).length || ctx.measureText(lines[lines.length - 1]).width > maxWidth)) {
      var last = lines.length - 1;
      while (lines[last].length > 1 && ctx.measureText(lines[last] + '…').width > maxWidth) lines[last] = lines[last].slice(0, -1);
      lines[last] += '…';
    }
    if (breakLong && lines.length === 1 && ctx.measureText(lines[0]).width > maxWidth) fitText(ctx, lines[0], x, y, maxWidth, parseFloat(ctx.font.match(/([\d.]+)px/)?.[1] || '30'), 18);
    else lines.forEach(function (item, index) { ctx.fillText(item, x, y + index * lineHeight); });
  }

  function drawCover(ctx, image, x, y, width, height) {
    var imageRatio = image.width / image.height;
    var boxRatio = width / height;
    var sx = 0, sy = 0, sw = image.width, sh = image.height;
    if (imageRatio > boxRatio) { sw = image.height * boxRatio; sx = (image.width - sw) / 2; }
    else { sh = image.width / boxRatio; sy = (image.height - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  }

  function canvasBlob() {
    return new Promise(function (resolve, reject) {
      var canvas = runtime.root && runtime.root.querySelector('[data-promo-canvas]');
      if (!canvas || runtime.qrError) { reject(new Error(runtime.qrError || 'The artwork is not ready.')); return; }
      canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('This browser could not prepare the PNG.')); }, 'image/png');
    });
  }

  function fileBase() {
    var selection = currentSelection();
    var name = runtime.mode === 'staff' ? selection && selection.occurrence.name : runtime.data.profile.businessName;
    return (text(name, 80) + '-' + runtime.format + '-market-kit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'market-promotion-kit';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  async function downloadImage() {
    await drawCurrent();
    downloadBlob(await canvasBlob(), fileBase() + '.png');
    announce('PNG download started. Nothing was posted automatically.', 'success');
  }

  function copyBundle() {
    var composition = currentComposition();
    var selection = composition.selection;
    var source = runtime.mode === 'staff'
      ? 'Source: public confirmed/attended lineup for ' + selection.occurrence.name + '.'
      : selection.profileOnly
        ? 'Source: current published vendor profile and active published offers.'
        : 'Source: saved booking status ' + selection.booking.status + ' and current published vendor profile.';
    var caveat = runtime.mode === 'staff'
      ? 'Lineup and market status can change; check the live market page.'
      : selection.profileOnly
        ? 'This general business kit does not claim a specific market appearance.'
        : selection.booking.status === 'approved'
          ? 'Final attendance is not confirmed. This kit intentionally says confirmation is pending.'
          : 'Booking status is confirmed; customers should still check for schedule changes.';
    return [composition.caption, '', 'PUBLIC LINK', composition.link, '', 'SOURCE NOTE', source, caveat, '', 'DELIVERY NOTE', 'This browser-generated kit does not post, email, text, collect payment, or change a booking.'].join('\n');
  }

  function downloadCopy() {
    downloadBlob(new Blob([copyBundle()], { type: 'text/plain;charset=utf-8' }), fileBase() + '-copy.txt');
    announce('Copy bundle downloaded as a text file.', 'success');
  }

  async function shareKit() {
    var composition = currentComposition();
    await drawCurrent();
    var blob = await canvasBlob();
    var file = typeof File === 'function' ? new File([blob], fileBase() + '.png', { type: 'image/png' }) : null;
    if (navigator.share) {
      var payload = { title: composition.headline, text: composition.caption, url: composition.link };
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) payload.files = [file];
      try {
        await navigator.share(payload);
        announce('Share sheet opened with the current kit.', 'success');
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    var copied = await copyText(copyBundle());
    announce(copied ? 'Sharing is unavailable here, so the caption and link were copied.' : 'Sharing is unavailable. Use the PNG and copy download buttons.', copied ? 'success' : 'error');
  }

  async function printPoster() {
    if (runtime.format !== 'poster') {
      runtime.format = 'poster';
      var input = runtime.root.querySelector('input[name="promoFormat"][value="poster"]');
      if (input) input.checked = true;
      var label = runtime.root.querySelector('[data-promo-format-label]');
      if (label) label.textContent = FORMAT.poster.label;
    }
    await drawCurrent();
    var canvas = runtime.root.querySelector('[data-promo-canvas]');
    if (!canvas || runtime.qrError) throw new Error(runtime.qrError || 'The poster is not ready.');
    var frame = document.createElement('iframe');
    frame.className = 'promo-print-frame';
    frame.title = 'Printable market poster';
    document.body.appendChild(frame);
    var doc = frame.contentDocument;
    if (!doc) { frame.remove(); throw new Error('This browser could not open the print layout.'); }
    doc.open();
    doc.write('<!doctype html><html><head><title>Market promotion poster</title><style>@page{size:letter;margin:0}html,body{margin:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img alt="Market promotion poster" src="' + canvas.toDataURL('image/png') + '"></body></html>');
    doc.close();
    var image = doc.querySelector('img');
    var print = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); announce('Print dialog opened for the QR poster.', 'success'); }
      finally { window.setTimeout(function () { frame.remove(); }, 1500); }
    };
    if (image && image.complete) print();
    else if (image) image.onload = print;
    else { frame.remove(); throw new Error('This browser could not prepare the print layout.'); }
  }

  async function copyText(value, control) {
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_error) {
      var target = control;
      var temporary = false;
      if (!target || typeof target.select !== 'function') {
        target = document.createElement('textarea');
        target.value = value;
        target.setAttribute('readonly', '');
        target.className = 'promo-copy-fallback';
        document.body.appendChild(target);
        temporary = true;
      }
      target.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (_copyError) { copied = false; }
      if (temporary) target.remove();
      return copied;
    }
  }

  async function fetchJson(path, token, signal) {
    var headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var response;
    try {
      response = await window.fetch(apiUrl(path), { method: 'GET', headers: headers, cache: 'no-store', credentials: 'omit', signal: signal });
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw new Error('The network did not respond. Check the connection and try again.');
    }
    var data = null;
    try { data = await response.json(); } catch (_error) { data = null; }
    if (!response.ok) {
      var issue = new Error(data && data.message || 'A source request failed (' + response.status + ').');
      issue.status = response.status;
      throw issue;
    }
    return data || {};
  }

  async function loadPayload(force, signal) {
    var token = await window.FSMAuth.getIdToken(force === true);
    var responses = await Promise.all([
      fetchJson('/api/operations?view=vendor', token, signal),
      fetchJson('/api/workspace', token, signal),
      fetchJson('/api/operations', token, signal),
      fetchJson('/api/schedule', '', signal)
    ]);
    return normaliseData(responses[0], responses[1], responses[2], responses[3]);
  }

  async function load(force) {
    if (!runtime.root || runtime.loading) return;
    runtime.loading = true;
    var requestId = ++runtime.requestId;
    if (runtime.controller) runtime.controller.abort();
    runtime.controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (!runtime.data) runtime.root.innerHTML = loadingMarkup();
    try {
      if (!window.FSMAuth || typeof window.FSMAuth.ready !== 'function') throw new Error('Account sign-in could not load.');
      var auth = await window.FSMAuth.ready();
      if (requestId !== runtime.requestId || !runtime.root) return;
      runtime.authUserKey = auth.user && auth.user.userKey || '';
      if (auth.phase !== 'authenticated') {
        runtime.data = null;
        runtime.root.innerHTML = authMarkup();
        return;
      }
      var data;
      try {
        data = await loadPayload(force, runtime.controller && runtime.controller.signal);
      } catch (error) {
        if (error.status === 401 && !force) data = await loadPayload(true, runtime.controller && runtime.controller.signal);
        else throw error;
      }
      if (requestId !== runtime.requestId || !runtime.root) return;
      var current = window.FSMAuth.getState && window.FSMAuth.getState();
      if (!current || !current.user || current.user.userKey !== runtime.authUserKey) throw new Error('The signed-in account changed. Reload the kit.');
      runtime.data = data;
      if (runtime.mode === 'staff' && !data.staffViewer) runtime.mode = 'vendor';
      renderLoaded();
      if (force) announce('Booking, profile, offer, and public lineup records refreshed.', 'success');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (requestId !== runtime.requestId || !runtime.root) return;
      runtime.root.innerHTML = errorMarkup(error.message);
      var retry = runtime.root.querySelector('[data-promo-retry]');
      if (retry) retry.addEventListener('click', function () { load(true); });
    } finally {
      if (requestId === runtime.requestId) runtime.loading = false;
    }
  }

  function bindAuthListener() {
    if (runtime.authListenerBound || !window.FSMAuth || typeof window.FSMAuth.onChange !== 'function') return;
    runtime.authListenerBound = true;
    window.FSMAuth.onChange(function (auth) {
      var key = auth.user && auth.user.userKey || '';
      if (runtime.authUserKey && key !== runtime.authUserKey) {
        runtime.data = null;
        runtime.selectionId = '';
        runtime.offerId = '';
        runtime.drawId += 1;
      }
      runtime.authUserKey = key;
      if (!runtime.root || !document.documentElement.contains(runtime.root)) return;
      if (auth.phase === 'authenticated' && !runtime.loading) load(true);
      else if (auth.phase === 'signed-out') {
        runtime.data = null;
        runtime.root.innerHTML = authMarkup();
      }
    });
  }

  async function initPromotionKit() {
    runtime.root = document.querySelector('[data-promotion-kit]');
    if (!runtime.root) return;
    bindAuthListener();
    await load(false);
  }

  window.renderPromotionKit = renderPromotionKit;
  window.initPromotionKit = initPromotionKit;
})();
