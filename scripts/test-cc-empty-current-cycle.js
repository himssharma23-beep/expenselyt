const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ existingCycle = null, missingCard = false } = {}) {
  const card = { id: 7, user_id: 9, bill_gen_day: 18, due_days: 20, bank_name: 'BOB', card_name: 'Scapia' };
  let cycle = existingCycle;
  let inserts = 0;
  const query = async (sql, args = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('ALTER TABLE') || normalized.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (normalized.startsWith('SELECT id, net_payable')) return { rows: [] };
    if (normalized.startsWith('SELECT * FROM credit_cards')) {
      assert.deepEqual(Array.from(args), [7, 9]);
      return { rows: missingCard ? [] : [card] };
    }
    if (normalized.startsWith('SELECT * FROM cc_cycles WHERE card_id')) {
      assert.equal(args[0], 7);
      assert.equal(args[1], 9);
      return { rows: cycle ? [cycle] : [] };
    }
    if (normalized.startsWith('INSERT INTO cc_cycles')) {
      inserts++;
      cycle = { id: 42, user_id: args[0], card_id: args[1], cycle_start: args[2], cycle_end: args[3], due_date: args[4], status: args[5], total_amount: 0, total_discount: 0, net_payable: 0 };
      return { rows: [cycle] };
    }
    if (normalized.startsWith('SELECT manual_total_override')) return { rows: [cycle] };
    if (normalized.startsWith('SELECT COUNT(*)')) return { rows: [{ total_amount: 0, total_discount: 0, net_payable: 0 }] };
    if (normalized.startsWith('UPDATE cc_cycles SET total_amount')) return { rows: [] };
    if (normalized.startsWith('SELECT * FROM cc_cycles WHERE id')) return { rows: [cycle] };
    if (normalized.startsWith('SELECT * FROM cc_txns')) return { rows: [] };
    throw new Error(`Unexpected query: ${normalized}`);
  };
  const context = vm.createContext({
    module: { exports: {} },
    require: name => {
      assert.equal(name, './postgres');
      return { query, withTransaction: fn => fn({ query }) };
    },
  });
  vm.runInContext(`Date = class extends Date { constructor(...args) { super(...(args.length ? args : [2026, 9, 16, 12])); } };`, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../db/postgres-billing.js'), 'utf8'), context);
  return { load: () => context.module.exports.getCcCurrentCycle(9, 7), inserts: () => inserts };
}

test('an empty card gets a real current cycle with zero totals and working toolbar targets', async () => {
  const db = fixture();
  const result = await db.load();
  assert.equal(result.cycle.id, 42);
  assert.equal(result.cycle.cycle_start, '2026-09-19');
  assert.equal(result.cycle.cycle_end, '2026-10-18');
  assert.equal(result.cycle.due_date, '2026-11-07');
  assert.equal(result.cycle.total_amount, 0);
  assert.equal(result.cycle.total_discount, 0);
  assert.equal(result.cycle.net_payable, 0);
  assert.equal(result.txns.length, 0);
  assert.equal((await db.load()).cycle.id, 42);
  assert.equal(db.inserts(), 1);

  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const start = source.indexOf('function renderCcCurrentCycle(');
  const end = source.indexOf('function renderCcHistory(', start);
  const context = vm.createContext({ fmtDate: value => value, fmtCur: value => `INR ${value}`, escHtml: value => value });
  vm.runInContext(source.slice(start, end), context);
  const html = context.renderCcCurrentCycle(result.card, result.cycle, result.txns);
  for (const label of ['Cycle Period', 'Payment Due', 'Total Spent', 'Total Discount', 'Payable', 'Repair Cycles', 'PDF', '+ Add Transaction', 'Import Excel', 'Close Cycle / Mark Paid']) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(html.includes("showCcExcelImportModal(42, '2026-09-19', '2026-10-18', 0)"));
  assert.ok(html.includes('No transactions this cycle.'));
  assert.ok(!html.includes('undefined'));
});

test('an existing paid cycle remains intact without creating another cycle', async () => {
  const cycle = { id: 50, cycle_start: '2026-09-19', cycle_end: '2026-10-18', status: 'paid', total_amount: 250, net_payable: 250 };
  const db = fixture({ existingCycle: cycle });
  const result = await db.load();
  assert.equal(result.cycle.id, 50);
  assert.equal(result.cycle.status, 'paid');
  assert.equal(result.cycle.net_payable, 250);
  assert.equal(db.inserts(), 0);
});

test('a missing or inaccessible card does not create a cycle', async () => {
  const db = fixture({ missingCard: true });
  assert.equal(await db.load(), null);
  assert.equal(db.inserts(), 0);
});
