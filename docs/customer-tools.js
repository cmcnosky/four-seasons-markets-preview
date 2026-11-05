(() => {
  'use strict';

  const LOCAL_FOLLOWS = 'fsm-customer-follows-v2';
  const LEGACY_FAVORITES = 'fsm-github-preview-favorites-v1';
  const LOCAL_LANGUAGE = 'fsm-customer-language-v1';
  const LOCAL_SCHEDULE = 'fsm-public-schedule-cache-v1';
  const RESEARCH_CHECKED_AT = '2026-11-03';
  const API_ORIGIN = () => String(window.FSM_API_ORIGIN || '').replace(/\/$/, '');
  const api = path => `${API_ORIGIN()}${path}`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };

  const MARKET_GEO = {
    richardson: { lat: 32.9517, lng: -96.7670 },
    arlington: { lat: 32.7382, lng: -97.1080 },
    'castle-hills': { lat: 33.0359, lng: -96.9068 },
    plano: { lat: 33.0238, lng: -96.7910 },
    carrollton: { lat: 32.9850, lng: -96.8894 },
    'flower-mound': { lat: 33.0441, lng: -97.0500 }
  };
  const PLACE_GEO = {
    '76051': { lat: 32.9343, lng: -97.0781, label: 'Grapevine 76051' },
    '75080': { lat: 32.9483, lng: -96.7299, label: 'Richardson 75080' },
    '76011': { lat: 32.7594, lng: -97.0982, label: 'Arlington 76011' },
    '75056': { lat: 33.0712, lng: -96.8998, label: 'Castle Hills 75056' },
    '75093': { lat: 33.0340, lng: -96.8119, label: 'Plano 75093' },
    '75007': { lat: 33.0034, lng: -96.8897, label: 'Carrollton 75007' },
    '75028': { lat: 33.0383, lng: -97.0711, label: 'Flower Mound 75028' },
    grapevine: { lat: 32.9343, lng: -97.0781, label: 'Grapevine' },
    dallas: { lat: 32.7767, lng: -96.7970, label: 'Dallas' },
    fortworth: { lat: 32.7555, lng: -97.3308, label: 'Fort Worth' },
    'fort worth': { lat: 32.7555, lng: -97.3308, label: 'Fort Worth' },
    frisco: { lat: 33.1507, lng: -96.8236, label: 'Frisco city center' },
    denton: { lat: 33.2148, lng: -97.1331, label: 'Denton city center' },
    mckinney: { lat: 33.1972, lng: -96.6398, label: 'McKinney city center' },
    allen: { lat: 33.1032, lng: -96.6706, label: 'Allen city center' },
    lewisville: { lat: 33.0462, lng: -96.9942, label: 'Lewisville city center' },
    irving: { lat: 32.8140, lng: -96.9489, label: 'Irving city center' },
    garland: { lat: 32.9126, lng: -96.6389, label: 'Garland city center' },
    coppell: { lat: 32.9546, lng: -97.0150, label: 'Coppell city center' },
    southlake: { lat: 32.9412, lng: -97.1342, label: 'Southlake city center' },
    'the colony': { lat: 33.0806, lng: -96.8928, label: 'The Colony city center' }
  };
  const TEXT = {
    en: {
      language: 'Español', near: 'Near me / ZIP', date: 'When', anyDate: 'Any published date',
      today: 'Today', weekend: 'This weekend', pick: 'Pick a date', list: 'List', map: 'Area view',
      approximate: 'Approximate straight-line distance from', noNearby: 'No exact match. Here are the nearest published markets.',
      status: 'Published schedule status', checked: 'Schedule record', unknown: 'No current schedule update has been published here yet.',
      follow: 'Follow for updates', following: 'Following', calendar: 'Add this preview calendar',
      access: 'Visit essentials', help: 'Get help', partner: 'Bring a market to your property'
    },
    es: {
      language: 'English', near: 'Cerca de mí / código postal', date: 'Cuándo', anyDate: 'Cualquier fecha publicada',
      today: 'Hoy', weekend: 'Este fin de semana', pick: 'Elegir fecha', list: 'Lista', map: 'Vista del área',
      approximate: 'Distancia aproximada en línea recta desde', noNearby: 'No hay una coincidencia exacta. Estos son los mercados publicados más cercanos.',
      status: 'Estado publicado del calendario', checked: 'Registro del calendario', unknown: 'Todavía no hay una actualización actual del calendario publicada aquí.',
      follow: 'Seguir para recibir actualizaciones', following: 'Siguiendo', calendar: 'Añadir este calendario de vista previa',
      access: 'Información para la visita', help: 'Obtener ayuda', partner: 'Llevar un mercado a su propiedad'
    }
  };

  const state = {
    language: read(LOCAL_LANGUAGE, 'en') === 'es' ? 'es' : 'en',
    view: 'list',
    occurrences: [],
    scheduleUpdatedAt: null,
    scheduleSourceCheckedAt: null,
    scheduleResearchOnly: false,
    scheduleLastSuccessAt: null,
    scheduleCached: false,
    publicLoaded: false,
    publicError: false,
    activeUserKey: 'anonymous',
    follows: Array.isArray(read(`${LOCAL_FOLLOWS}:anonymous`, read(LEGACY_FAVORITES, []))) ? read(`${LOCAL_FOLLOWS}:anonymous`, read(LEGACY_FAVORITES, [])) : [],
    workspaceVendors: []
  };
  const t = key => TEXT[state.language][key] || TEXT.en[key] || key;

  function milesBetween(a, b) {
    const radians = degrees => degrees * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function normalizedPlace(query) {
    const normalized = String(query || '').trim().toLowerCase();
    const zip = normalized.match(/\b\d{5}\b/)?.[0];
    return PLACE_GEO[zip || normalized.replace(/,?\s*(tx|texas)$/i, '').replace(/\s+/g, ' ')] || null;
  }
  function marketWithDistance(market, place) {
    const geo = MARKET_GEO[market.id];
    return { ...market, approximateMiles: geo && place ? milesBetween(place, geo) : null };
  }
  function sanitizeSaved(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(item => typeof item === 'string' && /^(market|vendor):[A-Za-z0-9_-]{1,120}$/.test(item)))].slice(0, 500);
  }
  function mergeSaved(current, incoming) { return sanitizeSaved([...sanitizeSaved(current), ...sanitizeSaved(incoming)]); }
  function removeSaved(current, key) { return sanitizeSaved(current).filter(item => item !== key); }
  function parseSavedImport(raw) {
    const parsed = JSON.parse(String(raw || ''));
    if (parsed?.format !== 'fsm-saved-v1') throw new Error('unsupported_saved_format');
    return sanitizeSaved(parsed.items);
  }
  function savedExport(items) { return JSON.stringify({ format: 'fsm-saved-v1', exportedAt: new Date().toISOString(), items: sanitizeSaved(items) }, null, 2); }
  function currentCentralDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function weekendDates(baseValue = `${currentCentralDate()}T12:00:00-06:00`) {
    const instant = new Date(baseValue);
    const centralDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
    const base = new Date(`${centralDate}T12:00:00Z`);
    const day = base.getUTCDay();
    const saturday = new Date(base);
    saturday.setUTCDate(base.getUTCDate() + (day === 0 ? -1 : ((6 - day + 7) % 7)));
    const sunday = new Date(saturday); sunday.setUTCDate(saturday.getUTCDate() + 1);
    return [saturday, sunday].map(date => date.toISOString().slice(0, 10));
  }
  function occurrencesFor(marketId) {
    return state.occurrences
      .filter(item => (item.marketId || item.market_id) === marketId)
      .sort((a, b) => String(a.date || a.startsAt || '').localeCompare(String(b.date || b.startsAt || '')));
  }
  function occurrenceFor(marketId, preferredId = '') {
    const items = occurrencesFor(marketId);
    return items.find(item => item.id === preferredId) || items.find(item => String(item.date || '').localeCompare(currentCentralDate()) >= 0) || items.at(-1) || null;
  }
  function timeLabel(value, timeZone = 'America/Chicago') {
    if (!value) return '';
    if (/^\d{2}:\d{2}$/.test(value)) { const [hourText, minute] = value.split(':'); const hour = Number(hourText); return `${hour % 12 || 12}${minute === '00' ? '' : `:${minute}`} ${hour >= 12 ? 'PM' : 'AM'}`; }
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
  }
  function occurrenceStatus(item) {
    const status = String(item?.status || '').toLowerCase();
    if (status === 'cancelled') return { label: state.language === 'es' ? 'CANCELADO' : 'CANCELLED', className: 'is-cancelled' };
    if (status === 'delayed') return { label: state.language === 'es' ? 'RETRASADO' : 'DELAYED', className: 'is-delayed' };
    if (status === 'scheduled') return { label: state.language === 'es' ? 'PROGRAMADO' : 'SCHEDULED', className: 'is-scheduled' };
    return { label: state.language === 'es' ? 'LISTADO PUBLICADO' : 'PUBLISHED LISTING', className: 'is-unconfirmed' };
  }
  function cardMarket(market) {
    const occurrence=market.selectedOccurrence||occurrenceFor(market.id);
    if(!occurrence)return{...market,href:`#market/${market.id}`,status:'RESEARCHED LISTING'};
    const day=occurrence.date?new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(`${occurrence.date}T12:00:00Z`)):market.day;
    const status=occurrenceStatus(occurrence).label;
    return{...market,day,date:occurrence.date||market.date,venue:occurrence.venue||market.venue,address:occurrence.address||market.address,hours:occurrence.startsAt&&occurrence.endsAt?`${timeLabel(occurrence.startsAt,occurrence.timeZone)}–${timeLabel(occurrence.endsAt,occurrence.timeZone)}`:market.hours,href:`#market/${market.id}?occurrence=${encodeURIComponent(occurrence.id)}`,status:state.scheduleCached?`${state.language==='es'?'ÚLTIMO GUARDADO':'LAST SAVED'} · ${status}`:status,occurrence};
  }
  function updatedLabel(value) {
    if (!value) return t('unknown');
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return t('unknown');
    return `${t('checked')} · ${new Intl.DateTimeFormat(state.language === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' }).format(date)} CT`;
  }
  function lastSuccessLabel(value) {
    if (!value) return state.language === 'es' ? 'hora de actualización desconocida' : 'refresh time unknown';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return state.language === 'es' ? 'hora de actualización desconocida' : 'refresh time unknown';
    return new Intl.DateTimeFormat(state.language === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' }).format(date) + ' CT';
  }
  function sourceCheckedLabel(value) {
    return `${state.language === 'es' ? 'Fuente revisada' : 'Source checked'} · ${lastSuccessLabel(value)}`;
  }
  function setScheduleMetadata(occurrences, updatedAt) {
    state.scheduleResearchOnly = occurrences.length > 0 && occurrences.every(item => String(item.status || '') === 'published_listing');
    state.scheduleSourceCheckedAt = occurrences.reduce((latest, item) => {
      const value = item.sourceCheckedAt || item.source_checked_at || '';
      return String(value) > String(latest || '') ? value : latest;
    }, null);
    const occurrenceUpdatedAt = occurrences.reduce((latest, item) => String(item.updatedAt || item.updated_at || '') > String(latest || '') ? (item.updatedAt || item.updated_at) : latest, null);
    state.scheduleUpdatedAt = state.scheduleResearchOnly && state.scheduleSourceCheckedAt ? state.scheduleSourceCheckedAt : (updatedAt || occurrenceUpdatedAt);
  }
  function scheduleSummary() {
    if (state.scheduleCached) return state.language === 'es'
      ? `Copia guardada; no es una comprobación actual. Última actualización correcta: ${lastSuccessLabel(state.scheduleLastSuccessAt)}.`
      : `Saved schedule; not a current check. Last successful refresh: ${lastSuccessLabel(state.scheduleLastSuccessAt)}.`;
    if (state.scheduleResearchOnly && state.scheduleSourceCheckedAt) return state.language === 'es'
      ? `Fuente investigada revisada: ${lastSuccessLabel(state.scheduleSourceCheckedAt)}.`
      : `Researched source checked: ${lastSuccessLabel(state.scheduleSourceCheckedAt)}.`;
    if (state.scheduleUpdatedAt) return updatedLabel(state.scheduleUpdatedAt);
    return state.language === 'es'
      ? `Información investigada revisada el ${RESEARCH_CHECKED_AT}; no hay una actualización actual del calendario.`
      : `Researched information checked ${RESEARCH_CHECKED_AT}; no current schedule update is available.`;
  }

  function finder(home = false) {
    const language = state.language;
    return `<form class="filters customer-finder" id="market-filter" data-customer-finder>
      <div class="field field-search"><label for="market-search">${language === 'es' ? 'Ciudad o código postal compatible' : 'City or supported ZIP'}</label><div class="input-wrap"><span class="search-icon" aria-hidden="true">⌖</span><input id="market-search" name="q" type="search" placeholder="${language === 'es' ? 'Ciudad o código postal' : 'City or ZIP code'}" autocomplete="postal-code"></div></div>
      <div class="field"><label for="market-date">${t('date')}</label><select id="market-date" name="date"><option value="">${t('anyDate')}</option><option value="today">${t('today')}</option><option value="weekend">${t('weekend')}</option><option value="pick">${t('pick')}</option></select></div>
      <div class="field customer-date-field" hidden><label for="market-specific-date">${t('pick')}</label><input id="market-specific-date" name="specificDate" type="date"></div>
      <div class="field"><label for="market-day">${language === 'es' ? 'Día' : 'Market day'}</label><select id="market-day" name="day"><option value="">${language === 'es' ? 'Cualquier día' : 'Any day'}</option><option>Saturday</option><option>Sunday</option></select></div>
      <input type="hidden" id="market-frequency" name="frequency" value="">
      ${home ? '<button class="button green" type="submit">' + (language === 'es' ? 'BUSCAR MERCADO ↗' : 'FIND A MARKET ↗') + '</button>' : ''}
    </form>`;
  }

  function marketMeta(market, preferredId = '') {
    const occurrence = occurrenceFor(market.id, preferredId);
    const status = occurrenceStatus(occurrence);
    return { occurrence, status };
  }
  function selectMarketItems(markets, criteria) {
    const query = String(criteria.query || '').trim().toLowerCase();
    const place = normalizedPlace(query);
    const unsupportedZip = /^\d{5}$/.test(query) && !place;
    const exactTextMatches = markets.filter(market => !query || [market.short, market.city, market.address, market.venue].join(' ').toLowerCase().includes(query));
    let candidates = (place && query && exactTextMatches.length === 0) || unsupportedZip ? markets : exactTextMatches;
    if (criteria.day) candidates = candidates.filter(market => market.day === criteria.day);
    const validDates = criteria.dateFilter === 'today' ? [criteria.todayDate || currentCentralDate()] : criteria.dateFilter === 'weekend' ? (criteria.weekend || weekendDates()) : criteria.dateFilter === 'pick' && criteria.specificDate ? [criteria.specificDate] : [];
    if (criteria.dateFilter) {
      if (validDates.length) candidates = candidates.filter(market => {
        const occurrenceDates = occurrencesFor(market.id).map(item => item.date).filter(Boolean);
        return validDates.some(date => occurrenceDates.length ? occurrenceDates.includes(date) : market.date === date);
      });
    }
    const items = candidates.map(market => {
      const occurrences = occurrencesFor(market.id);
      const selectedOccurrence = validDates.length ? occurrences.find(item => validDates.includes(item.date)) : occurrenceFor(market.id);
      return { ...marketWithDistance(market, place), selectedOccurrence };
    });
    if (place) items.sort((a, b) => (a.approximateMiles ?? Infinity) - (b.approximateMiles ?? Infinity));
    return { items, place, nearestMode: Boolean(place && query && exactTextMatches.length === 0), unsupportedZip };
  }
  function filterMarkets({ markets, renderCard }) {
    const search = document.querySelector('#market-search');
    const dayControl = document.querySelector('#market-day');
    const dateControl = document.querySelector('#market-date');
    const specificControl = document.querySelector('#market-specific-date');
    const query = search?.value.trim().toLowerCase() || '';
    const day = dayControl?.value || '';
    const dateFilter = dateControl?.value || '';
    const { items, place, nearestMode, unsupportedZip } = selectMarketItems(markets, { query, day, dateFilter, specificDate: specificControl?.value });
    const count = document.querySelector('#market-count');
    const result = document.querySelector('#market-results');
    if (!count || !result) return;
    count.textContent = `${items.length} ${items.length === 1 ? (state.language === 'es' ? 'mercado' : 'market') : (state.language === 'es' ? 'mercados' : 'markets')} ${state.language === 'es' ? 'encontrados' : 'found'} · ${scheduleSummary()}`;
    const explanation = nearestMode ? `<div class="customer-distance-note" role="status"><strong>${escapeHtml(t('noNearby'))}</strong><span>${escapeHtml(t('approximate'))} ${escapeHtml(place.label)}. Distances use city-center estimates, not driving miles.</span></div>` : unsupportedZip ? `<div class="customer-distance-note" role="status"><strong>Distance is not available for ZIP ${escapeHtml(query)}.</strong><span>Showing all matching published dates. Search a listed market city or market ZIP for approximate distance.</span></div>` : '';
    const cards = items.map(market => {
      const rendered = renderCard(market);
      if (market.approximateMiles === null) return rendered;
      return rendered.replace('<div class="card-foot">', `<p class="customer-distance">≈ ${market.approximateMiles.toFixed(1)} miles straight-line</p><div class="card-foot">`);
    }).join('');
    const empty = `<div class="empty" style="grid-column:1/-1"><h3>${state.language === 'es' ? 'No hay mercados para esa fecha.' : 'No published markets match that date.'}</h3><p>${state.language === 'es' ? 'Pruebe otra fecha o quite un filtro.' : 'Try another date or clear the filters.'}</p><button class="button outline" data-reset="markets">${state.language === 'es' ? 'Quitar filtros' : 'Clear filters'}</button></div>`;
    result.classList.remove('customer-area-view');
    result.innerHTML = `${explanation}${items.length && state.view === 'map' ? areaMap(items, place) : ''}${items.length ? cards : empty}`;
    document.querySelectorAll('[data-market-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.marketView === state.view)));
  }

  function controls() {
    return `<div class="customer-view-controls" aria-label="Market result view"><button class="chip" type="button" data-market-view="list" aria-pressed="${state.view === 'list'}">${t('list')}</button><button class="chip" type="button" data-market-view="map" aria-pressed="${state.view === 'map'}">${t('map')}</button><span>${state.language === 'es' ? 'La vista del área no está a escala.' : 'Area view is not to scale.'}</span></div>`;
  }

  function areaMap(items, place) {
    const points = items.map(item => ({ item, geo: MARKET_GEO[item.id] })).filter(point => point.geo);
    if (!points.length) return '';
    const all = place ? [...points.map(point => point.geo), place] : points.map(point => point.geo);
    const minLat=Math.min(...all.map(point=>point.lat))-.03,maxLat=Math.max(...all.map(point=>point.lat))+.03,minLng=Math.min(...all.map(point=>point.lng))-.04,maxLng=Math.max(...all.map(point=>point.lng))+.04;
    const xy=geo=>({x:40+(geo.lng-minLng)/(maxLng-minLng)*640,y:35+(maxLat-geo.lat)/(maxLat-minLat)*330});
    const marketPoints=points.map(({item,geo})=>{const point=xy(geo);return `<a href="#market/${escapeHtml(item.id)}${item.selectedOccurrence?.id?`?occurrence=${encodeURIComponent(item.selectedOccurrence.id)}`:''}" aria-label="${escapeHtml(item.short)}"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="9"></circle><text x="${(point.x+13).toFixed(1)}" y="${(point.y+4).toFixed(1)}">${escapeHtml(item.short)}</text></a>`;}).join('');
    const origin=place?(()=>{const point=xy(place);return `<g class="customer-map-origin"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7"></circle><text x="${(point.x+12).toFixed(1)}" y="${(point.y+4).toFixed(1)}">${escapeHtml(place.label)}</text></g>`;})():'';
    return `<figure class="customer-area-map"><svg role="img" aria-labelledby="customer-map-title customer-map-desc" viewBox="0 0 720 400"><title id="customer-map-title">Relative locations of published markets</title><desc id="customer-map-desc">A coordinate plot showing approximate relative positions. It is not a street map. Each market name opens its details and directions link.</desc><g class="customer-map-grid" aria-hidden="true"><path d="M40 115H680M40 205H680M40 295H680M200 35V365M360 35V365M520 35V365"></path></g>${marketPoints}${origin}<g class="customer-map-north"><path d="M680 50v35m0-35-8 13m8-13 8 13"></path><text x="674" y="44">N</text></g></svg><figcaption>Approximate relative positions from published addresses · not a street map. Open a market for turn-by-turn directions.</figcaption></figure>`;
  }

  function statusNote() {
    const copy = state.scheduleCached
      ? `${scheduleSummary()} ${state.language === 'es' ? 'El estado, la lista y las fechas guardadas pueden haber cambiado. La disponibilidad de reservas no se muestra desde la copia guardada; confirme con el organizador.' : 'Saved status, lineup, and dates may have changed. Booking availability is not shown from the saved copy; confirm with the organizer.'}`
      : state.scheduleUpdatedAt
      ? `${scheduleSummary()} ${state.language === 'es' ? 'Revise cada mercado para ver el estado programado, retrasado o cancelado y su lista confirmada. Esta vista previa no demuestra por sí sola la autorización del organizador; verifique la fuente del organizador antes de viajar.' : 'Check each market for scheduled, delayed, or cancelled status and its confirmed lineup. This preview does not by itself prove organizer authorization; verify the organizer source before traveling.'}`
      : `${state.language === 'es' ? `Estos listados investigados se revisaron el ${RESEARCH_CHECKED_AT}. Todavía no hay una actualización actual publicada; los horarios, el clima y las listas pueden cambiar.` : `These researched listings were checked ${RESEARCH_CHECKED_AT}. A current schedule update has not been published here yet; hours, weather, and lineups can change.`}`;
    return `<div class="notice"><span aria-hidden="true">ⓘ</span><p><strong>A little planning goes a long way.</strong> ${escapeHtml(copy)} <a href="#help">Ask the market team ↗</a></p></div>`;
  }

  function homeSchedule(markets) {
    if (!state.occurrences.length) return '';
    const upcoming = state.occurrences.filter(item => !item.date || item.date >= currentCentralDate());
    const rows = upcoming
      .sort((a, b) => `${a.date || ''}${a.startsAt || ''}`.localeCompare(`${b.date || ''}${b.startsAt || ''}`))
      .slice(0, 8)
      .map((occurrence, index) => {
        const market = markets.find(item => item.id === occurrence.marketId);
        const status = occurrenceStatus(occurrence);
        const date = occurrence.date ? new Intl.DateTimeFormat(state.language === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${occurrence.date}T12:00:00Z`)) : 'Date pending';
        const hours=occurrence.startsAt&&occurrence.endsAt?`${timeLabel(occurrence.startsAt,occurrence.timeZone)}–${timeLabel(occurrence.endsAt,occurrence.timeZone)}`:market?.hours||'';
        const rowStatus=state.scheduleCached?`${state.language==='es'?'ÚLTIMO GUARDADO':'LAST SAVED'} · ${status.label}`:status.label;
        return `<a class="schedule-row" href="#market/${escapeHtml(occurrence.marketId)}?occurrence=${encodeURIComponent(occurrence.id)}"><span class="row-number">${String(index + 1).padStart(2, '0')}</span><span class="row-city">${escapeHtml(occurrence.name || market?.short || occurrence.marketId)}<small>${escapeHtml(occurrence.venue || market?.venue || '')}</small></span><span class="row-day">${escapeHtml(date)}<small>${escapeHtml(rowStatus)}</small></span><span class="row-hours">${escapeHtml(hours)}</span><span class="row-arrow">↗</span></a>`;
      }).join('');
    const board=rows||`<div class="empty"><h3>No upcoming dated markets are published yet.</h3><p>Use the market guide for recurring locations and check back for a schedule update.</p></div>`;
    const calendarLabel = state.scheduleCached ? (state.language === 'es' ? 'Copia guardada · no actual' : 'Saved copy · not current') : (state.language === 'es' ? 'Calendario publicado' : 'Published calendar');
    const calendarCopy = state.scheduleCached ? scheduleSummary() + (state.language === 'es' ? ' Confirme el estado antes de viajar.' : ' Confirm status before traveling.') : `${scheduleSummary()} ${state.language === 'es' ? 'Los cambios de estado se publican en cada mercado.' : 'Status changes appear on each market page.'}`;
    return `<section class="schedule-strip customer-schedule-strip${state.scheduleCached ? ' is-cached' : ''}"><div class="wrap"><div class="schedule-label"><span class="eyebrow">${calendarLabel}</span><strong>${upcoming.length}</strong><span>${state.language === 'es' ? 'próximas fechas' : 'upcoming occurrences'}</span></div><div class="customer-strip-copy"><b>${escapeHtml(calendarCopy)}</b>${state.scheduleCached ? `<p>${state.language === 'es' ? 'La disponibilidad de reservas guardada no se muestra.' : 'Saved booking availability is not shown.'}</p>` : ''}</div><a href="#markets" aria-label="View all market details">↗</a></div></section><section class="section wrap customer-home-schedule"><div class="section-head"><div><span class="eyebrow">01 / ${state.language === 'es' ? 'Elija su mercado' : 'Pick your place'}</span><h2>${state.language === 'es' ? 'SU FIN DE SEMANA EMPIEZA AQUÍ.' : 'YOUR WEEKEND STARTS HERE.'}</h2></div><a class="text-link" href="#markets">${state.language === 'es' ? 'Ver todos los mercados' : 'Full market guide'} ↗</a></div>${finder(true)}<div class="schedule-board">${board}</div></section>`;
  }

  function schedulePanel(market, preferredId = '') {
    const { occurrence, status } = marketMeta(market, preferredId);
    const details = occurrence?.publicMessage || occurrence?.public_message || occurrence?.note || '';
    const lineup = Array.isArray(occurrence?.lineup) ? occurrence.lineup : [];
    const calendarLink = occurrence?.id ? `<a class="button small" href="${escapeHtml(api(`/api/calendar?occurrence=${encodeURIComponent(occurrence.id)}`))}">${t('calendar')} ↗</a>` : '';
    const lineupHeading=state.scheduleCached?(state.language==='es'?'Última lista guardada; puede haber cambiado':'Last saved lineup; may have changed'):(state.language === 'es' ? 'Vendedores confirmados' : 'Confirmed lineup');
    const occurrenceCheckedAt=occurrence?.status==='published_listing'?(occurrence?.sourceCheckedAt||occurrence?.source_checked_at):(occurrence?.updatedAt||occurrence?.updated_at||state.scheduleUpdatedAt);
    const occurrenceFreshness=occurrence?.status==='published_listing'?sourceCheckedLabel(occurrenceCheckedAt):updatedLabel(occurrenceCheckedAt||state.scheduleUpdatedAt);
    const lineupText = lineup.length ? `<p><b>${lineupHeading}:</b> ${lineup.map(item=>escapeHtml(item.name)).join(' · ')} <span>(${escapeHtml(occurrenceFreshness)})</span></p>` : `<p>${state.language === 'es' ? 'Todavía no hay una lista confirmada publicada para esta fecha.' : 'No confirmed lineup has been published for this occurrence yet.'}</p>`;
    const statusHeading = state.scheduleCached ? (state.language === 'es' ? 'Horario guardado · no actual' : 'Saved schedule · not current') : t('status');
    const statusLabel = state.scheduleCached ? `${state.language === 'es' ? 'ÚLTIMO ESTADO GUARDADO' : 'LAST SAVED STATUS'}: ${status.label}` : status.label;
    const staleWarning = state.scheduleCached ? `<p class="customer-stale-warning"><b>${escapeHtml(scheduleSummary())}</b> ${state.language === 'es' ? 'El estado, la lista y las fechas pueden haber cambiado. Confirme antes de viajar.' : 'Status, lineup, and dates may have changed. Confirm before traveling.'}</p>` : '';
    return `<section class="customer-live-status ${status.className}${state.scheduleCached ? ' is-cached' : ''}" id="customer-live-status" aria-live="polite"><div><span class="eyebrow">${statusHeading}</span><strong>${escapeHtml(statusLabel)}</strong>${staleWarning}<p>${escapeHtml(details || (occurrenceCheckedAt ? occurrenceFreshness : scheduleSummary()))}</p>${lineupText}</div><div class="customer-status-actions"><button class="button outline small" type="button" data-follow="market:${escapeHtml(market.id)}">${isFollowing(`market:${market.id}`) ? t('following') : t('follow')}</button>${calendarLink}</div></section>`;
  }
  function essentials(market, preferredId = '') {
    const occurrence = occurrenceFor(market.id, preferredId);
    const published = {
      arlington: state.language === 'es' ? 'Hay estacionamiento gratuito publicado y estacionamiento accesible en Center Street.' : 'Published information lists free parking and accessible parking on Center Street.',
      plano: state.language === 'es' ? 'Visit Plano describe este mercado como accesible para sillas de ruedas y apto para mascotas.' : 'Visit Plano describes this market as wheelchair accessible and pet-friendly.'
    }[market.id];
    const access = occurrence?.accessNotes || published || (state.language === 'es' ? 'Los detalles de acceso no se han verificado para este lugar.' : 'Step-free access details have not been verified for this location.');
    const parking = occurrence?.parkingNotes || (state.language === 'es' ? 'No verificado; consulte al organizador o al lugar.' : 'Not verified; check with the organizer or venue.');
    return `<section class="customer-essentials"><h2>${t('access')}</h2><dl><div><dt>${state.language === 'es' ? 'Dirección' : 'Address'}</dt><dd>${escapeHtml(occurrence?.address || market.address)}</dd></div><div><dt>${state.language === 'es' ? 'Acceso' : 'Access'}</dt><dd>${escapeHtml(access)}</dd></div><div><dt>${state.language === 'es' ? 'Estacionamiento' : 'Parking'}</dt><dd>${escapeHtml(parking)}</dd></div><div><dt>${state.language === 'es' ? 'Baños y mascotas' : 'Restrooms & pets'}</dt><dd>${escapeHtml(market.id === 'plano' ? (state.language === 'es' ? 'Apto para mascotas según Visit Plano; confirme las condiciones del día.' : 'Pet-friendly per Visit Plano; confirm day-of conditions.') : (state.language === 'es' ? 'No verificado; consulte al organizador o al lugar.' : 'Not verified; check with the organizer or venue.'))}</dd></div></dl><a class="text-link" href="#help?market=${encodeURIComponent(market.id)}">${t('help')} ↗</a></section>`;
  }

  function isFollowing(key) { return state.follows.includes(key); }
  function followStorageKey(userKey = state.activeUserKey) { return `${LOCAL_FOLLOWS}:${userKey || 'anonymous'}`; }
  function cloudFollow(key) {
    const match = String(key || '').match(/^(market|vendor):(.+)$/);
    if (!match) return null;
    if (match[1] === 'market') return { kind: 'market', targetId: match[2], localKey: key };
    if (!match[2].startsWith('profile-')) return null;
    return { kind: 'vendor', targetId: match[2].slice('profile-'.length), localKey: key };
  }
  function localFollow(item) {
    if (!item || !['market', 'vendor'].includes(item.kind) || typeof item.targetId !== 'string') return '';
    return item.kind === 'vendor' ? `vendor:profile-${item.targetId}` : `market:${item.targetId}`;
  }
  function applyFollowsToSaved() {
    const savedApi = window.FSMSaved;
    if (!savedApi?.get || !savedApi?.replace) return;
    const current = sanitizeSaved(savedApi.get()).sort();
    const desired = sanitizeSaved(state.follows).sort();
    if (current.length !== desired.length || current.some((key, index) => key !== desired[index])) savedApi.replace(desired);
  }
  function savedChanged(items) {
    state.follows = sanitizeSaved(items);
    write(followStorageKey(), state.follows);
    saveFollows(state.activeUserKey);
  }
  async function saveFollows(expectedUserKey = state.activeUserKey) {
    write(followStorageKey(), state.follows);
    const auth = window.FSMAuth?.getState?.();
    const userKey = auth?.phase === 'authenticated' ? auth.user?.userKey : '';
    if (!userKey || userKey !== expectedUserKey) return;
    try {
      const followsSnapshot = [...state.follows];
      const token = await window.FSMAuth.getIdToken();
      if (window.FSMAuth?.getState?.().user?.userKey !== userKey) return;
      const current = new Set(followsSnapshot);
      const previous = Array.isArray(state.serverFollows) ? state.serverFollows : [];
      for (const key of [...new Set([...followsSnapshot, ...previous])]) {
        if (window.FSMAuth?.getState?.().user?.userKey !== userKey) return;
        const target = cloudFollow(key);
        if (!target) continue;
        const response = await fetch(api('/api/customer'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'follow.set', payload: { kind: target.kind, targetId: target.targetId, follow: current.has(key), reminder: false } }) });
        if (!response.ok) throw new Error('follow_sync_failed');
      }
      if (window.FSMAuth?.getState?.().user?.userKey === userKey) state.serverFollows = followsSnapshot.filter(cloudFollow);
    } catch { /* Local preference remains available when account sync is unavailable. */ }
  }
  async function loadCustomerPreferences() {
    try {
      await window.FSMAuth?.ready?.();
      const initialAuth = window.FSMAuth?.getState?.();
      const userKey = initialAuth?.phase === 'authenticated' ? initialAuth.user?.userKey : '';
      if (!userKey) return;
      const token = await window.FSMAuth.getIdToken();
      const response = await fetch(api('/api/customer'), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (window.FSMAuth?.getState?.().user?.userKey !== userKey) return;
      const remote = Array.isArray(data.follows) ? data.follows.map(localFollow).filter(Boolean) : [];
      state.activeUserKey = userKey;
      state.serverFollows = remote;
      const scoped = read(followStorageKey(userKey), []);
      state.follows = [...new Set([...(Array.isArray(scoped) ? scoped : []), ...remote])];
      write(followStorageKey(userKey), state.follows);
      applyFollowsToSaved();
      if (location.hash.startsWith('#saved')) window.FSMRender?.();
      if (state.follows.some(key => !remote.includes(key))) saveFollows(userKey);
    } catch { /* Browser-local preferences still work without an account connection. */ }
  }
  function authChanged(authState) {
    const nextKey = authState?.phase === 'authenticated' ? authState.user?.userKey || '' : 'anonymous';
    if (!nextKey || nextKey === state.activeUserKey) return;
    state.activeUserKey = nextKey;
    state.serverFollows = [];
    const scoped = read(followStorageKey(nextKey), []);
    state.follows = Array.isArray(scoped) ? scoped : [];
    applyFollowsToSaved();
    if (nextKey !== 'anonymous') loadCustomerPreferences();
    if (location.hash.startsWith('#saved')) window.FSMRender?.();
  }
  function toggleFollow(key, button) {
    state.follows = isFollowing(key) ? state.follows.filter(item => item !== key) : [...state.follows, key];
    applyFollowsToSaved();
    saveFollows(state.activeUserKey);
    if (button) { button.textContent = isFollowing(key) ? t('following') : t('follow'); button.setAttribute('aria-pressed', String(isFollowing(key))); }
  }

  function withoutStaleAvailability(occurrence) {
    if (!occurrence || typeof occurrence !== 'object') return null;
    const copy = { ...occurrence };
    delete copy.bookingsOpen;
    delete copy.bookingDeadlineAt;
    delete copy.booking_deadline_at;
    return copy;
  }
  function scheduleCachePayload(data, lastSuccessAt = new Date().toISOString()) {
    const occurrences = (Array.isArray(data?.occurrences) ? data.occurrences : Array.isArray(data?.schedule) ? data.schedule : [])
      .map(withoutStaleAvailability).filter(Boolean);
    return {
      version: 1,
      lastSuccessAt,
      updatedAt: data?.updatedAt || data?.updated_at || null,
      occurrences
    };
  }
  function readScheduleCache() {
    const cached = read(LOCAL_SCHEDULE, null);
    if (!cached || cached.version !== 1 || !Array.isArray(cached.occurrences) || !cached.lastSuccessAt) return null;
    const lastSuccess = new Date(cached.lastSuccessAt);
    if (Number.isNaN(lastSuccess.valueOf())) return null;
    return scheduleCachePayload(cached, cached.lastSuccessAt);
  }
  async function loadPublicState() {
    try {
      const response = await fetch(api('/api/schedule'), { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('schedule_unavailable');
      const data = await response.json();
      if (!data || (!Array.isArray(data.occurrences) && !Array.isArray(data.schedule))) throw new Error('invalid_schedule');
      const cached = scheduleCachePayload(data);
      state.occurrences = (Array.isArray(data.occurrences) ? data.occurrences : data.schedule).filter(item => item && typeof item === 'object');
      setScheduleMetadata(state.occurrences, cached.updatedAt);
      state.scheduleLastSuccessAt = cached.lastSuccessAt;
      state.scheduleCached = false;
      state.publicLoaded = true;
      state.publicError = false;
      write(LOCAL_SCHEDULE, cached);
      refreshCurrentPage();
    } catch {
      const cached = readScheduleCache();
      if (cached) {
        state.occurrences = cached.occurrences;
        setScheduleMetadata(cached.occurrences, cached.updatedAt);
        state.scheduleLastSuccessAt = cached.lastSuccessAt;
        state.scheduleCached = true;
      }
      state.publicLoaded = true;
      state.publicError = true;
      refreshCurrentPage();
    }
  }
  function refreshCurrentPage() {
    const raw = location.hash.slice(1).split('?')[0];
    if (raw === 'home' || raw.startsWith('market/')) window.FSMRender?.();
    if (raw === 'markets') window.FSMFilterMarkets?.();
  }

  function savedPage(saved, markets, vendors, renderMarket, renderVendor) {
    const marketItems = markets.filter(market => saved.includes(`market:${market.id}`));
    const allVendors = [...vendors, ...state.workspaceVendors];
    const vendorItems = allVendors.filter(vendor => saved.includes(`vendor:${vendor.id}`));
    const followedMarkets = markets.filter(market => isFollowing(`market:${market.id}`) && !saved.includes(`market:${market.id}`));
    const empty = !marketItems.length && !vendorItems.length && !followedMarkets.length;
    return `<section class="page-head wrap"><span class="eyebrow">${state.language === 'es' ? 'Sus mercados y negocios' : 'Your markets and makers'}</span><h1>${state.language === 'es' ? 'GUARDADOS Y SEGUIDOS.' : 'SAVED & FOLLOWED.'}</h1><p>${state.language === 'es' ? 'Los guardados funcionan en este navegador. Al iniciar sesión, los mercados y perfiles publicados compatibles se sincronizan entre dispositivos.' : 'Saved items work in this browser. When signed in, supported market and published-vendor follows sync across devices.'}</p></section><section class="wrap" id="customer-saved-content">${empty ? '<div class="empty"><h3>Nothing saved yet.</h3><p>Use the bookmark or follow controls on a market or maker.</p><div class="button-row" style="justify-content:center"><a class="button" href="#markets">Find a market ↗</a><a class="button outline" href="#vendors">Meet the vendors ↗</a></div></div>' : ''}${followedMarkets.length ? `<div class="saved-section"><div class="section-head"><h2>FOLLOWED MARKETS</h2></div><div class="market-grid">${followedMarkets.map(renderMarket).join('')}</div></div>` : ''}${marketItems.length ? `<div class="saved-section"><div class="section-head"><h2>SAVED MARKETS</h2></div><div class="market-grid">${marketItems.map(renderMarket).join('')}</div></div>` : ''}${vendorItems.length ? `<div class="saved-section"><div class="section-head"><h2>SAVED MAKERS</h2></div><div class="vendor-grid">${vendorItems.map(renderVendor).join('')}</div></div>` : ''}<div class="customer-preferences"><h2>UPDATE PREFERENCES</h2><p>Save and follow use one list. Signed-in market favorites and active vendor-published profiles use account sync. Researched vendor listings stay browser-only because they do not have a website account record. Email, text, and push delivery remain off until a supported channel is connected and selected.</p><a class="button outline" href="#account">Account & notification settings ↗</a><details class="customer-portability"><summary>Move or clear browser-saved favorites</summary><p>Copy an export before clearing this browser. Importing merges valid market and vendor keys; it does not overwrite existing favorites.</p><div class="button-row"><button class="button outline small" type="button" data-export-saved>Copy export</button><button class="button outline small" type="button" data-clear-saved>Clear browser saves</button></div><label for="saved-import">Paste a Four Seasons saved-list export</label><textarea id="saved-import" rows="5"></textarea><button class="button outline small" type="button" data-import-saved>Merge import</button><p class="fine" data-saved-portability-status role="status"></p></details></div></section>`;
  }

  function helpPage(params, partner = false) {
    const market = params.get('market') || '';
    const heading = partner ? t('partner') : t('help');
    return `<section class="page-head wrap"><span class="eyebrow">${partner ? 'Cities · properties · community partners' : 'Questions · access · account help'}</span><h1>${escapeHtml(heading)}.</h1><p>${partner ? 'Tell the operations team about the location and the community you hope to serve.' : 'Send the details once. The market or page you came from will stay attached to the request.'}</p></section><section class="wrap details-layout"><form class="customer-contact-form" data-contact-kind="${partner ? 'partner' : 'support'}"><input type="hidden" name="marketId" value="${escapeHtml(market)}"><div class="field"><label for="customer-contact-name">Name</label><input id="customer-contact-name" name="name" autocomplete="name" required maxlength="100"></div><div class="field"><label for="customer-contact-email">Email</label><input id="customer-contact-email" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="customer-contact-phone">Phone <span class="fine">(optional)</span></label><input id="customer-contact-phone" name="phone" type="tel" autocomplete="tel" maxlength="30"></div>${partner ? '<div class="field"><label for="customer-contact-property">Property / organization</label><input id="customer-contact-property" name="organization" maxlength="160" required></div><div class="field"><label for="customer-contact-city">City</label><input id="customer-contact-city" name="city" autocomplete="address-level2" maxlength="100" required></div>' : ''}<div class="field"><label for="customer-contact-subject">${partner ? 'What should we know?' : 'How can we help?'}</label><textarea id="customer-contact-subject" name="message" rows="7" minlength="10" maxlength="3000" required></textarea></div><label class="customer-consent"><input type="checkbox" required> I understand this saves my contact details in this independent preview’s staff inbox for review.</label><button class="button" type="submit">SEND REQUEST →</button><p class="fine" data-contact-status role="status"></p></form><aside class="detail-panel"><h3>WHAT HAPPENS NEXT</h3><p>The request is saved in this proposal’s staff inbox. Contact the official organizer directly for current market support. A receipt confirms storage; email delivery is not connected.</p><p class="fine">Do not include payment-card information, passwords, medical information, or government identifiers.</p><a class="text-link" href="#markets">Back to market guide ↗</a></aside></section>`;
  }

  async function submitContact(form) {
    const status = form.querySelector('[data-contact-status]');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; status.textContent = 'Sending…';
    try {
      const body = Object.fromEntries(new FormData(form));
      body.kind = form.dataset.contactKind;
      body.page = location.href;
      const kind = form.dataset.contactKind === 'partner' ? 'property' : 'support';
      const context = [body.marketId ? `Market: ${body.marketId}` : '', body.city ? `City: ${body.city}` : '', `Page: ${String(body.page).slice(0, 500)}`].filter(Boolean).join('\n');
      const message = `${body.message}\n\n${context}`.slice(0, 4000);
      const response = await fetch(api('/api/operations/public'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inquiry.submit', payload: { kind, name: body.name, email: body.email, phone: body.phone || undefined, organization: body.organization || undefined, message } }) });
      const data = await response.json().catch(()=>({}));
      if (!response.ok) {const failure=new Error(typeof data.message==='string'?data.message:'This request could not be saved. Please try again.');failure.publicMessage=true;throw failure;}
      form.reset(); status.textContent = `Request received${data.id ? ` · ${data.id}` : ''}. Keep this page for your records.`;
    } catch(error) { status.textContent = error.publicMessage?error.message+' Your text remains here.':'This request could not be sent. Your text remains here; check your connection and try again.'; }
    finally { button.disabled = false; }
  }

  function ensureLanguageToggle() {
    [['.nav-actions','customer-language-toggle'],['#mobile-nav','customer-language-toggle customer-mobile-language']].forEach(([selector,className])=>{
      const target=document.querySelector(selector);if(!target)return;
      let button=target.querySelector('[data-language-toggle]');
      if(!button){button=document.createElement('button');button.type='button';button.className=className;button.dataset.languageToggle='';target.prepend(button);}
      button.textContent=TEXT[state.language].language;
      button.setAttribute('aria-label',state.language==='es'?'Switch essential visitor tools to English':'Show essential visitor tools in Spanish');
    });
  }

  function onPage(page, id, params) {
    applyFollowsToSaved();
    ensureLanguageToggle();
    document.documentElement.dataset.visitorLanguage = state.language;
    if (page === 'markets') {
      document.querySelector('#market-filter')?.insertAdjacentHTML('afterend', controls());
      const dateSelect = document.querySelector('#market-date');
      const specific = document.querySelector('.customer-date-field');
      if (dateSelect && specific) specific.hidden = dateSelect.value !== 'pick';
    }
    if (page === 'market') {
      const market = window.MARKETS?.find(item => item.id === id);
      if (market) {
        const preferredId=params?.get?.('occurrence')||'';
        const occurrence=occurrenceFor(market.id,preferredId);
        document.querySelector('.details-layout')?.insertAdjacentHTML('beforebegin', schedulePanel(market,preferredId));
        document.querySelector('.detail-content')?.insertAdjacentHTML('beforeend', essentials(market,preferredId));
        if(occurrence){
          const values=document.querySelectorAll('.detail-list dd');
          if(values[0]&&occurrence.date)values[0].textContent=new Intl.DateTimeFormat(state.language==='es'?'es-US':'en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${occurrence.date}T12:00:00Z`));
          if(values[1])values[1].textContent=`${timeLabel(occurrence.startsAt,occurrence.timeZone)}–${timeLabel(occurrence.endsAt,occurrence.timeZone)} · Central Time`;
          if(values[2])values[2].textContent=`${occurrence.venue} · ${occurrence.address}`;
          const directions=document.querySelector('.detail-content a[href*="google.com/maps/dir"]');
          if(directions)directions.href=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(occurrence.address)}`;
        }
        const sourceLink = [...document.querySelectorAll('.detail-panel a')].find(link => link.href.includes('sct=events'));
        if (sourceLink) { sourceLink.textContent = 'View organizer source ↗'; sourceLink.classList.remove('green'); sourceLink.classList.add('outline'); }
      }
    }
    if (page === 'saved') window.initDirectory?.('saved');
    if (page === 'home') {
      const strip = document.querySelector('.schedule-strip');
      if (state.occurrences.length && strip) {
        const originalSchedule = strip.nextElementSibling?.matches('section.section.wrap') ? strip.nextElementSibling : null;
        strip.insertAdjacentHTML('beforebegin', homeSchedule(window.MARKETS || []));
        strip.remove(); originalSchedule?.remove();
      } else if (strip) {
        strip.insertAdjacentHTML('afterend', `<div class="customer-home-status"><div class="wrap"><span>${state.publicError ? 'Manager status is temporarily unavailable; researched listings remain below.' : updatedLabel(state.scheduleUpdatedAt)}</span><a href="#markets">See market status ↗</a></div></div>`);
      }
    }
  }

  function directoryChanged(vendors) {
    const next = Array.isArray(vendors) ? vendors : [];
    const previousIds = state.workspaceVendors.map(item => item.id).sort().join('|');
    const nextIds = next.map(item => item.id).sort().join('|');
    state.workspaceVendors = next;
    if (location.hash.startsWith('#saved') && previousIds !== nextIds) window.FSMRender?.();
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const languageButton = event.target.closest('[data-language-toggle]');
      if (languageButton) { state.language = state.language === 'en' ? 'es' : 'en'; write(LOCAL_LANGUAGE, state.language); window.FSMRender?.(); ensureLanguageToggle();  return; }
      const view = event.target.closest('[data-market-view]');
      if (view) { state.view = view.dataset.marketView; window.FSMFilterMarkets?.(); return; }
      const follow = event.target.closest('[data-follow]');
      if (follow) { toggleFollow(follow.dataset.follow, follow); return; }
      const exportButton = event.target.closest('[data-export-saved]');
      if (exportButton) {
        const value = savedExport(window.FSMSaved?.get?.() || []);
        navigator.clipboard?.writeText(value).then(()=>{const s=document.querySelector('[data-saved-portability-status]');if(s)s.textContent='Export copied.';}).catch(()=>{const input=document.querySelector('#saved-import');if(input)input.value=value;});
        return;
      }
      const importButton = event.target.closest('[data-import-saved]');
      if (importButton) {
        const status=document.querySelector('[data-saved-portability-status]');
        try{const imported=parseSavedImport(document.querySelector('#saved-import')?.value);const merged=mergeSaved(window.FSMSaved.get(),imported);window.FSMSaved?.replace?.(merged);savedChanged(merged);if(status)status.textContent=`Imported ${imported.length} valid items.`;}catch{if(status)status.textContent='That saved-list export is not valid.';}
        return;
      }
      const clearButton = event.target.closest('[data-clear-saved]');
      if (clearButton && window.confirm('Clear saved favorites and synced follows for this account? Notification channel preferences are not deleted.')) { window.FSMSaved?.replace?.([]); savedChanged([]); return; }
    });
    document.addEventListener('change', event => {
      if (event.target.id === 'market-date') {
        const field = document.querySelector('.customer-date-field');
        if (field) field.hidden = event.target.value !== 'pick';
        window.FSMFilterMarkets?.();
      }
    });
    document.addEventListener('submit', event => {
      const finderForm = event.target.closest('[data-customer-finder]');
      if (finderForm && location.hash.startsWith('#home')) {
        event.preventDefault();
        const query = new URLSearchParams(new FormData(finderForm));
        location.hash = `markets?${query.toString()}`;
        return;
      }
      const form = event.target.closest('[data-contact-kind]');
      if (!form) return;
      event.preventDefault(); submitContact(form);
    });
  }

  bindEvents();
  window.FSMCustomer = {
    state, finder, filterMarkets, homeSchedule, statusNote, cardMarket, savedPage, helpPage, onPage, directoryChanged,
    saveButton: (type, id, name) => window.FSMSaveButton?.(type, id, name) || '',
    saveChanged: savedChanged,
    schedulePanel, occurrenceFor, loadPublicState,
    _test: {
      normalizedPlace, milesBetween, weekendDates, occurrenceStatus, marketWithDistance, selectMarketItems,
      sanitizeSaved, mergeSaved, removeSaved, parseSavedImport, savedExport, authChanged,
      cardMarket, timeLabel, scheduleSummary, scheduleCachePayload, readScheduleCache, setScheduleMetadata,
      loadCustomerPreferences, saveFollows, cloudFollow, localFollow
    }
  };
  loadPublicState();
  if (window.FSMAuth?.onChange) window.FSMAuth.onChange(authChanged);
  else loadCustomerPreferences();
})();
