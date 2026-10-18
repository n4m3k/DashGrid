import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp } from '../server/app.js';
import { tileSchema } from '../shared/model.js';
import { extractPath } from '../server/collector.js';

const tile = (id: string, x = 0) =>
  tileSchema.parse({
    id,
    layout: { x, y: 0, w: 1, h: 1 },
    content: { title: id },
    thresholds: {
      rules: [{ id: 'high', state: 'critical', enter: { operator: 'gte', value: 80 } }],
    },
  });
test('CRUD, partial edits, atomic positioning, revisions and persistence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashgrid-test-'));
  let context = await createApp({
    database: join(dir, 'state.sqlite'),
    seed: false,
    scheduler: false,
  });
  const { app } = context;
  try {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/tiles', payload: tile('a') })).statusCode,
      201,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/tiles', payload: tile('b', 1) }))
        .statusCode,
      201,
    );
    let response = await app.inject({
      method: 'POST',
      url: '/api/v1/tiles/a/data',
      payload: { value: 81 },
    });
    assert.equal(response.json().state, 'critical');
    response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tiles/a',
      payload: { content: { title: 'CPU' }, appearance: { colors: { critical: '#ff0000' } } },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().runtime.color, '#ff0000');
    assert.equal(response.json().content.unit, '');
    response = await app.inject({
      method: 'PUT',
      url: '/api/v1/layout',
      payload: {
        tiles: [
          { id: 'a', x: 1, y: 0, w: 1, h: 1 },
          { id: 'b', x: 0, y: 0, w: 1, h: 1 },
        ],
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    response = await app.inject({
      method: 'PUT',
      url: '/api/v1/layout',
      payload: { tiles: [{ id: 'a', x: 0, y: 0, w: 1, h: 1 }] },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(context.store.tile('a')?.layout.x, 1);
    assert.equal(
      (await app.inject({ method: 'PATCH', url: '/api/v1/dashboard', payload: { columns: 1 } }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/dashboard',
          headers: { 'if-match': '"1"' },
          payload: { title: 'Stale' },
        })
      ).statusCode,
      409,
    );
    const runtime = context.store.tile('a')?.runtime;
    await app.close();
    context = await createApp({
      database: join(dir, 'state.sqlite'),
      seed: false,
      scheduler: false,
    });
    assert.equal(context.store.tile('a')?.content.title, 'CPU');
    assert.equal(context.store.tile('a')?.layout.x, 1);
    assert.equal(context.store.tile('a')?.runtime.receivedAt, runtime?.receivedAt);
    assert.equal(
      (await context.app.inject({ method: 'DELETE', url: '/api/v1/tiles/a' })).statusCode,
      204,
    );
    assert.equal((await context.app.inject('/api/v1/tiles/a')).statusCode, 404);
  } finally {
    await context.app.close();
    rmSync(dir, { recursive: true });
  }
});
test('write authentication, cross-origin rejection and secret redaction', async () => {
  const { app, store } = await createApp({
    database: ':memory:',
    seed: false,
    scheduler: false,
    token: 'test-key',
  });
  try {
    assert.equal((await app.inject('/api/v1/dashboard')).json().authRequired, true);
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/tiles', payload: tile('secret') }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/tiles',
          headers: { authorization: 'Bearer test-key', origin: 'https://evil.example' },
          payload: tile('secret'),
        })
      ).statusCode,
      403,
    );
    const config = tile('secret');
    config.source = {
      type: 'http',
      url: 'http://127.0.0.1:1',
      headers: { Authorization: 'Bearer hidden-secret' },
      intervalSeconds: 30,
      timeoutSeconds: 1,
      valuePath: 'value',
      messagePath: '',
    };
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/tiles',
      headers: { authorization: 'Bearer test-key' },
      payload: config,
    });
    assert.equal(result.statusCode, 201, result.body);
    assert.ok(!result.body.includes('hidden-secret'));
    assert.ok(!(await app.inject('/api/v1/dashboard')).body.includes('hidden-secret'));
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tiles/secret',
      headers: { authorization: 'Bearer test-key' },
      payload: { source: { intervalSeconds: 60 } },
    });
    assert.equal(patch.statusCode, 200);
    const saved = store.tile('secret')!;
    assert.equal(
      saved.source.type === 'http' && saved.source.headers.Authorization,
      'Bearer hidden-secret',
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/tiles/secret/duplicate',
      headers: { authorization: 'Bearer test-key' },
      payload: { id: 'copy', layout: { x: 1, y: 0, w: 1, h: 1 } },
    });
    assert.equal(duplicate.statusCode, 201);
    assert.ok(!duplicate.body.includes('hidden-secret'));
    const copied = store.tile('copy')!;
    assert.equal(
      copied.source.type === 'http' && copied.source.headers.Authorization,
      'Bearer hidden-secret',
    );
  } finally {
    await app.close();
  }
});
test('HTTP collector extracts JSON and exposes upstream errors without losing values', async () => {
  let status = 200;
  const upstream = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ metrics: [{ cpu: 85 }], message: 'loaded' }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = (upstream.address() as { port: number }).port;
  const { app, store, collector } = await createApp({
    database: ':memory:',
    seed: false,
    scheduler: false,
  });
  try {
    const config = tile('remote');
    config.source = {
      type: 'http',
      url: `http://127.0.0.1:${port}`,
      intervalSeconds: 5,
      timeoutSeconds: 1,
      valuePath: 'metrics[0].cpu',
      messagePath: 'message',
      headers: {},
    };
    await app.inject({ method: 'POST', url: '/api/v1/tiles', payload: config });
    collector.tick();
    for (let i = 0; i < 100 && !store.tile('remote')?.runtime.receivedAt; i++) await wait(20);
    assert.equal(store.tile('remote')?.runtime.state, 'critical');
    assert.equal(store.tile('remote')?.runtime.data?.message, 'loaded');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/tiles/remote/data',
          payload: { value: 1 },
        })
      ).statusCode,
      409,
    );
    status = 503;
    collector.tick(Date.now() + 6000);
    for (let i = 0; i < 100 && !store.tile('remote')?.runtime.error; i++) await wait(20);
    assert.equal(store.tile('remote')?.runtime.state, 'unknown');
    assert.equal(store.tile('remote')?.runtime.data?.value, 85);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
