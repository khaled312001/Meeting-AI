-- Per-user knowledge files: extracted text that grounds the model's answers.
CREATE TABLE IF NOT EXISTS user_knowledge_doc (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  fileName TEXT NOT NULL,
  content TEXT NOT NULL,
  charCount INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS user_knowledge_doc_user_created_idx
  ON user_knowledge_doc (userId, createdAt);
