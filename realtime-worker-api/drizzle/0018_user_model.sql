-- The AI model one user's answers come from, set by an admin. NULL keeps
-- the model chosen in AI settings for everyone.
ALTER TABLE user_model_params ADD COLUMN model TEXT;
