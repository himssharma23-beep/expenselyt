(function () {
  const cfg = window.__appRuntimeConfig || {};
  const measurementId = String(cfg.gaMeasurementId || '').trim();

  window.analyticsTrack = function analyticsTrack(eventName, params) {
    if (!measurementId || typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, params || {});
  };

  window.analyticsTrackScreen = function analyticsTrackScreen(screenName, extra) {
    if (!measurementId || typeof window.gtag !== 'function' || !screenName) return;
    window.gtag('event', 'screen_view', {
      app_name: 'Expense Lite AI Web',
      screen_name: screenName,
      ...extra,
    });
  };

  if (!measurementId) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    send_page_view: true,
    anonymize_ip: true,
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
})();
