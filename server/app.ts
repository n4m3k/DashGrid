import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import type { OpenAPIV3 } from 'openapi-types';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { z, ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  boardSchema,
  dataSchema,
  layoutSchema,
  tileSchema,
  type Runtime,
  type Tile,
  type TileData,
} from '../shared/model.js';
import { Store, validateLayout } from './store.js';
import { emptyRuntime, evaluate } from './thresholds.js';
import { Collector } from './collector.js';

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const configOf = ({ runtime: _, ...tile }: Tile & { runtime?: Runtime }): Tile => tile;
const protect = <T extends Tile>(tile: T): T =>
  tile.source.type === 'http' ? { ...tile, source: { ...tile.source, headers: {} } } : tile;
const layoutBody = z
  .object({
    tiles: z.array(layoutSchema.extend({ id: z.string() })).max(576),
  })
  .strict();

export async function createApp(
  options: {
    database?: string;
    seed?: boolean;
    scheduler?: boolean;
    token?: string;
    logger?: boolean;
    publicDir?: string;
  } = {},
) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 65536, requestTimeout: 15000 });
  const store = new Store(
    options.database ?? process.env.DATABASE_PATH ?? 'data/dashgrid.sqlite',
    options.seed ?? true,
  );
  const token = options.token ?? process.env.DASHGRID_API_KEY ?? '';
  const clients = new Set<ServerResponse>();
  const snapshot = () => ({ ...store.snapshot(Boolean(token)), tiles: store.tiles().map(protect) });
  const broadcast = () => {
    const event = `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for (const client of clients) {
      if (client.destroyed || client.writableLength > 1024 * 1024) {
        client.destroy();
        clients.delete(client);
      } else client.write(event);
    }
  };
  const ingest = (id: string, data?: TileData, error?: string) => {
    const tile = store.tile(id);
    if (!tile) return;
    const runtime = evaluate(tile, tile.runtime, Date.now(), data, error);
    store.setRuntime(id, runtime);
    broadcast();
    return runtime;
  };
  const collector = new Collector(store, ingest);
  const ensureTile = (id: string) => {
    const tile = store.tile(id);
    if (!tile) throw new HttpError(404, 'Tuile introuvable.');
    return tile;
  };
  const checkLayout = (board = store.board(), tiles = store.tiles()) => {
    try {
      validateLayout(board, tiles);
    } catch (error) {
      throw new HttpError(409, (error as Error).message);
    }
  };
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (request.headers.origin) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(request.headers.origin).host === request.headers.host;
      } catch {
        /* invalid origin */
      }
      if (!sameOrigin) throw new HttpError(403, 'Origine non autorisée.');
    }
    if (token) {
      const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const expected = Buffer.from(token);
      const actual = Buffer.from(supplied);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new HttpError(401, 'Clé API requise ou incorrecte.');
    }
  });
  app.addHook('preHandler', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const revision = request.headers['if-match'];
    if (revision !== undefined && revision !== `"${store.revision()}"`)
      throw new HttpError(409, 'Le dashboard a changé. Rechargez avant de réessayer.');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: error.issues.map((issue) => `${issue.path.join('.')} : ${issue.message}`).join('\n'),
      });
    const failure = error as { statusCode?: number; message?: string };
    const status = typeof failure.statusCode === 'number' ? failure.statusCode : 500;
    if (status >= 500) app.log.error(error);
    reply
      .code(status)
      .send({ error: status >= 500 ? 'Erreur interne du serveur.' : failure.message });
  });

  const document = {
    openapi: '3.0.3',
    info: {
      title: 'Dashgrid API',
      version: '1.0.0',
      description:
        'Configuration des tuiles, alimentation push et mises à jour SSE. En-têtes HTTP de collecte masqués dans les réponses. Les PATCH fusionnent les objets ; les tableaux sont remplacés. If-Match: "revision" permet de prévenir les conflits.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Tile: zodToJsonSchema(tileSchema, { target: 'openApi3', $refStrategy: 'none' }),
        Data: zodToJsonSchema(dataSchema, { target: 'openApi3', $refStrategy: 'none' }),
        Board: zodToJsonSchema(boardSchema, { target: 'openApi3', $refStrategy: 'none' }),
      },
    },
    paths: Object.fromEntries(
      [
        ['/dashboard', 'get', 'Lire le dashboard', null],
        ['/dashboard', 'patch', 'Configurer le dashboard', { $ref: '#/components/schemas/Board' }],
        ['/tiles', 'post', 'Créer une tuile', { $ref: '#/components/schemas/Tile' }],
        ['/tiles/{id}', 'get', 'Lire une tuile', null],
        ['/tiles/{id}', 'patch', 'Modifier une tuile (objet partiel)', { type: 'object' }],
        ['/tiles/{id}', 'delete', 'Supprimer une tuile', null],
        [
          '/layout',
          'put',
          'Enregistrer les positions',
          zodToJsonSchema(layoutBody, { target: 'openApi3' }),
        ],
        [
          '/tiles/{id}/duplicate',
          'post',
          'Dupliquer une tuile et sa source',
          {
            type: 'object',
            required: ['id', 'layout'],
            properties: {
              id: { type: 'string' },
              layout: zodToJsonSchema(layoutSchema, { target: 'openApi3' }),
            },
          },
        ],
        ['/tiles/{id}/data', 'post', 'Envoyer des données', { $ref: '#/components/schemas/Data' }],
        [
          '/tiles/{id}/preview',
          'post',
          'Tester les seuils (sans écriture)',
          {
            type: 'object',
            properties: {
              data: { $ref: '#/components/schemas/Data' },
              tile: { $ref: '#/components/schemas/Tile' },
            },
            required: ['data'],
          },
        ],
        ['/events', 'get', 'Flux SSE : snapshot initial puis mises à jour', null],
      ].reduce<[string, Record<string, unknown>][]>((acc, [path, method, summary, schema]) => {
        const key = String(path);
        const verb = String(method);
        let entry = acc.find(([name]) => name === key);
        if (!entry) {
          entry = [key, {}];
          acc.push(entry);
        }
        entry[1][verb] = {
          summary,
          ...(verb !== 'get' ? { security: [{ apiKey: [] }] } : {}),
          ...(key.includes('{id}')
            ? {
                parameters: [
                  { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                ],
              }
            : {}),
          ...(schema
            ? { requestBody: { required: true, content: { 'application/json': { schema } } } }
            : {}),
          responses: {
            '200': { description: 'Succès' },
            '400': { description: 'Données invalides' },
            '401': { description: 'Clé requise' },
            '409': { description: 'Conflit de placement ou de révision' },
          },
        };
        return acc;
      }, []),
    ),
  };
  await app.register(swagger, {
    mode: 'static',
    specification: { document: document as OpenAPIV3.Document },
  });
  await app.register(swaggerUI, { routePrefix: '/api/docs' });

  app.get('/api/health', async () => ({ status: 'ok', service: 'dashgrid' }));
  app.get('/api/v1/dashboard', async (_request, reply) =>
    reply.header('ETag', `"${store.revision()}"`).send(snapshot()),
  );
  app.patch('/api/v1/dashboard', async (request) => {
    const patch = boardSchema.partial().parse(request.body);
    const board = boardSchema.parse({ ...store.board(), ...patch });
    checkLayout(board);
    store.transaction(() => {
      store.setBoard(board);
      store.bump();
    });
    broadcast();
    return snapshot();
  });
  app.post('/api/v1/tiles', async (request, reply) => {
    const tile = tileSchema.parse(request.body);
    if (store.tile(tile.id)) throw new HttpError(409, 'Cet identifiant existe déjà.');
    checkLayout(store.board(), [...store.tiles(), { ...tile, runtime: emptyRuntime(tile) }]);
    store.transaction(() => {
      store.putTile(tile, evaluate(tile, emptyRuntime(tile), Date.now()));
      store.bump();
    });
    broadcast();
    collector.reset(tile.id);
    return reply.code(201).send(protect(store.tile(tile.id)!));
  });
  app.get<{ Params: { id: string } }>('/api/v1/tiles/:id', async (request) =>
    protect(ensureTile(request.params.id)),
  );
  app.post<{ Params: { id: string } }>('/api/v1/tiles/:id/duplicate', async (request, reply) => {
    const original = ensureTile(request.params.id);
    const body = z.object({ id: z.string(), layout: layoutSchema }).strict().parse(request.body);
    const tile = tileSchema.parse({
      ...configOf(original),
      ...body,
      content: { ...original.content, title: `${original.content.title.slice(0, 111)} (copie)` },
      demo: false,
    });
    if (store.tile(tile.id)) throw new HttpError(409, 'Cet identifiant existe déjà.');
    checkLayout(store.board(), [...store.tiles(), { ...tile, runtime: original.runtime }]);
    store.transaction(() => {
      store.putTile(tile, { ...original.runtime, pending: {} });
      store.bump();
    });
    broadcast();
    return reply.code(201).send(protect(store.tile(tile.id)!));
  });
  app.patch<{ Params: { id: string } }>('/api/v1/tiles/:id', async (request) => {
    const old = ensureTile(request.params.id);
    const patch = z.record(z.unknown()).parse(request.body);
    if (patch.id !== undefined && patch.id !== old.id)
      throw new HttpError(400, 'L’identifiant ne peut pas être modifié.');
    // Merge named configuration objects while keeping schema validation strict.
    const merged: Record<string, unknown> = { ...configOf(old), demo: false, ...patch };
    for (const key of ['layout', 'content', 'source', 'appearance', 'thresholds'] as const) {
      if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
        const part = patch[key] as Record<string, unknown>;
        merged[key] =
          key === 'source' && part.type !== undefined && part.type !== old.source.type
            ? part
            : { ...old[key], ...part };
      }
    }
    const appearance = merged.appearance as Tile['appearance'];
    if (appearance?.colors)
      merged.appearance = {
        ...appearance,
        colors: { ...old.appearance.colors, ...appearance.colors },
      };
    const tile = tileSchema.parse(merged);
    checkLayout(
      store.board(),
      store.tiles().map((item) => (item.id === tile.id ? { ...tile, runtime: old.runtime } : item)),
    );
    const rulesChanged =
      JSON.stringify(old.thresholds) !== JSON.stringify(tile.thresholds) ||
      old.appearance.mode !== tile.appearance.mode;
    const sourceChanged = JSON.stringify(old.source) !== JSON.stringify(tile.source);
    let runtime = sourceChanged
      ? emptyRuntime(tile)
      : { ...old.runtime, ...(rulesChanged ? { activeRuleId: null, pending: {} } : {}) };
    const receivedAt = runtime.receivedAt;
    const fresh =
      receivedAt !== null && Date.now() - receivedAt < tile.thresholds.staleAfterSeconds * 1000;
    runtime = evaluate(
      tile,
      runtime,
      Date.now(),
      rulesChanged && fresh ? (runtime.data ?? undefined) : undefined,
    );
    runtime.receivedAt = receivedAt;
    runtime = evaluate(tile, runtime, Date.now());
    store.transaction(() => {
      store.putTile(tile, runtime);
      store.bump();
    });
    if (sourceChanged) collector.reset(tile.id);
    broadcast();
    return protect(store.tile(tile.id)!);
  });
  app.delete<{ Params: { id: string } }>('/api/v1/tiles/:id', async (request, reply) => {
    ensureTile(request.params.id);
    store.transaction(() => {
      store.deleteTile(request.params.id);
      store.bump();
    });
    collector.reset(request.params.id);
    broadcast();
    return reply.code(204).send();
  });
  app.put('/api/v1/layout', async (request) => {
    const { tiles } = layoutBody.parse(request.body);
    if (new Set(tiles.map((tile) => tile.id)).size !== tiles.length)
      throw new HttpError(400, 'Identifiants de tuiles dupliqués.');
    for (const tile of tiles) ensureTile(tile.id);
    const updated = store.tiles().map((tile) => {
      const position = tiles.find((position) => position.id === tile.id);
      if (!position) return tile;
      const { id: _, ...layout } = position;
      return { ...tile, layout: layoutSchema.parse(layout) };
    });
    checkLayout(store.board(), updated);
    store.transaction(() => {
      for (const tile of updated) store.putTile(configOf(tile), tile.runtime);
      store.bump();
    });
    broadcast();
    return snapshot();
  });
  app.post<{ Params: { id: string } }>('/api/v1/tiles/:id/data', async (request) => {
    const tile = ensureTile(request.params.id);
    if (tile.source.type !== 'push')
      throw new HttpError(409, 'Cette tuile est alimentée par collecte HTTP.');
    const data = dataSchema.parse(request.body);
    if (tile.demo)
      store.transaction(() => {
        store.putTile({ ...configOf(tile), demo: false }, tile.runtime);
        store.bump();
      });
    return ingest(tile.id, data);
  });
  app.post<{ Params: { id: string } }>('/api/v1/tiles/:id/preview', async (request) => {
    const body = z
      .object({ data: dataSchema, tile: tileSchema.optional() })
      .strict()
      .parse(request.body);
    const tile = body.tile ?? configOf(ensureTile(request.params.id));
    return evaluate(tile, emptyRuntime(tile), Date.now(), body.data);
  });
  app.get('/api/v1/events', (request, reply) => {
    if (clients.size >= 100) return reply.code(503).send({ error: 'Trop de connexions actives.' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    clients.add(reply.raw);
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 20000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(reply.raw);
    });
  });

  const publicDir = options.publicDir ?? resolve('dist/public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      maxAge: '1h',
      setHeaders: (response, path) => {
        if (path.endsWith('/index.html')) response.header('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/') || request.url.includes('.')
        ? reply.code(404).send({ error: 'Ressource introuvable.' })
        : reply.header('Cache-Control', 'no-cache').sendFile('index.html'),
    );
  }
  const timer =
    options.scheduler === false
      ? undefined
      : setInterval(() => {
          let changed = false;
          const now = Date.now();
          for (const tile of store.tiles()) {
            if (tile.demo && now - (tile.runtime.receivedAt ?? 0) >= 10000) {
              store.setRuntime(
                tile.id,
                evaluate(tile, tile.runtime, now, tile.runtime.data ?? { value: 'Démo' }),
              );
              changed = true;
            } else {
              const next = evaluate(tile, tile.runtime, now);
              if (JSON.stringify(next) !== JSON.stringify(tile.runtime)) {
                store.setRuntime(tile.id, next);
                changed = true;
              }
            }
          }
          if (changed) broadcast();
          collector.tick(now);
        }, 1000);
  app.addHook('onClose', async () => {
    clearInterval(timer);
    collector.stop();
    for (const client of clients) client.end();
    store.close();
  });
  app.addHook('preClose', async () => {
    for (const client of clients) client.end();
  });
  return { app, store, collector, ingest };
}
