function paymentManagerShareNumber(value, mode) {
  const text = String(value ?? '').trim();
  if (mode === 'fraction' && text.includes('/')) {
    const parts = text.split('/');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim() || !Number.isFinite(Number(parts[0])) || !Number.isFinite(Number(parts[1])) || !(Number(parts[1]) > 0)) return NaN;
    return Number(parts[0]) / Number(parts[1]);
  }
  return Number(text);
}

// All money arithmetic uses paise; collections and reimbursements stay separate.
function buildPaymentManagerPlan(people, managerKey, mode = 'equal') {
  if (!Array.isArray(people) || people.length < 2 || people.length > 50) throw new Error('Select between 2 and 50 people');
  const keys = new Set();
  const rows = people.map(person => {
    const key = String(person.key);
    if (keys.has(key)) throw new Error('Each person can only be selected once');
    keys.add(key);
    const amount = Number(person.paid ?? 0);
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents) || cents > 100000000000 || Math.abs(amount * 100 - cents) > 0.00001) throw new Error('Enter valid amounts with up to two decimal places');
    return { ...person, key, paid: cents / 100, cents };
  });
  const manager = rows.find(person => person.key === String(managerKey));
  if (!manager) throw new Error('Choose a payment manager from the selected people');
  const total = rows.reduce((sum, row) => sum + row.cents, 0);
  if (!total) throw new Error('Enter an amount paid by at least one person');
  if (!['equal', 'percent', 'fraction', 'amount', 'parts'].includes(mode)) throw new Error('Choose a valid share type');
  const weights = rows.map(person => {
    if (mode === 'equal') return 1;
    if (person.share_value === undefined || person.share_value === null || String(person.share_value).trim() === '') throw new Error('Enter a share value for every selected person (use 0 for no share)');
    const value = paymentManagerShareNumber(person.share_value, mode);
    if (!Number.isFinite(value) || value < 0 || value > 1000000000) throw new Error('Share values must be valid non-negative numbers');
    if (mode === 'amount' && Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('Direct shares allow up to two decimal places');
    return mode === 'amount' ? Math.round(value * 100) : value;
  });
  const sum = weights.reduce((acc, value) => acc + value, 0);
  if (mode === 'fraction' && Math.abs(sum - 1) > 0.000001) throw new Error('Fractions must total 1');
  if (mode === 'percent' && Math.abs(sum - 100) > 0.000001) throw new Error('Percentages must total 100%');
  if (mode === 'amount' && sum !== total) throw new Error('Direct shares must equal the total paid');
  if (!(sum > 0)) throw new Error('Enter at least one positive share');
  const exact = weights.map(weight => mode === 'amount' ? weight : total * weight / sum);
  const cents = exact.map(value => Math.floor(value));
  let remainder = total - cents.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - cents[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) cents[order[i].index] += 1;
  if (cents.some(value => !Number.isSafeInteger(value) || value < 0) || cents.reduce((sum, value) => sum + value, 0) !== total) throw new Error('Allocated shares must equal the total paid');
  const entries = [];
  rows.forEach((person, index) => {
    person.share = cents[index] / 100;
    delete person.cents;
    if (person.key === manager.key) return;
    if (person.share > 0) entries.push({ from: person.key, to: manager.key, amount: person.share, kind: 'collection' });
    if (person.paid > 0) entries.push({ from: manager.key, to: person.key, amount: person.paid, kind: 'reimbursement' });
  });
  return { split_mode: mode, total: total / 100, manager_key: manager.key, people: rows, entries };
}
module.exports = { buildPaymentManagerPlan };