test('SSE publishes an initial snapshot and pushed state changes', async () => {
  const { app } = await createApp({ database: ':memory:', seed: false, scheduler: false });
  await app.inject({ method: 'POST', url: '/api/v1/tiles', payload: tile('live') });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const stream = await fetch(`${address}/api/v1/events`, { signal: controller.signal });
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes('event: snapshot'));
    await app.inject({ method: 'POST', url: '/api/v1/tiles/live/data', payload: { value: 99 } });
    let event = '';
    while (!event.includes('"critical"'))
      event += new TextDecoder().decode((await reader.read()).value);
    assert.ok(event.includes('"value":99'));
  } finally {
    controller.abort();
    clearTimeout(timeout);
    await app.close();
  }
});
test('preview is side-effect-free and malformed inputs are rejected', async () => {
  const { app, store } = await createApp({ database: ':memory:', seed: false, scheduler: false });
  try {
    await app.inject({ method: 'POST', url: '/api/v1/tiles', payload: tile('preview') });
    const revision = store.revision();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tiles/preview/preview',
      payload: { data: { value: 99 } },
    });
    assert.equal(response.json().state, 'critical');
    assert.equal(store.tile('preview')?.runtime.data, null);
    assert.equal(store.revision(), revision);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/tiles/preview/data',
          payload: { value: { injected: true } },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/tiles/preview',
          payload: { layout: { x: -1 } },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/tiles/preview',
          payload: { unexpected: true },
        })
      ).statusCode,
      400,
    );
    assert.equal(extractPath({ a: [{ b: 42 }] }, 'a[0].b'), 42);
    assert.equal(extractPath({}, '__proto__.polluted'), undefined);
    assert.equal((await app.inject('/api/docs/json')).statusCode, 200);
  } finally {
    await app.close();
  }
});
