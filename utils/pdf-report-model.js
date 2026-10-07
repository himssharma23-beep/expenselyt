// Adapts the original web report definitions to the shared HTML/PDF renderer.
function createPdfReportModel(currency = 'INR') {
  const model = { payload: null };
  let section = '', note = '';
  const cur = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(value) || 0);
  const dt = value => {
    const date = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '-';
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const table = (doc, y, headers, rows, styles = {}) => {
    const headerRows = headers.map(row => row.map(cell => typeof cell === 'object' ? cell : { content: String(cell ?? '') }));
    model.payload.tables.push({ title: section, subtitle: note, headerRows,
      columns: headerRows[0].map(cell => cell.content),
      rows: rows.map(row => row.map(cell => cell && typeof cell === 'object' ? cell.content : String(cell ?? ''))),
      boldColumnIndices: Object.keys(styles).filter(key => styles[key].fontStyle === 'bold').map(Number),
      columnAlignments: Object.fromEntries(Object.entries(styles).filter(([, style]) => style.halign).map(([key, style]) => [key, style.halign])),
    });
    section = ''; note = '';
    return y + 10;
  };
  model.P = {
    cur, dt, MONTHS: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    init(landscape = false) {
      model.payload = { landscape, tables: [], sections: [] };
      return {
        internal: { pageSize: { getWidth: () => landscape ? 297 : 210 } },
        setFontSize() {}, setFont() {}, setTextColor() {},
        text(value) { note = Array.isArray(value) ? value.join(' ') : value; },
        autoTable(options) { table(this, 0, options.head, options.body, options.columnStyles); },
      };
    },
    header(doc, title, subtitle) { Object.assign(model.payload, { title, subtitle }); return 0; },
    cards(doc, y, cards) { model.payload.totals = { cards }; return y; },
    section(doc, y, title) { section = title; return y; },
    note(doc, y, value) { note = [note, value].filter(Boolean).join(' · '); return y; },
    table, save() {},
  };
  return model;
}
module.exports = { createPdfReportModel };
