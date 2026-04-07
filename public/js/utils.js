// ═══════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CURRENCY_LOCALE_MAP = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  AED: 'en-AE',
  CAD: 'en-CA',
  AUD: 'en-AU',
  SGD: 'en-SG',
  JPY: 'ja-JP',
  CNY: 'zh-CN',
};
const REGION_CURRENCY_MAP = {
  IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', AU: 'AUD', CA: 'CAD', SG: 'SGD',
  JP: 'JPY', CN: 'CNY', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR',
};
window.__currencyPrefs = { currencyCode: 'INR', localeCode: 'en-IN' };
const MOJIBAKE_REPLACEMENTS = [
  ['Ã¢Å½â„¢', ''],
  ['âŽ™', ''],
  ['Ã¢â‚¬Âº', '>'],
  ['â€º', '>'],
  ['Ã¢â‚¬Â¦', '...'],
  ['Ã¢â‚¬Â¢', ' · '],
  ['Ã¢â‚¬â€', '-'],
  ['Ã¢â‚¬Â¢Ã¢â‚¬Â¢', '**'],
  ['Ã¢â‚¬â€', '-'],
  ['â‚¬â€', '-'],
  ['â€”', '-'],
  ['â€“', '-'],
  ['Ã‚Â·', ' · '],
  ['Â·', ' · '],
  ['â€¢', ' · '],
  ['â€¦', '...'],
  ['â†', '<-'],
  ['â†’', '->'],
  ['â†“', ''],
  ['Ã¢â€ â€œ', ''],
  ['Ã¢â€žÂ¹', 'Rs'],
  ['â‚¹', 'Rs'],
  ['Â ', ' '],
  ['Â', ''],
  ['âœ“', 'OK'],
  ['âœ•', 'x'],
  ['âš ', '!'],
  ['â„¹', 'i'],
];

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function repairMojibakeText(value) {
  let text = String(value ?? '');
  for (const [from, to] of MOJIBAKE_REPLACEMENTS) text = text.split(from).join(to);
  // Direct fallbacks for common mojibake that still appears in UI labels/buttons.
  text = text
    .replace(/Â·/g, ' · ')
    .replace(/â†’/g, '->')
    .replace(/â†/g, '<-')
    .replace(/â€¦/g, '...')
    .replace(/â€”/g, '-')
    .replace(/ï¿½/g, '-')
    .replace(/Ã¢â‚¬Â¢Ã¢â‚¬Â¢/g, '••');
  // Additional fallback fixes for patterns that frequently survive replacement tables.
  text = text
    .replace(/\u00c2\u00b7/g, ' \u00b7 ')
    .replace(/\u00e2\u2020\u2018/g, '\u2191')
    .replace(/\u00e2\u2020\u201c/g, '\u2193')
    .replace(/\u00e2\u2020\u2019/g, '\u2192')
    .replace(/\u00e2\u2020\u0090/g, '\u2190')
    .replace(/\u00e2\u20ac\u201d/g, '-')
    .replace(/\u00e2\u20ac\u201c/g, '-')
    .replace(/\u00e2\u20ac\u00a2/g, ' \u00b7 ')
    .replace(/\u00e2\u20ac\u00a6/g, '...')
    .replace(/\u00e2\u0153\u201c/g, 'OK')
    .replace(/\u00e2\u0153\u2022/g, 'x')
    .replace(/\u00e2\u0161\u00a0/g, '!')
    .replace(/\u00e2\u02c6\u017e/g, 'infinity')
    .replace(/\u00c3\u00b0\u00c5\u00b8\u00e2\u20ac\u009d\u00e2\u20ac\u201d/g, 'Share')
    .replace(/\u00c3\u00b0\u00c5\u00b8\u00e2\u20ac\u2122\u00c2\u00b3/g, 'Card')
    .replace(/\u00c3\u00b0\u00c5\u00b8\u00e2\u20ac\u0153\u00e2\u20ac\u00b9/g, 'Tracker');
  return text.replace(/\s{2,}/g, ' ');
}

