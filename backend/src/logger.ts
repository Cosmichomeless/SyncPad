export type LogLevel = 'info' | 'warn' | 'error';
/** Only identifiers and numbers: callers must never pass note text, emails or tokens. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type Logger = { [level in LogLevel]: (msg: string, fields?: LogFields) => void };

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** One JSON object per line, so any log shipper can parse it without a format spec. */
export function createLogger(write: (line: string) => void = (line) => { process.stdout.write(line + '\n'); }, now: () => Date = () => new Date()): Logger {
  const log = (level: LogLevel) => (msg: string, fields: LogFields = {}) => {
    try {
      // Reserved keys go last so a field can never overwrite them.
      write(JSON.stringify({ ...fields, ts: now().toISOString(), level, msg }));
    } catch { /* logging must never break the caller */ }
  };
  return { info: log('info'), warn: log('warn'), error: log('error') };
}
