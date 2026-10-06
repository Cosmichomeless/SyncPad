import { createRequire } from 'node:module';

// `pg` lives in the backend's node_modules; the e2e package does not depend on it.
const { Client } = createRequire(new URL('../../backend/package.json', import.meta.url))('pg');

const admin = process.env.ADMIN_DATABASE_URL;
const name = process.env.SCREENSHOT_DATABASE;
if (!admin || !name || !/^[a-z_]+$/.test(name)) throw new Error('ADMIN_DATABASE_URL and SCREENSHOT_DATABASE (letters and underscores) are required');

/** Starts every run from an empty database so the seeded accounts and notes always come out the same. */
const client = new Client({ connectionString: admin });
await client.connect();
await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await client.query(`CREATE DATABASE ${name}`);
await client.end();
