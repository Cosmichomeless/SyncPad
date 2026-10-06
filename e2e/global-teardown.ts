import { existsSync, readFileSync, rmSync } from 'node:fs';
import { RESTARTED_BACKEND_PID_FILE } from './tests/helpers';

/** A test that restarted the backend started a process Playwright does not manage: stop it so none is left behind. */
export default function globalTeardown() {
  if (!existsSync(RESTARTED_BACKEND_PID_FILE)) return;
  const pid = Number(readFileSync(RESTARTED_BACKEND_PID_FILE, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  rmSync(RESTARTED_BACKEND_PID_FILE, { force: true });
}
