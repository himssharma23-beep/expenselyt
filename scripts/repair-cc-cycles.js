const fs = require('fs');

try {
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && !key.startsWith('#') && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  });
} catch (_) {}

const billingDb = require('../db/postgres-billing');

async function main() {
  const args = process.argv.slice(2);
  const userId = Number(args[0] || 0);
  const cardId = args[1] != null ? Number(args[1]) : null;

  if (!(userId > 0)) {
    console.error('Usage: node scripts/repair-cc-cycles.js <userId> [cardId]');
    process.exit(1);
  }

  const summary = await billingDb.repairCreditCardTxnCycles(userId, cardId > 0 ? cardId : null);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('Credit card cycle repair failed:', err?.stack || err?.message || err);
  process.exit(1);
});
