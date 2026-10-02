export function loadConfig(env: NodeJS.ProcessEnv) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '3001';
  const databaseUrl = env.DATABASE_URL ?? 'postgres://syncpad:syncpad@127.0.0.1:5432/syncpad';
  if (!host.trim()) throw new Error('HOST must not be empty');
  if (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  try {
    const parsedDatabaseUrl = new URL(databaseUrl);
    if (parsedDatabaseUrl.protocol !== 'postgres:' && parsedDatabaseUrl.protocol !== 'postgresql:') {
      throw new Error('DATABASE_URL must use the postgres protocol');
    }
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  return { host, port: Number(rawPort), databaseUrl };
}
