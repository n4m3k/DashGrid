import { z } from 'zod';

export const palette = {
  ok: '#88d8b0',
  warning: '#ffcc5c',
  critical: '#ff6f69',
  unknown: '#9ca3ab',
  info: '#57c0ff',
};
export const stateSchema = z.enum(['ok', 'warning', 'critical', 'unknown', 'info']);
export type State = z.infer<typeof stateSchema>;
const colorSchema = z.string().regex(/^#[\da-f]{6}$/i, 'Couleur attendue : #RRGGBB');
export const conditionSchema = z
  .object({
    operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between']),
    value: z.union([z.number().finite(), z.string().max(1000), z.boolean()]),
    max: z.number().finite().optional(),
  })
  .strict()
  .superRefine((condition, ctx) => {
    if (
      ['gt', 'gte', 'lt', 'lte', 'between'].includes(condition.operator) &&
      typeof condition.value !== 'number'
    ) {
      ctx.addIssue({ code: 'custom', message: 'Cette comparaison demande une valeur numérique.' });
    }
    if (
      condition.operator === 'between' &&
      (condition.max === undefined || condition.max < Number(condition.value))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Un intervalle demande une borne maximale supérieure ou égale.',
      });
    }
  });
export type Condition = z.infer<typeof conditionSchema>;
export const ruleSchema = z
  .object({
    id: z.string().min(1).max(80),
    state: z.enum(['warning', 'critical', 'info']),
    enter: conditionSchema,
    exit: conditionSchema.optional(),
    holdSeconds: z.number().int().min(0).max(86400).default(0),
  })
  .strict();
export type Rule = z.infer<typeof ruleSchema>;
export const layoutSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .strict();
export const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('push') }).strict(),
  z
    .object({
      type: z.literal('http'),
      url: z
        .string()
        .url()
        .max(2048)
        .refine((value) => {
          const url = new URL(value);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
        }, 'URL HTTP(S) sans identifiants attendue ; utiliser les en-têtes pour l’authentification'),
      intervalSeconds: z.number().int().min(5).max(86400).default(30),
      timeoutSeconds: z.number().int().min(1).max(60).default(10),
      valuePath: z.string().max(200).default('value'),
      messagePath: z.string().max(200).default(''),
      statusPath: z.string().max(200).optional(),
      headers: z.record(z.string().max(4096)).default({}),
    })
    .strict(),
]);
export const tileSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    layout: layoutSchema,
    content: z
      .object({
        type: z.enum(['metric', 'text', 'status', 'progress']).default('metric'),
        title: z.string().min(1).max(120),
        subtitle: z.string().max(250).default(''),
        unit: z.string().max(20).default(''),
        icon: z
          .enum(['server', 'activity', 'database', 'globe', 'git', 'clock', 'shield', 'cloud'])
          .default('activity'),
        min: z.number().finite().default(0),
        max: z.number().finite().default(100),
      })
      .strict()
      .refine((v) => v.max > v.min, 'Le maximum doit dépasser le minimum.'),
    source: sourceSchema.default({ type: 'push' }),
    appearance: z
      .object({
        mode: z.enum(['fixed', 'thresholds']).default('thresholds'),
        fixedColor: colorSchema.default(palette.info),
        colors: z
          .object({
            ok: colorSchema.default(palette.ok),
            warning: colorSchema.default(palette.warning),
            critical: colorSchema.default(palette.critical),
            unknown: colorSchema.default(palette.unknown),
            info: colorSchema.default(palette.info),
          })
          .strict()
          .default(palette),
      })
      .strict()
      .default({}),
    thresholds: z
      .object({
        field: z.enum(['value', 'status']).default('value'),
        staleAfterSeconds: z.number().int().min(5).max(604800).default(120),
        defaultState: z.enum(['ok', 'info']).default('ok'),
        rules: z.array(ruleSchema).max(20).default([]),
      })
      .strict()
      .default({}),
    demo: z.boolean().default(false),
  })
  .strict()
  .superRefine((tile, ctx) => {
    if (
      new Set(tile.thresholds.rules.map((rule) => rule.id)).size !== tile.thresholds.rules.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['thresholds', 'rules'],
        message: 'Chaque règle doit avoir un identifiant unique.',
      });
    }
  });
export type Tile = z.infer<typeof tileSchema>;
export const dataSchema = z
  .object({
    value: z.union([z.number().finite(), z.string().max(4000), z.boolean()]).optional(),
    status: z.string().max(120).optional(),
    message: z.string().max(4000).optional(),
  })
  .strict()
  .refine(
    (v) => v.value !== undefined || v.status !== undefined || v.message !== undefined,
    'Une donnée au moins est requise.',
  );
export type TileData = z.infer<typeof dataSchema>;
export interface Runtime {
  data: TileData | null;
  receivedAt: number | null;
  state: State;
  color: string;
  reason: string;
  activeRuleId: string | null;
  pending: Record<string, number>;
  error: string | null;
}
export const boardSchema = z
  .object({
    title: z.string().min(1).max(100).default('Infrastructure'),
    columns: z.number().int().min(1).max(24).default(6),
    rows: z.number().int().min(1).max(24).default(4),
    theme: z.enum(['pastel', 'outline']).default('pastel'),
  })
  .strict();
export type Board = z.infer<typeof boardSchema>;
export interface TileView extends Tile {
  runtime: Runtime;
}
export interface Snapshot {
  board: Board;
  tiles: TileView[];
  revision: number;
  authRequired: boolean;
}
