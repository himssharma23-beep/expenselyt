const pgAuth = require('../db/postgres-auth');
const pgCore = require('../db/postgres-core');

async function getLiveSplitBalanceSummaryForUser(userId) {
  const [user, friends, groups, sharedGroups] = await Promise.all([
    pgAuth.findUserById(userId),
    pgCore.getLiveSplitFriends(userId),
    pgCore.getLiveSplitGroups(userId),
    pgCore.getReceivedLiveSplitShares(userId),
  ]);
  const summary = pgCore.computeLiveSplitDashboardSummary(
    userId,
    Array.isArray(friends) ? friends : [],
    Array.isArray(groups) ? groups : [],
    Array.isArray(sharedGroups) ? sharedGroups : []
  );
  return {
    user,
    rows: Array.isArray(summary?.rows) ? summary.rows : [],
    totals: {
      oweToMe: Number(summary?.totals?.oweToMe || 0),
      iOwe: Number(summary?.totals?.iOwe || 0),
      owedCount: Number(summary?.totals?.owedCount || 0),
      oweCount: Number(summary?.totals?.oweCount || 0),
    },
  };
}

module.exports = {
  getLiveSplitBalanceSummaryForUser,
};
