(function initMobileInstallBanner() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var RUNTIME = window.__appRuntimeConfig || {};
  var playUrl = RUNTIME.androidPlayStoreUrl || 'https://play.google.com/store/apps/details?id=com.expenselyt.app';
  var iosUrl = RUNTIME.iosAppStoreUrl || 'https://apps.apple.com/us/app/expenselyt/id6761451207';

  var style = document.createElement('style');
  style.textContent = [
    ':root{--install-banner-h:56px;}',
    '.mobile-install-banner{display:none;}',
    '@media (max-width:900px){',
    '.mobile-install-banner{position:fixed;top:0;left:0;right:0;z-index:9999;height:var(--install-banner-h);display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0f172a;border-bottom:1px solid rgba(255,255,255,.12);box-shadow:0 8px 20px rgba(0,0,0,.22);}',
    '.mobile-install-banner .mib-title{color:#fff;font-size:11px;font-weight:700;letter-spacing:.02em;white-space:nowrap;}',
    '.mobile-install-banner .mib-links{display:flex;gap:8px;overflow-x:auto;flex:1;}',
    '.mobile-install-banner .mib-link{display:inline-flex;align-items:center;gap:6px;background:#111827;color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:7px 10px;font-size:12px;font-weight:700;white-space:nowrap;}',
    '.mobile-install-banner .mib-link .mib-icon{font-size:14px;line-height:1;}',
    '.mobile-install-banner .mib-close{border:0;background:transparent;color:#cbd5e1;font-size:18px;line-height:1;cursor:pointer;padding:4px;}',
    'body.has-mobile-install-banner{padding-top:var(--install-banner-h) !important;}',
    'body.has-mobile-install-banner nav{top:var(--install-banner-h) !important;}',
    'body.has-mobile-install-banner .app-mobile-topbar{top:var(--install-banner-h) !important;}',
    '}'
  ].join('');
  document.head.appendChild(style);

  if (window.matchMedia && !window.matchMedia('(max-width:900px)').matches) return;
  if (sessionStorage.getItem('hide_mobile_install_banner') === '1') return;
  if (document.querySelector('.mobile-install-banner')) return;

  var banner = document.createElement('div');
  banner.className = 'mobile-install-banner';
  banner.innerHTML =
    '<span class="mib-title">Download app</span>' +
    '<div class="mib-links">' +
      '<a class="mib-link" href="' + playUrl + '" target="_blank" rel="noopener">' +
        '<span class="mib-icon" aria-hidden="true">&#129302;</span><span>Android</span>' +
      '</a>' +
      '<a class="mib-link" href="' + iosUrl + '" target="_blank" rel="noopener">' +
        '<span class="mib-icon" aria-hidden="true">&#127822;</span><span>iPhone</span>' +
      '</a>' +
    '</div>' +
    '<button type="button" class="mib-close" aria-label="Close">&times;</button>';

  banner.querySelector('.mib-close').addEventListener('click', function () {
    sessionStorage.setItem('hide_mobile_install_banner', '1');
    document.body.classList.remove('has-mobile-install-banner');
    banner.remove();
  });

  document.body.classList.add('has-mobile-install-banner');
  document.body.insertBefore(banner, document.body.firstChild);
})();
