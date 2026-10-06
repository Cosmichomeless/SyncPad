import { loadConfig } from './config.js';
import { createAuthService } from './auth.js';
import { createDatabasePool } from './database.js';
import { createSyncServer } from './server.js';
import { loadSecurityConfig } from './security.js';
import { createWorkspaceService } from './workspaces.js';
import { createNoteService } from './notes.js';
import { createLogger } from './logger.js';
import { loadLimits } from './limits.js';
import { createPostgresSyncStore, loadRetentionMs } from './sync-store.js';

try {
  const config = loadConfig(process.env);
  const { host, port } = config;
  const security = loadSecurityConfig(process.env);
  const logger = createLogger();
  const database = createDatabasePool(config.databaseUrl);
  const app = createSyncServer({
    auth: createAuthService(database),
    security,
    workspaces: createWorkspaceService(database),
    notes: createNoteService(database),
    syncStore: createPostgresSyncStore(database, { retentionMs: loadRetentionMs(process.env) }),
    limits: loadLimits(process.env),
    logger,
    metricsToken: process.env.METRICS_TOKEN || undefined,
  });
  const shutdown = () => {
    void app.close().then(() => database.end()).catch(() => {
      console.error('SyncPad shutdown failed');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  app.server.on('error', () => {
    console.error('SyncPad server failed to listen');
    process.exitCode = 1;
    shutdown();
  });
  app.server.listen(port, host, () => logger.info('SyncPad listening', { port }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid server configuration');
  process.exitCode = 1;
}
