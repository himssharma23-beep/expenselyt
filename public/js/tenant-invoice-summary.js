(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.tenantInvoiceSummary = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function amount(value) {
    return String(Math.round((Number(value) || 0) * 100) / 100);
  }

  function build(invoices, month) {
    const rows = (Array.isArray(invoices) ? invoices : [])
      .filter(row => String(row.invoice_month || '') === month)
      .slice().sort((a, b) => String(a.tenant_name_snapshot || '').localeCompare(String(b.tenant_name_snapshot || '')));
    const tenants = rows.map(row => {
      const name = String(row.tenant_name_snapshot || 'Tenant').trim();
      const lines = [name, `Rent - ${amount(row.rent_amount_snapshot)}`, `Garbage - ${amount(row.cleaning_charge_snapshot)}`, `Water - ${amount(row.water_charge_snapshot)}`];
      if (Number(row.sewerage_charge_snapshot)) lines.push(`Sewerage - ${amount(row.sewerage_charge_snapshot)}`);
      const extras = Array.isArray(row.other_charge_items) ? row.other_charge_items : [];
      extras.forEach(item => lines.push(`${String(item.detail || 'Other charges').trim()} - ${amount(item.amount)}`));
      const itemSum = extras.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      const remainder = Math.round(((Number(row.other_charges_snapshot) || 0) - itemSum) * 100) / 100;
      if (remainder) lines.push(`Other charges - ${amount(remainder)}`);
      const extra = Number(row.extra_electricity_units) || 0;
      const adjustment = extra ? ` (${extra > 0 ? '+' : ''}${amount(extra)})` : '';
      lines.push(`Electricity - ${amount(row.current_electricity_units)} - ${amount(row.previous_electricity_units)}${adjustment} = ${amount(row.electricity_units_used)} => ${amount(row.electricity_amount)}`);
      lines.push(`Total - ${amount(row.total_amount)}`);
      return { id: row.id, name, total: Number(row.total_amount) || 0, text: lines.join('\n') };
    });
    const total = Math.round(tenants.reduce((sum, tenant) => sum + tenant.total, 0) * 100) / 100;
    const totalsText = tenants.length ? `${tenants.map(tenant => `${tenant.name} - ${amount(tenant.total)}`).join(', ')}\nTotal - ${amount(total)}` : '';
    return { tenants, total, totalsText, text: [...tenants.map(tenant => tenant.text), totalsText].filter(Boolean).join('\n\n') };
  }
  return { build };
});
