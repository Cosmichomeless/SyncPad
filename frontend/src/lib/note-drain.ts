/**
 * Keeps a note's sync session alive after the user navigates away, but only while it still holds
 * edits the server has not acknowledged. Leaving a note must never strand pending edits on this
 * device: the session finishes uploading in the background and is then released.
 */
export type DrainRegistry = {
  /** Holds `release` until `settle` is called or the timeout elapses, whichever comes first. */
  hold(noteId: string, release: () => void): () => void;
  /** Note ids that are still uploading in the background. */
  ids(): string[];
  /** Releases everything immediately (logout, unmount). */
  clear(): void;
};

export function createDrainRegistry(onChange: (ids: string[]) => void, timeoutMs = 60_000): DrainRegistry {
  const held = new Set<{ noteId: string; finish: () => void }>();
  const ids = () => [...new Set([...held].map((entry) => entry.noteId))];
  return {
    hold(noteId, release) {
      let done = false;
      const entry = {
        noteId,
        finish() {
          if (done) return;
          done = true;
          clearTimeout(timer);
          held.delete(entry);
          release();
          onChange(ids());
        },
      };
      const timer = setTimeout(entry.finish, timeoutMs);
      held.add(entry);
      onChange(ids());
      return entry.finish;
    },
    ids,
    clear() {
      for (const entry of [...held]) entry.finish();
    },
  };
}
