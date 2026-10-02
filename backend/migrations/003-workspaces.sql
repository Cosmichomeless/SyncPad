CREATE TABLE IF NOT EXISTS syncpad.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  created_by uuid NOT NULL REFERENCES syncpad.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS syncpad.memberships (
  workspace_id uuid NOT NULL REFERENCES syncpad.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES syncpad.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS memberships_user_idx ON syncpad.memberships (user_id);