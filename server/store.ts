import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  boardSchema,
  type Board,
  type Runtime,
  type Snapshot,
  type Tile,
  type TileView,
} from '../shared/model.js';
import { emptyRuntime, evaluate } from './thresholds.js';
import { seedTiles } from './seed.js';

export class Store {
  db: DatabaseSync;
  constructor(path: string, seed = true) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS tiles (id TEXT PRIMARY KEY, config TEXT NOT NULL, runtime TEXT NOT NULL);`);
    if (!this.db.prepare('SELECT id FROM board').get()) {
      this.db
        .prepare('INSERT INTO board(id, config) VALUES(1, ?)')
        .run(JSON.stringify(boardSchema.parse({})));
      if (seed)
        for (const { tile, data } of seedTiles())
          this.putTile(tile, evaluate(tile, emptyRuntime(tile), Date.now(), data));
    }
    // Confirmation continuity is not assumed across process downtime.
    for (const tile of this.tiles()) this.setRuntime(tile.id, { ...tile.runtime, pending: {} });
  }
  board(): Board {
    return JSON.parse(
      (this.db.prepare('SELECT config FROM board WHERE id=1').get() as { config: string }).config,
    );
  }
  revision(): number {
    return (this.db.prepare('SELECT revision FROM board WHERE id=1').get() as { revision: number })
      .revision;
  }
  bump() {
    this.db.prepare('UPDATE board SET revision=revision+1 WHERE id=1').run();
  }
  setBoard(board: Board) {
    this.db.prepare('UPDATE board SET config=? WHERE id=1').run(JSON.stringify(board));
  }
  tiles(): TileView[] {
    return (
      this.db.prepare('SELECT config, runtime FROM tiles ORDER BY rowid').all() as {
        config: string;
        runtime: string;
      }[]
    ).map((row) => ({ ...JSON.parse(row.config), runtime: JSON.parse(row.runtime) }));
  }
  tile(id: string): TileView | undefined {
    return this.tiles().find((tile) => tile.id === id);
  }
  putTile(tile: Tile, runtime: Runtime) {
    this.db
      .prepare(
        'INSERT INTO tiles(id,config,runtime) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,runtime=excluded.runtime',
      )
      .run(tile.id, JSON.stringify(tile), JSON.stringify(runtime));
  }
  setRuntime(id: string, runtime: Runtime) {
    this.db.prepare('UPDATE tiles SET runtime=? WHERE id=?').run(JSON.stringify(runtime), id);
  }
  deleteTile(id: string) {
    this.db.prepare('DELETE FROM tiles WHERE id=?').run(id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  snapshot(authRequired = false): Snapshot {
    return { board: this.board(), tiles: this.tiles(), revision: this.revision(), authRequired };
  }
  close() {
    this.db.close();
  }
}

export function validateLayout(board: Board, tiles: Pick<Tile, 'id' | 'layout'>[]) {
  for (let i = 0; i < tiles.length; i++) {
    const a = tiles[i].layout;
    if (a.x + a.w > board.columns || a.y + a.h > board.rows)
      throw new Error(`La tuile « ${tiles[i].id} » dépasse la grille.`);
    for (let j = i + 1; j < tiles.length; j++) {
      const b = tiles[j].layout;
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        throw new Error(`Les tuiles « ${tiles[i].id} » et « ${tiles[j].id} » se chevauchent.`);
      }
    }
  }
}
