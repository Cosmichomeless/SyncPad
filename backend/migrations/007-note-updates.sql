CREATE TABLE IF NOT EXISTS syncpad.note_updates (
  id bigserial PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES syncpad.notes(id) ON DELETE CASCADE,
  update_hash text NOT NULL,
  update_data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, update_hash)
);

CREATE INDEX IF NOT EXISTS note_updates_note_created_idx
  ON syncpad.note_updates (note_id, created_at, id);