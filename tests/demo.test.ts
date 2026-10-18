import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { tileSchema } from '../shared/model.js';
import { Store, validateLayout } from '../server/store.js';
import { restoreDemo } from '../server/demo.js';
import { emptyRuntime, evaluate } from '../server/thresholds.js';

test('restore repopulates an emptied dashboard and is idempotent', () => {
  const store = new Store(':memory:', false);
  try {
    const result = restoreDemo(store, 1000);
    assert.equal(result.added.length, 12);
    assert.equal(store.tiles().length, 12);
    assert.equal(store.tile('cpu')?.runtime.data?.value, 42);
    assert.equal(store.tile('errors')?.runtime.state, 'critical');
    assert.ok(store.tiles().every((tile) => tile.demo));
    validateLayout(store.board(), store.tiles());
    const revision = store.revision();
    assert.deepEqual(restoreDemo(store, 2000).added, []);
    assert.equal(store.revision(), revision);
    store.deleteTile('cpu');
    assert.deepEqual(restoreDemo(store, 3000).added, ['cpu']);
    assert.equal(store.tiles().length, 12);
  } finally {
    store.close();
  }
});

test('restore preserves custom tiles and finds free positions for demo tiles', () => {
  const store = new Store(':memory:', false);
  try {
    const custom = tileSchema.parse({
      id: 'custom',
      layout: { x: 0, y: 0, w: 2, h: 1 },
      content: { title: 'My service' },
    });
    store.putTile(custom, evaluate(custom, emptyRuntime(custom), 1000, { value: 123 }));
    const before = store.tile('custom');
    assert.equal(restoreDemo(store, 2000).added.length, 12);
    assert.deepEqual(store.tile('custom'), before);
    assert.equal(store.tiles().length, 13);
    assert.equal(store.board().rows, 5);
    validateLayout(store.board(), store.tiles());
    // An existing ID may refer to a real service rather than a demo.
    store.deleteTile('api');
    const realApi = { ...custom, id: 'api', layout: { ...store.tile('cpu')!.layout } };
    store.deleteTile('cpu');
    store.putTile(realApi, evaluate(realApi, emptyRuntime(realApi), 3000, { value: 'real' }));
    restoreDemo(store, 4000);
    assert.equal(store.tile('api')?.runtime.data?.value, 'real');
    assert.equal(store.tile('api')?.demo, false);
  } finally {
    store.close();
  }
});

test('restore fails atomically when the grid has no room', () => {
  const store = new Store(':memory:', false);
  try {
    store.setBoard({ ...store.board(), columns: 24, rows: 24 });
    const tile = tileSchema.parse({
      id: 'full',
      layout: { x: 0, y: 0, w: 24, h: 24 },
      content: { title: 'Full grid' },
    });
    store.putTile(tile, emptyRuntime(tile));
    const before = store.snapshot();
    assert.throws(() => restoreDemo(store), /Not enough free cells/);
    assert.deepEqual(store.snapshot(), before);
  } finally {
    store.close();
  }
});

test('restore CLI creates a usable backup of the existing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashgrid-demo-'));
  const path = join(directory, 'dashboard.sqlite');
  try {
    const original = new Store(path, false);
    const tile = tileSchema.parse({
      id: 'custom',
      layout: { x: 0, y: 0, w: 2, h: 1 },
      content: { title: 'Custom' },
    });
    original.putTile(tile, evaluate(tile, emptyRuntime(tile), 1000, { value: 123 }));
    original.close();
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/demo-cli.ts'], {
      env: { ...process.env, DATABASE_PATH: path },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Restored 12 demo tiles/);
    const backups = readdirSync(join(directory, 'backups'));
    assert.equal(backups.length, 1);
    const archived = new DatabaseSync(join(directory, 'backups', backups[0]), { readOnly: true });
    try {
      assert.equal(
        (archived.prepare('SELECT COUNT(*) AS count FROM tiles').get() as { count: number }).count,
        1,
      );
    } finally {
      archived.close();
    }
    const restored = new Store(path, false);
    try {
      assert.equal(restored.tiles().length, 13);
      assert.equal(restored.tile('custom')?.runtime.data?.value, 123);
    } finally {
      restored.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
