// Runtime API base for static hosting.
// On Netlify, call the function directly to avoid redirect quirks.
(function(){
  try {
    const host = (window.location && window.location.hostname) || '';
    if (host.endsWith('netlify.app')) {
      window.API_BASE = '/.netlify/functions/api';
      return;
    }
  } catch(_) {}
  window.API_BASE = window.API_BASE || '/api';
})();


