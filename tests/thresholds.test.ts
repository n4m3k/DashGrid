import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileSchema } from '../shared/model.js';
import { emptyRuntime, evaluate, matches } from '../server/thresholds.js';

const makeTile = (holdSeconds = 0) =>
  tileSchema.parse({
    id: 'cpu',
    layout: { x: 0, y: 0, w: 1, h: 1 },
    content: { title: 'CPU' },
    thresholds: {
      staleAfterSeconds: 120,
      rules: [
        {
          id: 'warning',
          state: 'warning',
          enter: { operator: 'gte', value: 60 },
          exit: { operator: 'lt', value: 55 },
          holdSeconds,
        },
        {
          id: 'critical',
          state: 'critical',
          enter: { operator: 'gte', value: 80 },
          exit: { operator: 'lt', value: 75 },
          holdSeconds,
        },
      ],
    },
  });
test('critical outranks warning regardless of rule order; exit uses hysteresis', () => {
  const tile = makeTile();
  let runtime = evaluate(tile, emptyRuntime(tile), 1000, { value: 80 });
  assert.equal(runtime.state, 'critical');
  runtime = evaluate(tile, runtime, 2000, { value: 79 });
  assert.equal(runtime.state, 'critical');
  runtime = evaluate(tile, runtime, 3000, { value: 75 });
  assert.equal(runtime.state, 'critical');
  runtime = evaluate(tile, runtime, 4000, { value: 74 });
  assert.equal(runtime.state, 'warning');
  runtime = evaluate(tile, runtime, 5000, { value: 56 });
  assert.equal(runtime.state, 'warning');
  assert.equal(evaluate(tile, runtime, 6000, { value: 54 }).state, 'ok');
});
test('confirmation advances only on fresh samples, resets on interruption and applies to recovery', () => {
  const tile = makeTile(30);
  let runtime = evaluate(tile, emptyRuntime(tile), 1000, { value: 85 });
  assert.equal(runtime.state, 'ok');
  runtime = evaluate(tile, runtime, 31000);
  assert.equal(runtime.state, 'ok', 'silence cannot confirm a threshold');
  runtime = evaluate(tile, runtime, 31000, { value: 85 });
  assert.equal(runtime.state, 'critical');
  runtime = evaluate(tile, runtime, 32000, { value: 40 });
  assert.equal(runtime.state, 'critical');
  runtime = evaluate(tile, runtime, 50000, { value: 81 });
  runtime = evaluate(tile, runtime, 62000, { value: 40 });
  assert.equal(runtime.state, 'critical', 'recovery confirmation restarted');
  runtime = evaluate(tile, runtime, 92000, { value: 40 });
  assert.equal(runtime.state, 'ok');
});
test('expiry clears confirmation continuity and retains last value', () => {
  const tile = makeTile(30);
  let runtime = evaluate(tile, emptyRuntime(tile), 1000, { value: 90 });
  runtime = evaluate(tile, runtime, 121000);
  assert.equal(runtime.state, 'unknown');
  assert.equal(runtime.data?.value, 90);
  assert.deepEqual(runtime.pending, {});
  runtime = evaluate(tile, runtime, 122000, { value: 90 });
  assert.equal(runtime.state, 'ok');
  assert.equal(runtime.pending['critical:enter'], 122000);
});
test('invalid numeric data and collection errors cannot appear healthy', () => {
  const tile = makeTile();
  let runtime = evaluate(tile, emptyRuntime(tile), 1000, { value: 'not a number' });
  assert.equal(runtime.state, 'unknown');
  runtime = evaluate(tile, runtime, 2000, { value: 42 });
  runtime = evaluate(tile, runtime, 3000, undefined, 'HTTP 503');
  assert.equal(runtime.state, 'unknown');
  assert.equal(runtime.data?.value, 42);
  assert.equal(evaluate(tile, runtime, 4000, { value: 42 }).state, 'ok');
});
test('fixed color remains fixed even if data expire, while state exposes freshness', () => {
  const tile = makeTile();
  tile.appearance.mode = 'fixed';
  tile.appearance.fixedColor = '#123456';
  const runtime = evaluate(tile, emptyRuntime(tile), 1000);
  assert.equal(runtime.color, '#123456');
  assert.equal(runtime.state, 'unknown');
});
test('string/boolean comparisons are strict and numeric intervals include boundaries', () => {
  assert.ok(matches('down', { operator: 'eq', value: 'down' }));
  assert.ok(matches(false, { operator: 'eq', value: false }));
  assert.ok(!matches('80', { operator: 'gte', value: 80 }));
  assert.ok(matches(10, { operator: 'between', value: 10, max: 20 }));
  assert.ok(matches(20, { operator: 'between', value: 10, max: 20 }));
});
