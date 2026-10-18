import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup } from 'node:sqlite';
import { Store } from './store.js';
import { restoreDemo } from './demo.js';

const path = process.env.DATABASE_PATH ?? 'data/dashgrid.sqlite';
const existed = path !== ':memory:' && existsSync(path);
let store: Store | undefined;
try {
  store = new Store(path, false);
  if (existed) {
    const directory = join(dirname(path), 'backups');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const destination = join(
      directory,
      `before-demo-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    await backup(store.db, destination);
    console.log(`Database backup: ${destination}`);
  }
  const result = restoreDemo(store);
  console.log(
    `Restored ${result.added.length} demo tiles; ${result.skipped.length} demo IDs already exist.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  store?.close();
}
