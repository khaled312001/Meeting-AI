-- Speeds up GET /api/sessions (a user's sessions, newest first).
CREATE INDEX IF NOT EXISTS live_session_user_started_idx
  ON live_session (userId, startedAt);
