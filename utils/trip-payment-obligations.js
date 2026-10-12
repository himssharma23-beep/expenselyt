// Net opposing debts per pair; use integer paise to avoid rounding drift.
function buildTripPaymentObligations(edges = []) {
  const pairs = new Map();
  for (const { from, to, amount } of edges) {
    if (!from?.key || !to?.key || from.key === to.key) continue;
    const paise = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) continue;
    const forward = from.key < to.key;
    const first = forward ? from : to;
    const second = forward ? to : from;
    const key = JSON.stringify([first.key, second.key]);
    const pair = pairs.get(key) || { first, second, paise: 0 };
    pair.paise += forward ? paise : -paise;
    pairs.set(key, pair);
  }
  return [...pairs.values()].filter(pair => pair.paise !== 0).map(pair => {
    const from = pair.paise > 0 ? pair.first : pair.second;
    const to = pair.paise > 0 ? pair.second : pair.first;
    return { from_key: from.key, from_name: from.name, to_key: to.key,
      to_name: to.name, amount: Math.abs(pair.paise) / 100 };
  }).sort((a, b) => b.amount - a.amount || a.from_key.localeCompare(b.from_key));
}

module.exports = { buildTripPaymentObligations };
