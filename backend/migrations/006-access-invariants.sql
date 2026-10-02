CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_email_idx
  ON syncpad.invitations (workspace_id, lower(invited_email))
  WHERE accepted_at IS NULL;