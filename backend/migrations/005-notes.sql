CREATE TABLE IF NOT EXISTS syncpad.notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    workspace_id uuid NOT NULL REFERENCES syncpad.workspaces (id) ON DELETE CASCADE,
    title text NOT NULL CHECK (
        char_length(trim(title)) BETWEEN 1 AND 200
    ),
    created_by uuid NOT NULL REFERENCES syncpad.users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_workspace_updated_idx ON syncpad.notes (
    workspace_id,
    updated_at DESC,
    id
);