(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.liveSplitBulkEdit = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function apply(row, values, selected) {
    const next = { ...row };
    if (selected.divide_date) next.divide_date = values.divide_date;
    if (selected.details) next.details = String(values.details || '').trim();
    if (selected.paid_by) next.paid_by = String(values.paid_by || 'You').trim() || 'You';
    if (selected.finance) {
      const mode = values.finance_target || 'none';
      next.finance_target = mode;
      next.bank_account_id = mode === 'expense' ? Number(values.bank_account_id || 0) || null : null;
      next.card_id = mode === 'card' ? Number(values.card_id || 0) || null : null;
      next.card_discount_pct = mode === 'card' ? Number(values.card_discount_pct || 0) : 0;
    }
    // A source owned by this account cannot be charged when another member pays.
    if ((selected.paid_by || selected.finance) && String(next.paid_by || '').trim().toLowerCase() !== 'you') {
      next.finance_target = 'none';
      next.bank_account_id = null;
      next.card_id = null;
      next.card_discount_pct = 0;
    }
    return next;
  }
  return { apply };
});
