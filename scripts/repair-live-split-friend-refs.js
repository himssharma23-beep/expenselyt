const { query } = require('../db/postgres');

async function run() {
  const splitFix = await query(
    `
    WITH candidate AS (
      SELECT
        g.user_id AS owner_user_id,
        gs.group_id,
        gs.friend_id AS old_friend_id,
        gs.target_user_id,
        (
          SELECT f2.id
          FROM live_split_friends f2
          WHERE f2.user_id = g.user_id
            AND f2.linked_user_id = gs.target_user_id
            AND f2.deleted_at IS NULL
          ORDER BY f2.id
          LIMIT 1
        ) AS new_friend_id,
        (
          SELECT f2.name
          FROM live_split_friends f2
          WHERE f2.user_id = g.user_id
            AND f2.linked_user_id = gs.target_user_id
            AND f2.deleted_at IS NULL
          ORDER BY f2.id
          LIMIT 1
        ) AS new_friend_name
      FROM live_split_group_shares gs
      JOIN live_split_groups g ON g.id = gs.group_id
      WHERE gs.target_user_id IS NOT NULL
    )
    UPDATE live_split_splits s
    SET friend_id = c.new_friend_id,
        friend_name = COALESCE(NULLIF(c.new_friend_name, ''), s.friend_name)
    FROM candidate c
    WHERE s.group_id = c.group_id
      AND s.friend_id = c.old_friend_id
      AND c.new_friend_id IS NOT NULL
      AND s.friend_id <> c.new_friend_id
    RETURNING s.id
    `
  );

  const shareFix = await query(
    `
    WITH candidate AS (
      SELECT
        g.user_id AS owner_user_id,
        gs.group_id,
        gs.friend_id AS old_friend_id,
        gs.target_user_id,
        (
          SELECT f2.id
          FROM live_split_friends f2
          WHERE f2.user_id = g.user_id
            AND f2.linked_user_id = gs.target_user_id
            AND f2.deleted_at IS NULL
          ORDER BY f2.id
          LIMIT 1
        ) AS new_friend_id
      FROM live_split_group_shares gs
      JOIN live_split_groups g ON g.id = gs.group_id
      WHERE gs.target_user_id IS NOT NULL
    )
    UPDATE live_split_group_shares gs
    SET friend_id = c.new_friend_id,
        updated_at = NOW()
    FROM candidate c
    WHERE gs.group_id = c.group_id
      AND gs.friend_id = c.old_friend_id
      AND c.new_friend_id IS NOT NULL
      AND gs.friend_id <> c.new_friend_id
    RETURNING gs.id
    `
  );

  console.log(
    JSON.stringify(
      {
        split_rows_updated: splitFix.rowCount || 0,
        share_rows_updated: shareFix.rowCount || 0,
      },
      null,
      2
    )
  );
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
