// Use saved currency amounts, never today's exchange rate, when displaying a row.
function tripExpenseMoney(expense, baseCurrency = 'INR', locale = 'en-IN') {
  const code = String(expense.original_currency_code || '').trim().toUpperCase();
  const hasOriginal = /^[A-Z]{3}$/.test(code) && expense.original_amount != null
    && expense.original_amount !== '' && Number.isFinite(Number(expense.original_amount));
  const currency = hasOriginal ? code : baseCurrency;
  const baseAmount = Number(expense.amount) || 0;
  const originalAmount = hasOriginal ? Number(expense.original_amount) : baseAmount;
  const foreign = hasOriginal && code !== baseCurrency;
  function format(value, currencyCode = currency) {
    try {
      return new Intl.NumberFormat(locale || 'en-IN', { style: 'currency', currency: currencyCode,
        minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    } catch (_) { return `${currencyCode} ${Number(value).toFixed(2)}`; }
  }
  return {
    currency, total: format(originalAmount),
    price: expense.unit_price != null ? format(Number(expense.unit_price) || 0) : null,
    converted: foreign ? format(baseAmount, baseCurrency) : null,
    share: value => format(hasOriginal && baseAmount !== 0 ? Number(value) * originalAmount / baseAmount : Number(value)),
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { tripExpenseMoney };
