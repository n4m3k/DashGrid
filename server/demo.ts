import { boardSchema, type Tile } from '../shared/model.js';
import { seedTiles } from './seed.js';
import { Store, validateLayout } from './store.js';
import { emptyRuntime, evaluate } from './thresholds.js';

export function restoreDemo(store: Store, now = Date.now()) {
  const existing = store.tiles();
  const board = { ...store.board(), columns: Math.max(store.board().columns, 6) };
  const placed: Pick<Tile, 'id' | 'layout'>[] = [...existing];
  const additions: ReturnType<typeof seedTiles> = [];
  const skipped: string[] = [];
  const available = (a: Tile['layout']) =>
    placed.every(
      ({ layout: b }) =>
        a.x >= b.x + b.w || a.x + a.w <= b.x || a.y >= b.y + b.h || a.y + a.h <= b.y,
    );

  for (const entry of seedTiles()) {
    if (existing.some((tile) => tile.id === entry.tile.id)) {
      skipped.push(entry.tile.id);
      continue;
    }
    let layout: Tile['layout'] | undefined = available(entry.tile.layout)
      ? entry.tile.layout
      : undefined;
    if (!layout) {
      const { w, h } = entry.tile.layout;
      for (let y = 0; !layout && y + h <= 24; y++) {
        for (let x = 0; x + w <= board.columns; x++) {
          const candidate = { x, y, w, h };
          if (available(candidate)) {
            layout = candidate;
            break;
          }
        }
      }
    }
    if (!layout)
      throw new Error(
        'Not enough free cells to restore the demo tiles. Enlarge or clear the grid first.',
      );
    const tile = { ...entry.tile, layout };
    additions.push({ ...entry, tile });
    placed.push(tile);
    board.rows = Math.max(board.rows, layout.y + layout.h);
  }

  if (additions.length) {
    const validated = boardSchema.parse(board);
    validateLayout(validated, placed);
    store.transaction(() => {
      store.setBoard(validated);
      for (const { tile, data } of additions)
        store.putTile(tile, evaluate(tile, emptyRuntime(tile), now, data));
      store.bump();
    });
  }
  return { added: additions.map(({ tile }) => tile.id), skipped };
}
