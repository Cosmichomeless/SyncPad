# SyncPad HTTP and WebSocket foundation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task.

**Goal:** Deliver issue #2 with an independently runnable TypeScript HTTP/WebSocket server.

**Architecture:** A Node HTTP server exposes GET /health and upgrades only /ws through ws. A factory supports ephemeral loopback ports for real network tests; the entrypoint reads validated environment settings. No rooms, authentication or Yjs behavior yet.

**Tech Stack:** Node.js 22, TypeScript, ws, tsx, node:test, ESLint.

## Global Constraints

- One PR per issue; user now authorizes verification, merge and issue closure.
- Base main after integrating PR #70.
- No secrets, database tables, auth or shared document implementation in this delivery.
- Use apply_patch for text edits; npm generates its lockfile.

## Task 1: Real-network server foundation

**Files:** backend/package.json, backend/package-lock.json, backend/tsconfig.json, backend/eslint.config.mjs, backend/src/server.ts, backend/src/config.ts, backend/src/index.ts, backend/tests/server.test.ts, backend/tests/config.test.ts, docs/issues/002-backend.md; README.md.

**Interfaces:** createSyncServer() returns a Node HTTP server and async close method; loadConfig(env) returns host and port; entrypoint uses HOST default 127.0.0.1 and PORT default 3001. Scripts dev, build, start, lint, typecheck, test.

- [x] Create issue/2-typescript-sync-server and fast-forward to main after PR #70 integration.
- [ ] Install compatible exact ws, tsx, TypeScript and lint dependencies; pin lockfile.
- [ ] Write real HTTP test first: GET /health returns 200 JSON {status:"ok"}; unrelated route returns 404. Verify expected RED for missing handler, then implement minimum GREEN.
- [ ] Write real ws test first: /ws connects; other upgrade paths reject; close tears down test clients and listening server. Verify RED then GREEN.
- [ ] Test environment ports: reject non-integer/out-of-range values; allow default 3001 and supplied valid ports. Reject empty host. Use clean error without environment dumps.
- [ ] Separate side-effect-free server factory and executable entrypoint. On SIGINT/SIGTERM stop accepting connections, close clients, and exit; bound graceful close duration.
- [ ] Run backend lint, typecheck, tests, build and built-entrypoint health/WebSocket smoke. Require exit 0. Rerun frontend checks impacted by changes.
- [ ] Document both application commands, endpoint paths and explicitly unauthenticated local-only scaffold in README and issue doc. Include exact verification outputs.
- [ ] Publish PR via MCP against main, verify integration, merge and close #2. User requested direct execution with the current model, without additional subagents.
