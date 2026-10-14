-- Questions become the balance an admin controls. The dollar credit stays as
-- the plan's value; what is left in dollars follows the questions left.
ALTER TABLE subscription ADD COLUMN questionLimit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscription ADD COLUMN questionsUsed INTEGER NOT NULL DEFAULT 0;
UPDATE subscription
  SET questionLimit = creditMicros / 400000,
      questionsUsed = (usedMicros + 200000) / 400000;
