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

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

function deriveCurrencyPrefs(locale, timeZone) {
  const localeCode = normalizeLocaleCode(locale, 'USD');
  const region = localeCode.includes('-') ? localeCode.split('-')[1].toUpperCase() : '';
  let currencyCode = REGION_CURRENCY_MAP[region] || null;
  if (!currencyCode && /kolkata|calcutta|india/i.test(String(timeZone || ''))) currencyCode = 'INR';
  currencyCode = currencyCode || 'USD';
  return { currencyCode, localeCode: CURRENCY_LOCALE_MAP[currencyCode] || localeCode };
}

function detectCurrencyPrefs() {
  try {
    const options = Intl.DateTimeFormat().resolvedOptions();
    return deriveCurrencyPrefs(navigator.language || options.locale, options.timeZone);
  } catch (_err) {
    return { currencyCode: 'INR', localeCode: 'en-IN' };
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
  const dt = new Date(d);
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
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalOverlay').style.display = 'none';
}

setCurrencyPrefs(window.__currencyPrefs);