function repairMojibakeInNode(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const fixed = repairMojibakeText(root.nodeValue);
    if (fixed !== root.nodeValue) root.nodeValue = fixed;
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  ['placeholder', 'title', 'aria-label'].forEach((attr) => {
    const current = root.getAttribute(attr);
    if (!current) return;
    const fixed = repairMojibakeText(current);
    if (fixed !== current) root.setAttribute(attr, fixed);
  });

  if (root instanceof HTMLInputElement) {
    const type = (root.type || '').toLowerCase();
    if (['button', 'submit', 'reset'].includes(type)) {
      const fixed = repairMojibakeText(root.value);
      if (fixed !== root.value) root.value = fixed;
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current;
  while ((current = walker.nextNode())) {
    const fixed = repairMojibakeText(current.nodeValue);
    if (fixed !== current.nodeValue) current.nodeValue = fixed;
  }
}

function startMojibakeRepairObserver() {
  const activate = () => {
    repairMojibakeInNode(document.body);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => repairMojibakeInNode(node));
        if (mutation.type === 'characterData' && mutation.target) repairMojibakeInNode(mutation.target);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.body) activate();
  else document.addEventListener('DOMContentLoaded', activate, { once: true });
}

function getYears() {
  const y = new Date().getFullYear();
  return Array.from({length: y - 2016}, (_, i) => y + 1 - i);
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

function normalizeLocaleCode(locale, currencyCode = 'INR') {
  const cleaned = String(locale || '').trim().replace(/_/g, '-');
  if (/^[a-z]{2,3}(?:-[A-Z]{2})?$/i.test(cleaned)) return cleaned;
  return CURRENCY_LOCALE_MAP[currencyCode] || 'en-US';
}

function normalizeCurrencyCode(code) {
  const cleaned = String(code || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : null;
}

const TIMEZONE_REGION_MAP = {
  'asia/kolkata': 'IN',
  'asia/calcutta': 'IN',
  'asia/dubai': 'AE',
  'asia/singapore': 'SG',
  'asia/tokyo': 'JP',
  'asia/shanghai': 'CN',
  'asia/hong_kong': 'CN',
  'europe/london': 'GB',
  'europe/dublin': 'IE',
  'europe/berlin': 'DE',
  'europe/paris': 'FR',
  'europe/madrid': 'ES',
  'europe/rome': 'IT',
  'europe/amsterdam': 'NL',
  'america/new_york': 'US',
  'america/chicago': 'US',
  'america/denver': 'US',
  'america/los_angeles': 'US',
  'america/phoenix': 'US',
  'america/toronto': 'CA',
  'america/vancouver': 'CA',
  'australia/sydney': 'AU',
  'australia/melbourne': 'AU',
  'australia/perth': 'AU',
};

function inferRegionFromTimeZone(timeZone) {
  const normalized = String(timeZone || '').trim().toLowerCase();
  if (!normalized) return '';
  return TIMEZONE_REGION_MAP[normalized] || '';
}

function deriveCurrencyPrefs(locale, timeZone) {
  const localeCode = normalizeLocaleCode(locale, 'USD');
  const region = localeCode.includes('-') ? localeCode.split('-')[1].toUpperCase() : '';
  const zoneRegion = inferRegionFromTimeZone(timeZone);
  let currencyCode = REGION_CURRENCY_MAP[region] || REGION_CURRENCY_MAP[zoneRegion] || null;
  if (!currencyCode && /kolkata|calcutta|india/i.test(String(timeZone || ''))) currencyCode = 'INR';
  currencyCode = currencyCode || 'USD';
  return {
    currencyCode,
    localeCode: CURRENCY_LOCALE_MAP[currencyCode] || localeCode,
    timeZone: String(timeZone || '').trim() || null,
  };
}

function detectCurrencyPrefs() {
  try {
    const options = Intl.DateTimeFormat().resolvedOptions();
    return deriveCurrencyPrefs(navigator.language || options.locale, options.timeZone);
  } catch (_err) {
    return { currencyCode: 'INR', localeCode: 'en-IN', timeZone: null };
  }
}

function setCurrencyPrefs(source) {
  const fallback = detectCurrencyPrefs();
  const currencyCode = normalizeCurrencyCode(source?.currency_code || source?.currencyCode) || fallback.currencyCode;
  const localeCode = normalizeLocaleCode(source?.locale_code || source?.localeCode, currencyCode);
  window.__currencyPrefs = { currencyCode, localeCode };
  return window.__currencyPrefs;
}

function getCurrencyPrefsForCode(currencyCode, localeCode) {
  const safeCurrency = normalizeCurrencyCode(currencyCode) || detectCurrencyPrefs().currencyCode;
  return {
    currency_code: safeCurrency,
    locale_code: normalizeLocaleCode(localeCode, safeCurrency),
    time_zone: detectCurrencyPrefs().timeZone,
  };
}

// Consistent member key for trip members:
// friend member → String(friend_id), app-user member → 'u'+linked_user_id, owner → 'self'
function _memberKey(m) {
  if (m.friend_id != null) return String(m.friend_id);
  if (m.linked_user_id != null) return 'u' + m.linked_user_id;
  return 'self';
}

function fmtDate(d) {
  if (!d) return "";
  const raw = String(d).trim();
  let dt;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    dt = new Date(raw);
  }
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString(window.__currencyPrefs.localeCode || "en-IN", { day:"2-digit", month:"short", year:"numeric" });
}

function fmtCur(n) {
  const value = Number(n || 0);
  const { currencyCode, localeCode } = window.__currencyPrefs || { currencyCode: 'INR', localeCode: 'en-IN' };
  try {
    return new Intl.NumberFormat(localeCode || 'en-IN', {
      style: 'currency',
      currency: currencyCode || 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (_err) {
    return `${value < 0 ? "- " : ""}${currencyCode || 'INR'} ${Math.abs(value).toFixed(2)}`;
  }
  const neg = n < 0, abs = Math.abs(n);
  const [int, dec] = abs.toFixed(2).split(".");
  let f;
  if (int.length <= 3) f = int;
  else {
    const l3 = int.slice(-3), rest = int.slice(0, -3), g = [];
    for (let i = rest.length; i > 0; i -= 2) g.unshift(rest.slice(Math.max(0, i-2), i));
    f = g.join(",") + "," + l3;
  }
  return `${neg ? "- " : ""}₹ ${f}.${dec}`;
}

function amountWords(n) {
  const { currencyCode } = window.__currencyPrefs || { currencyCode: 'INR' };
  if (currencyCode !== 'INR') return `${fmtCur(n)} total`;
  const ones=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const tw=(n)=>n<20?ones[n]:tens[Math.floor(n/10)]+(n%10?"-"+ones[n%10]:"");
  const th=(n)=>n>=100?ones[Math.floor(n/100)]+" Hundred"+(n%100?" "+tw(n%100):""):tw(n);
  const [ip,dp]=Math.abs(n).toFixed(2).split(".");
  const num=parseInt(ip), p=parseInt(dp);
  if(num===0&&p===0) return "Zero Rupees";
  let w="";
  const cr=Math.floor(num/10000000), lk=Math.floor((num%10000000)/100000), tk=Math.floor((num%100000)/1000), r=num%1000;
  if(cr) w+=th(cr)+" Crore "; if(lk) w+=tw(lk)+" Lakh "; if(tk) w+=tw(tk)+" Thousand "; if(r) w+=th(r);
  w=w.trim()+" Rupees"; if(p>0) w+=" and "+tw(p)+" Paise"; return w+" Only";
}

function balColor(n) { return n < 0 ? 'var(--red)' : n > 0 ? 'var(--green)' : 'var(--t3)'; }
function balColorLight(n) { return n < 0 ? '#FF8A8A' : n > 0 ? '#7EEAB0' : '#fff'; }

// ─── API Helper ──────────────────────────────────────────────
async function api(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    return await res.json();
  } catch (err) {
    console.error('[api] Error calling', url, err);
    return null;
  }
}

// ─── Toast Notifications ─────────────────────────────────────
function toast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-msg">${message}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(t);

  // Trigger animation
  requestAnimationFrame(() => t.classList.add('toast-show'));

  // Auto remove
  setTimeout(() => {
    t.classList.remove('toast-show');
    t.addEventListener('transitionend', () => t.remove(), { once: true });
  }, duration);
}

// Confirm dialog replacement — centered overlay, returns a Promise
function confirmDialog(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon">⚠</div>
        <div class="confirm-msg">${message}</div>
        <div class="confirm-actions">
          <button class="confirm-btn-yes">Yes, proceed</button>
          <button class="confirm-btn-no">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('confirm-show'));

    const close = (result) => {
      overlay.classList.remove('confirm-show');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
      resolve(result);
    };
    overlay.querySelector('.confirm-btn-yes').onclick = () => close(true);
    overlay.querySelector('.confirm-btn-no').onclick  = () => close(false);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  });
}

// ─── Modal Helper ────────────────────────────────────────────
function openModal(title, bodyHTML) {
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-head"><h3>${title}</h3><button onclick="closeModal()">✕</button></div>
    <div class="modal-body">${bodyHTML}</div>`;
  document.getElementById('modalOverlay').style.display = 'flex';
  repairMojibakeInNode(document.getElementById('modalContent'));
}

function bindModalSubmit(handler) {
  const body = document.querySelector('#modalContent .modal-body');
  if (!body || typeof handler !== 'function') return;
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const tag = (event.target?.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
    event.preventDefault();
    handler();
  });
}

// showModal: places raw HTML inside a padded modal wrapper
function showModal(html) {
  document.getElementById('modalContent').innerHTML = '<div class="modal-inner">' + html + '</div>';
  document.getElementById('modalOverlay').style.display = 'flex';
  repairMojibakeInNode(document.getElementById('modalContent'));
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalOverlay').style.display = 'none';
}

setCurrencyPrefs(window.__currencyPrefs);
startMojibakeRepairObserver();
