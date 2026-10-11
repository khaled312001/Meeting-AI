-- Paid plans: a prepaid AI credit (micro-USD) for a fixed period. Every
-- completion is charged at the model's token price until the credit runs out.
CREATE TABLE IF NOT EXISTS subscription (
  userId TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  creditMicros INTEGER NOT NULL,
  usedMicros INTEGER NOT NULL DEFAULT 0,
  startsAt INTEGER NOT NULL,
  endsAt INTEGER NOT NULL,
  note TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
