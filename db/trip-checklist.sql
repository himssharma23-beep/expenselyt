CREATE TABLE IF NOT EXISTS trip_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE trip_members ADD COLUMN IF NOT EXISTS checklist_member_key TEXT;
ALTER TABLE trip_members ADD COLUMN IF NOT EXISTS checklist_can_check BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_checklist_assigned_member
  ON trip_members(trip_id, checklist_member_key)
  WHERE checklist_can_check AND permission IN ('share_view', 'share_edit');
CREATE INDEX IF NOT EXISTS idx_trip_checklist_trip ON trip_checklist_items(trip_id, id);
CREATE TABLE IF NOT EXISTS trip_checklist_checks (
  item_id BIGINT NOT NULL REFERENCES trip_checklist_items(id) ON DELETE CASCADE,
  participant_key TEXT NOT NULL,
  PRIMARY KEY (item_id, participant_key)
);
CREATE TABLE IF NOT EXISTS trip_checklist_reminders (
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  days_before INTEGER NOT NULL DEFAULT 3 CHECK (days_before BETWEEN 0 AND 365),
  frequency TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'daily', 'weekly')),
  time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  PRIMARY KEY (trip_id, user_id)
);
