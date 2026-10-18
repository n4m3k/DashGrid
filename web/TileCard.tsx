import {
  Activity,
  Cloud,
  Database,
  GitBranch,
  Globe,
  Server,
  ShieldCheck,
  Clock3,
  GripVertical,
  Pencil,
  Copy,
  Trash2,
  CircleAlert,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { TileView } from '../shared/model';
import { TileId } from './TileId';

export const icons = {
  server: Server,
  activity: Activity,
  database: Database,
  globe: Globe,
  git: GitBranch,
  clock: Clock3,
  shield: ShieldCheck,
  cloud: Cloud,
};
export const stateLabels = {
  ok: 'Normal',
  warning: 'Attention',
  critical: 'Critique',
  unknown: 'Inconnu',
  info: 'Information',
};
function inkFor(color: string) {
  const rgb = [1, 3, 5]
    .map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return luminance > 0.22 ? '#11263a' : '#f8f8f2';
}
function age(timestamp: number | null, now: number) {
  if (timestamp === null) return 'Aucune donnée';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return 'À l’instant';
  if (seconds < 60) return `Il y a ${seconds} s`;
  if (seconds < 3600) return `Il y a ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Il y a ${Math.floor(seconds / 3600)} h`;
  return `Il y a ${Math.floor(seconds / 86400)} j`;
}
export function TileCard({
  tile,
  editing,
  now,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  tile: TileView;
  editing: boolean;
  now: number;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const Icon = icons[tile.content.icon];
  const { runtime, content } = tile;
  const value = runtime.data?.value ?? runtime.data?.status;
  const formatted =
    typeof value === 'number'
      ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
      : typeof value === 'boolean'
        ? value
          ? 'Oui'
          : 'Non'
        : (value ?? '—');
  const progress =
    typeof value === 'number'
      ? Math.max(0, Math.min(100, ((value - content.min) / (content.max - content.min)) * 100))
      : 0;
  return (
    <article
      className={`tile tile-${content.type === 'progress' ? 'progress-card' : content.type} ${editing ? 'tile-editing' : ''}`}
      style={
        { '--tile-color': runtime.color, '--tile-ink': inkFor(runtime.color) } as CSSProperties
      }
      aria-label={`${content.title} — ${stateLabels[runtime.state]}`}
    >
      <TileId id={tile.id} className="tile-identity-corner" />
      <div className="tile-heading">
        <h2>{content.title}</h2>
        <p>{content.subtitle}</p>
      </div>
      {editing && (
        <div className="tile-tools">
          <span className="drag-handle" title="Déplacer la tuile">
            <GripVertical size={16} />
          </span>
          <button aria-label={`Modifier ${content.title}`} title="Modifier" onClick={onEdit}>
            <Pencil size={14} />
          </button>
          <button aria-label={`Dupliquer ${content.title}`} title="Dupliquer" onClick={onDuplicate}>
            <Copy size={14} />
          </button>
          <button aria-label={`Supprimer ${content.title}`} title="Supprimer" onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
      <div className="tile-value">
        <span>{formatted}</span>
        {content.unit && <small>{content.unit}</small>}
      </div>
      {runtime.data?.message && <p className="tile-message">{runtime.data.message}</p>}
      <div className="tile-bottom">
        <div className="tile-state" title={runtime.reason}>
          <Icon className="tile-icon" strokeWidth={1.7} />
          <span>
            {runtime.error && <CircleAlert size={12} />}
            {stateLabels[runtime.state]}
          </span>
        </div>
        <div className="tile-age">
          {tile.demo && <b>DÉMO</b>}
          <time
            dateTime={runtime.receivedAt ? new Date(runtime.receivedAt).toISOString() : undefined}
          >
            {age(runtime.receivedAt, now)}
          </time>
        </div>
      </div>
      {content.type === 'progress' && (
        <div
          className="tile-progress"
          role="progressbar"
          aria-label={content.title}
          aria-valuenow={typeof value === 'number' ? value : undefined}
          aria-valuemin={content.min}
          aria-valuemax={content.max}
        >
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </article>
  );
}
