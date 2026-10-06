-- One derived snapshot per note: the merged Yjs state of every note_updates row up to
-- covers_update_id. note_updates stays the source of truth (compaction is a separate step),
-- so a snapshot can always be discarded and rebuilt without losing anything.
CREATE TABLE IF NOT EXISTS syncpad.note_snapshots (
  note_id uuid PRIMARY KEY REFERENCES syncpad.notes(id) ON DELETE CASCADE,
  covers_update_id bigint NOT NULL,
  state bytea NOT NULL,
  update_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
