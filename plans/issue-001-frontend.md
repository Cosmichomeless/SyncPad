# SyncPad frontend foundation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent or compose:execute to implement this plan task-by-task.

**Goal:** Deliver issue #1: Next.js App Router starts locally and passes lint, typecheck and build.

**Architecture:** Keep frontend/ separate from the future backend/ and shared contracts. The initial route introduces SyncPad without claiming authentication or collaboration works yet.

**Tech Stack:** Node.js 22, npm, Next.js, React, TypeScript, ESLint.

## Global Constraints

- One PR per issue; do not merge or close issues.
- Chain dependent PRs and document their required base.
- No secrets or hosted services. Use local system fonts.
- Preserve the README project intent and MIT license.

## Task 1: Application and reproducible checks

**Files:** Create frontend/package.json, frontend/package-lock.json, frontend/tsconfig.json, frontend/next-env.d.ts, frontend/eslint.config.mjs, frontend/src/app/layout.tsx, frontend/src/app/page.tsx, frontend/src/app/globals.css, docs/issues/001-frontend.md; modify README.md.

**Interfaces:** npm --prefix frontend run dev, lint, typecheck, build and start. The / route returns HTML containing SyncPad.

- [ ] Create issue/1-nextjs-foundation from main.
- [ ] Check the absent command: npm --prefix frontend run typecheck fails before implementation.
- [ ] Query npm for compatible current releases and Node.js 22 support; pin resolved dependencies in the lockfile.
- [ ] Add scripts dev=next dev, build=next build, start=next start, lint=eslint ., typecheck=tsc --noEmit.
- [ ] Configure strict TypeScript and Next.js ESLint presets.
- [ ] Implement Home with a main landmark, SyncPad heading and Spanish copy explaining offline collaboration as the project goal, not an implemented feature.
- [ ] Implement layout with html lang=es, metadata title SyncPad and body children; local system fonts only.
- [ ] Install dependencies; run lint, typecheck, build, then typecheck again. Require exit 0.
- [ ] Start development server on a free local port, request / and require HTTP 200 plus SyncPad; stop only that process.
- [ ] Document prerequisites, install/run/check commands and initial scope in README and docs/issues/001-frontend.md.
- [ ] Independent review; fix findings and rerun affected checks.
- [ ] Commit owned files, push branch, open PR against main through GitHub MCP, and comment on issue #1 with checks and PR link.

## Subsequent delivery order

Each issue gets its own plan and delivery: #2 HTTP/WebSocket server; #3 PostgreSQL; #4 migrations; #5 shared contracts; #6 environment; #7 architecture documentation. Access, notes and CRDT behavior are outside this PR.
