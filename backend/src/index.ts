import { loadConfig } from './config.js';
import { createAuthService } from './auth.js';
import { createDatabasePool } from './database.js';
import { createSyncServer } from './server.js';

try {
  const config = loadConfig(process.env);
  const { host, port } = config;
  const database = createDatabasePool(config.databaseUrl);
  const app = createSyncServer({ auth: createAuthService(database) });
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
  app.server.listen(port, host, () => console.log('SyncPad listening on port ' + port));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid server configuration');
  process.exitCode = 1;
}
