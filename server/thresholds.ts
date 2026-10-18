import type { Condition, Runtime, State, Tile, TileData } from '../shared/model.js';

const priority: Record<State, number> = { critical: 3, warning: 2, info: 1, ok: 0, unknown: -1 };
export function matches(value: unknown, condition: Condition): boolean {
  switch (condition.operator) {
    case 'eq':
      return value === condition.value;
    case 'neq':
      return value !== undefined && value !== condition.value;
    default:
      if (
        typeof value !== 'number' ||
        typeof condition.value !== 'number' ||
        !Number.isFinite(value)
      )
        return false;
      switch (condition.operator) {
        case 'gt':
          return value > condition.value;
        case 'gte':
          return value >= condition.value;
        case 'lt':
          return value < condition.value;
        case 'lte':
          return value <= condition.value;
        case 'between':
          return value >= condition.value && value <= condition.max!;
      }
  }
}
export function emptyRuntime(tile: Tile): Runtime {
  return {
    data: null,
    receivedAt: null,
    state: 'unknown',
    color: tile.appearance.colors.unknown,
    reason: 'En attente de données',
    activeRuleId: null,
    pending: {},
    error: null,
  };
}
export function evaluate(
  tile: Tile,
  previous: Runtime,
  now: number,
  incoming?: TileData,
  error?: string,
): Runtime {
  const next: Runtime = structuredClone(previous);
  const wasStale =
    previous.receivedAt === null ||
    now - previous.receivedAt >= tile.thresholds.staleAfterSeconds * 1000;
  if (incoming) {
    next.data = incoming;
    next.receivedAt = now;
    next.error = null;
    if (wasStale || previous.error) {
      next.pending = {};
      next.activeRuleId = null;
    }
  }
  if (error) next.error = error;
  const stale =
    next.receivedAt === null || now - next.receivedAt >= tile.thresholds.staleAfterSeconds * 1000;
  const field = next.data?.[tile.thresholds.field];
  const invalidField =
    tile.appearance.mode === 'thresholds' &&
    tile.thresholds.rules.length > 0 &&
    (field === undefined ||
      !tile.thresholds.rules.some((rule) => typeof field === typeof rule.enter.value));
  if (next.error || stale || invalidField) {
    next.state = 'unknown';
    next.reason =
      next.error ||
      (stale
        ? next.receivedAt
          ? 'Données périmées'
          : 'En attente de données'
        : 'Champ de seuil absent ou invalide');
    next.activeRuleId = null;
    next.pending = {};
  } else if (incoming) {
    // Only fresh samples advance confirmation timers. Silence never confirms a threshold.
    const rules = [...tile.thresholds.rules].sort((a, b) => priority[b.state] - priority[a.state]);
    for (const rule of rules) {
      for (const [kind, condition] of [
        ['enter', rule.enter],
        ['exit', rule.exit],
      ] as const) {
        const key = `${rule.id}:${kind}`;
        if (condition && matches(field, condition)) next.pending[key] ??= now;
        else delete next.pending[key];
      }
    }
    const confirmed = (id: string, kind: string, seconds: number) => {
      const start = next.pending[`${id}:${kind}`];
      return start !== undefined && now - start >= seconds * 1000;
    };
    const active = rules.find((rule) => rule.id === next.activeRuleId);
    const retained =
      active &&
      (active.exit
        ? !confirmed(active.id, 'exit', active.holdSeconds)
        : matches(field, active.enter));
    const candidates = rules.filter((rule) => confirmed(rule.id, 'enter', rule.holdSeconds));
    if (retained) candidates.push(active);
    const winner = candidates.sort((a, b) => priority[b.state] - priority[a.state])[0];
    next.state = winner?.state ?? tile.thresholds.defaultState;
    next.activeRuleId = winner?.id ?? null;
    next.reason = winner
      ? `Règle « ${winner.id} »`
      : Object.keys(next.pending).some((key) => key.endsWith(':enter'))
        ? 'Confirmation du seuil en cours'
        : 'Aucun seuil dépassé';
  }
  next.color =
    tile.appearance.mode === 'fixed'
      ? tile.appearance.fixedColor
      : tile.appearance.colors[next.state];
  return next;
}
