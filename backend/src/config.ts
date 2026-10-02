export function loadConfig(env: NodeJS.ProcessEnv) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '3001';
  if (!host.trim()) throw new Error('HOST must not be empty');
  if (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return { host, port: Number(rawPort) };
}
