import type { TileData } from '../shared/model.js';
import { dataSchema } from '../shared/model.js';
import type { Store } from './store.js';

export function extractPath(data: unknown, path: string): unknown {
  if (!path) return data;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>((current, key) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return undefined;
      return current !== null && typeof current === 'object' && Object.hasOwn(current, key)
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }, data);
}

export class Collector {
  private due = new Map<string, number>();
  private active = new Map<string, AbortController>();
  private stopped = false;
  constructor(
    private store: Store,
    private ingest: (id: string, data?: TileData, error?: string) => void,
  ) {}
  tick(now = Date.now()) {
    for (const tile of this.store.tiles()) {
      if (this.active.size >= 8) break;
      if (
        tile.source.type !== 'http' ||
        this.active.has(tile.id) ||
        (this.due.get(tile.id) ?? 0) > now
      )
        continue;
      this.due.set(tile.id, now + tile.source.intervalSeconds * 1000);
      void this.collect(tile.id);
    }
  }
  reset(id: string) {
    this.due.delete(id);
    this.active.get(id)?.abort();
  }
  stop() {
    this.stopped = true;
    for (const controller of this.active.values()) controller.abort();
  }
  private async collect(id: string) {
    const tile = this.store.tile(id);
    if (!tile || tile.source.type !== 'http') return;
    const source = tile.source;
    const signature = JSON.stringify(source);
    const controller = new AbortController();
    this.active.set(id, controller);
    const timeout = setTimeout(() => controller.abort(), source.timeoutSeconds * 1000);
    try {
      const response = await fetch(source.url, {
        headers: { accept: 'application/json', ...source.headers },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Bound response memory even when an upstream ignores Content-Length.
      if (!response.body) throw new Error('Réponse vide');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) {
          controller.abort();
          throw new Error('Réponse supérieure à 1 Mo');
        }
        chunks.push(value);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const data = dataSchema.parse({
        value: extractPath(body, source.valuePath),
        ...(source.messagePath ? { message: extractPath(body, source.messagePath) } : {}),
        ...(source.statusPath ? { status: extractPath(body, source.statusPath) } : {}),
      });
      if (!this.stopped && JSON.stringify(this.store.tile(id)?.source) === signature)
        this.ingest(id, data);
    } catch (error) {
      if (!this.stopped && JSON.stringify(this.store.tile(id)?.source) === signature) {
        const message = controller.signal.aborted
          ? 'Délai de collecte dépassé'
          : error instanceof Error
            ? error.message
            : 'Échec de collecte';
        this.ingest(id, undefined, message.slice(0, 200));
      }
    } finally {
      clearTimeout(timeout);
      this.active.delete(id);
    }
  }
}
