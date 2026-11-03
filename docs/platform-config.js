// One public website, with authenticated storage supplied by the API service.
window.FSM_CANONICAL_URL = 'https://cmcnosky.github.io/four-seasons-markets-preview/';
window.FSM_API_ORIGIN = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? '' : 'https://four-seasons-vendor-hub.cmcnosky.chatgpt.site';
window.FSM_DIRECTORY_URL = window.FSM_API_ORIGIN + '/api/directory';
if (location.origin === 'https://four-seasons-vendor-hub.cmcnosky.chatgpt.site') {
  location.replace(window.FSM_CANONICAL_URL + location.search + location.hash);
}
