-- Speaking pass for one user's live answers, set by an admin: a second,
-- fast model call reshapes each answer so it reads aloud on the first try.
-- Holds the candidate's name as the pass's prompt names them; NULL = off.
ALTER TABLE user_model_params ADD COLUMN speakingPass TEXT;
