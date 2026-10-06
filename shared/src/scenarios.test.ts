import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_OPTIONS, generateScenario, runScenario, ScenarioFailure, type ScenarioOptions } from './testing/scenario.js';

// SYNC_SEED=<n> replays exactly one failing scenario; SYNC_SEEDS=<count> widens the search (default 300).
const single = process.env.SYNC_SEED ? Number(process.env.SYNC_SEED) : undefined;
const count = Number(process.env.SYNC_SEEDS ?? 300);
const seeds = single !== undefined ? [single] : Array.from({ length: count }, (_, index) => index + 1);

function sweep(label: string, options: ScenarioOptions) {
  test(`${label}: every seed converges after all clients reconnect`, () => {
    for (const seed of seeds) runScenario(seed, options);
  });
}

sweep('3 clients, edits and deletions', DEFAULT_OPTIONS);
sweep('2 clients, long scenarios', { clients: 2, steps: 150, deletes: true });
sweep('4 clients, short scenarios', { clients: 4, steps: 30, deletes: true });
sweep('insert-only: no token is lost or duplicated', { ...DEFAULT_OPTIONS, deletes: false });

test('a seed always yields the same scenario and the same final document', () => {
  assert.deepEqual(generateScenario(42), generateScenario(42));
  assert.notDeepEqual(generateScenario(42), generateScenario(43));
  const first = runScenario(42);
  const second = runScenario(42);
  assert.equal(first.text, second.text);
  assert.deepEqual(first.trace, second.trace);
});

test('the generated scenarios exercise every kind of operation', () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) for (const operation of generateScenario(seed)) kinds.add(operation.kind);
  assert.deepEqual([...kinds].sort(), ['connect', 'disconnect', 'erase', 'pull', 'push', 'reload', 'replay', 'type']);
});

test('a broken relay is caught and the failure names the seed and the operations to replay', () => {
  let failure: unknown;
  try {
    runScenario(7, { ...DEFAULT_OPTIONS, relay: { dropUploads: true } });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof ScenarioFailure, 'expected the dropped uploads to be detected');
  assert.equal(failure.seed, 7);
  assert.match(failure.message, /seed 7/);
  assert.match(failure.message, /SYNC_SEED=7/);
  assert.match(failure.message, /#0 C\d /);
  assert.ok(failure.trace.length > DEFAULT_OPTIONS.steps, 'the trace lists every operation');
});
