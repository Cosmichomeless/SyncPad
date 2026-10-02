CREATE TABLE IF NOT EXISTS syncpad.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES syncpad.workspaces(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES syncpad.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES syncpad.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_active_token_idx
  ON syncpad.invitations (token_hash)
  WHERE accepted_at IS NULL;