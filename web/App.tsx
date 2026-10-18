import { useEffect, useRef, useState, type FormEvent } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Code2,
  Grid2X2,
  Maximize2,
  Minimize2,
  Moon,
  Pencil,
  Plus,
  Settings2,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import { tileSchema, type Board, type Snapshot, type Tile, type TileView } from '../shared/model';
import { api } from './api';
import { Editor } from './Editor';
import { Modal } from './Modal';
import { TileCard } from './TileCard';
import { randomIdSuffix } from './ids';

function freeSpot(snapshot: Snapshot, w = 2, h = 1) {
  w = Math.min(w, snapshot.board.columns);
  for (let y = 0; y <= snapshot.board.rows - h; y++)
    for (let x = 0; x <= snapshot.board.columns - w; x++) {
      if (
        snapshot.tiles.every(
          ({ layout: b }) => x >= b.x + b.w || x + w <= b.x || y >= b.y + b.h || y + h <= b.y,
        )
      )
        return { x, y, w, h };
    }
  return null;
}
function withoutRuntime({ runtime: _, ...tile }: TileView): Tile {
  return tile;
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [failure, setFailure] = useState('');
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<{ tile: Tile; creating: boolean; revision: number } | null>(
    null,
  );
  const [settings, setSettings] = useState<{ board: Board; revision: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TileView | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight - 122 });
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragRevision = useRef(0);
  const latest = useRef<Snapshot | null>(null);
  const showToast = (text: string, error = false) => setToast({ text, error });
  const receive = (next: Snapshot) => {
    if (latest.current && next.revision < latest.current.revision) return;
    latest.current = next;
    if (!dragging.current) setSnapshot(next);
  };
  async function refresh() {
    try {
      receive(await api<Snapshot>('/dashboard'));
    } catch (error) {
      showToast((error as Error).message, true);
    }
  }
  useEffect(() => {
    let alive = true;
    api<Snapshot>('/dashboard')
      .then((next) => {
        if (alive) {
          receive(next);
          setFailure('');
        }
      })
      .catch((error) => {
        if (alive) setFailure(error.message);
      });
    const events = new EventSource('/api/v1/events');
    events.onopen = () => {
      setConnected(true);
      setFailure('');
    };
    events.onerror = () => setConnected(false);
    events.addEventListener('snapshot', (event) => {
      receive(JSON.parse(event.data));
      setFailure('');
    });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      alive = false;
      events.close();
      clearInterval(clock);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);
  useEffect(() => {
    if (!gridRef.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(gridRef.current);
    return () => observer.disconnect();
  }, [Boolean(snapshot)]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function startEditing() {
    if (snapshot?.authRequired && !sessionStorage.getItem('dashgrid-key')) {
      setKeyModal(true);
      return;
    }
    setEditing((value) => !value);
  }
  async function makeRoom(w = 2, h = 1): Promise<{ snapshot: Snapshot; layout: Tile['layout'] }> {
    let current = latest.current!;
    let layout = freeSpot(current, w, h);
    if (!layout) {
      if (current.board.rows + h > 24)
        throw new Error(
          'Grille pleine : libérez un emplacement ou augmentez le nombre de colonnes.',
        );
      current = await api<Snapshot>(
        '/dashboard',
        'PATCH',
        { rows: current.board.rows + h },
        current.revision,
      );
      receive(current);
      layout = freeSpot(current, w, h);
    }
    if (!layout) throw new Error('Aucun emplacement disponible.');
    return { snapshot: current, layout };
  }
  async function addTile() {
    try {
      const { snapshot: current, layout } = await makeRoom();
      const tile = tileSchema.parse({
        id: `tuile-${randomIdSuffix()}`,
        layout,
        content: { title: 'Nouvelle tuile' },
      });
      setEditor({ tile, creating: true, revision: current.revision });
    } catch (error) {
      showToast((error as Error).message, true);
    }
  }
  async function duplicate(tile: TileView) {
    try {
      const { snapshot: current, layout } = await makeRoom(tile.layout.w, tile.layout.h);
      await api(
        `/tiles/${tile.id}/duplicate`,
        'POST',
        { id: `${tile.id.slice(0, 60)}-${randomIdSuffix()}`, layout },
        current.revision,
      );
      await refresh();
      showToast('Tuile dupliquée');
    } catch (error) {
      showToast((error as Error).message, true);
    }
  }
  async function saveLayout(layout: Layout[], original?: Layout, moved?: Layout) {
    if (original && moved && snapshot) {
      const overlaps = snapshot.tiles.filter(
        (tile) =>
          tile.id !== moved.i &&
          moved.x < tile.layout.x + tile.layout.w &&
          moved.x + moved.w > tile.layout.x &&
          moved.y < tile.layout.y + tile.layout.h &&
          moved.y + moved.h > tile.layout.y,
      );
      const target = overlaps[0];
      if (
        overlaps.length === 1 &&
        target.layout.w === moved.w &&
        target.layout.h === moved.h &&
        target.layout.x === moved.x &&
        target.layout.y === moved.y
      ) {
        layout = layout.map((item) =>
          item.i === target.id ? { ...item, x: original.x, y: original.y } : item,
        );
      }
    }
    const changed = layout.some((item) => {
      const original = snapshot?.tiles.find((tile) => tile.id === item.i)?.layout;
      return (
        !original ||
        original.x !== item.x ||
        original.y !== item.y ||
        original.w !== item.w ||
        original.h !== item.h
      );
    });
    if (!changed) {
      dragging.current = false;
      if (latest.current) setSnapshot(latest.current);
      return;
    }
    try {
      const next = await api<Snapshot>(
        '/layout',
        'PUT',
        { tiles: layout.map(({ i, x, y, w, h }) => ({ id: i, x, y, w, h })) },
        dragRevision.current,
      );
      dragging.current = false;
      receive(next);
      showToast('Disposition enregistrée');
    } catch (error) {
      dragging.current = false;
      await refresh();
      showToast((error as Error).message, true);
    }
  }
  async function toggleTheme() {
    if (!snapshot) return;
    try {
      receive(
        await api<Snapshot>(
          '/dashboard',
          'PATCH',
          { theme: snapshot.board.theme === 'pastel' ? 'outline' : 'pastel' },
          snapshot.revision,
        ),
      );
    } catch (error) {
      showToast((error as Error).message, true);
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      showToast('Le plein écran n’est pas disponible dans ce navigateur.', true);
    }
  }
  if (!snapshot)
    return (
      <main className="loading-screen">
        <div className="brand-mark">
          <i />
          <i />
          <i />
        </div>
        <h1>
          dashgrid<span>.</span>
        </h1>
        <p>{failure || 'Connexion à votre dashboard…'}</p>
        {failure && (
          <button className="button secondary" onClick={() => window.location.reload()}>
            Réessayer
          </button>
        )}
      </main>
    );
  const { board, tiles } = snapshot;
  const mobile = size.width < 760;
  const counts = {
    critical: tiles.filter((tile) => tile.runtime.state === 'critical').length,
    warning: tiles.filter((tile) => tile.runtime.state === 'warning').length,
    ok: tiles.filter((tile) => tile.runtime.state === 'ok').length,
  };
  const card = (tile: TileView) => (
    <TileCard
      tile={tile}
      editing={editing}
      now={now}
      onEdit={() =>
        setEditor({ tile: withoutRuntime(tile), creating: false, revision: snapshot.revision })
      }
      onDuplicate={() => void duplicate(tile)}
      onDelete={() => setDeleteTarget(tile)}
    />
  );

  return (
    <main className={`app theme-${board.theme} ${fullscreen ? 'is-fullscreen' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>
            dashgrid<b>.</b>
          </span>
        </div>
        <span className="header-divider" />
        <div className="board-title">
          <h1>{board.title}</h1>
          <span>SUPERVISION EN TEMPS RÉEL</span>
        </div>
        <div className="header-right">
          <span
            className={`connection ${connected ? '' : 'offline'}`}
            title={connected ? 'Flux temps réel connecté' : 'Reconnexion automatique en cours'}
          >
            {connected ? <i /> : <WifiOff size={12} />}
            {connected ? 'En direct' : 'Reconnexion'}
          </span>
          <button
            className={`button edit-button ${editing ? 'active' : ''}`}
            onClick={() => void startEditing()}
          >
            {editing ? <Check size={15} /> : <Pencil size={14} />}
            <span>{editing ? 'Terminer' : 'Modifier'}</span>
          </button>
          <div className="header-icons">
            <button
              className="icon-button"
              aria-label="Changer de thème"
              title="Changer de thème"
              onClick={() => void toggleTheme()}
            >
              {board.theme === 'pastel' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              className="icon-button"
              aria-label="Paramètres du dashboard"
              title="Paramètres"
              onClick={() => setSettings({ board: { ...board }, revision: snapshot.revision })}
            >
              <Settings2 size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Plein écran"
              title="Plein écran"
              onClick={() => void toggleFullscreen()}
            >
              <Maximize2 size={18} />
            </button>
          </div>
        </div>
      </header>
      {editing && (
        <div className="edit-banner">
          <div>
            <GripIcon />
            <span>
              <b>Mode édition</b>
              <span className="edit-hint">
                {' '}
                · Déplacez les tuiles, étirez leurs coins ou modifiez leur contenu.
              </span>
            </span>
          </div>
          <button className="button primary small" onClick={() => void addTile()}>
            <Plus size={16} />
            Ajouter une tuile
          </button>
        </div>
      )}
      {!connected && (
        <div className="offline-banner">
          <WifiOff size={14} />
          Connexion interrompue. Les dernières données restent affichées ; reconnexion automatique
          en cours.
        </div>
      )}
      <div className="grid-space" ref={gridRef}>
        {tiles.length === 0 ? (
          <div className="empty-dashboard">
            <Grid2X2 size={42} strokeWidth={1.2} />
            <h2>Votre premier regard sur l’essentiel.</h2>
            <p>Ajoutez une tuile pour commencer à superviser vos services.</p>
            <button
              className="button primary"
              onClick={() => {
                setEditing(true);
                void addTile();
              }}
            >
              <Plus size={17} />
              Créer une tuile
            </button>
          </div>
        ) : mobile ? (
          <div className="mobile-grid">
            {[...tiles]
              .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
              .map((tile) => (
                <div key={tile.id}>{card(tile)}</div>
              ))}
          </div>
        ) : (
          <GridLayout
            width={size.width}
            cols={board.columns}
            rowHeight={Math.max(110, (size.height - 6 * (board.rows + 1)) / board.rows)}
            layout={tiles.map((tile) => ({ i: tile.id, ...tile.layout }))}
            margin={[6, 6]}
            containerPadding={[6, 6]}
            maxRows={board.rows}
            isBounded
            compactType={null}
            allowOverlap={editing}
            isDraggable={editing}
            isResizable={editing}
            draggableHandle=".drag-handle"
            resizeHandles={['se']}
            useCSSTransforms
            onDragStart={() => {
              dragging.current = true;
              dragRevision.current = snapshot.revision;
            }}
            onResizeStart={() => {
              dragging.current = true;
              dragRevision.current = snapshot.revision;
            }}
            onDragStop={(layout, original, moved) => void saveLayout(layout, original, moved)}
            onResizeStop={(layout) => void saveLayout(layout)}
          >
            {tiles.map((tile) => (
              <div key={tile.id}>{card(tile)}</div>
            ))}
          </GridLayout>
        )}
      </div>
      <footer className="statusbar">
        <div>
          <span className="footer-label">ÉTAT GLOBAL</span>
          {counts.critical > 0 && (
            <span>
              <i className="status-dot critical" />
              {counts.critical} critique{counts.critical > 1 ? 's' : ''}
            </span>
          )}
          {counts.warning > 0 && (
            <span>
              <i className="status-dot warning" />
              {counts.warning} attention
            </span>
          )}
          <span>
            <i className="status-dot ok" />
            {counts.ok} normal{counts.ok > 1 ? 'es' : ''}
          </span>
        </div>
        <div>
          <span>{tiles.length} tuiles</span>
          <span className="footer-separator">/</span>
          {tiles.some((tile) => tile.demo) && <span className="demo-label">Démonstration</span>}
          <a href="/api/docs" target="_blank" rel="noreferrer">
            <Code2 size={13} />
            API
            <ArrowUpRight size={11} />
          </a>
          <time>
            {new Intl.DateTimeFormat('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }).format(now)}
          </time>
        </div>
      </footer>
      {fullscreen && (
        <button
          className="exit-fullscreen button secondary"
          onClick={() => void toggleFullscreen()}
        >
          <Minimize2 size={15} />
          Quitter le plein écran
        </button>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleAlert size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button aria-label="Fermer la notification" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {editor && (
        <Editor
          initial={editor.tile}
          creating={editor.creating}
          revision={editor.revision}
          onClose={() => setEditor(null)}
          onSaved={(warning) => {
            void refresh();
            showToast(warning || 'Tuile enregistrée', Boolean(warning));
          }}
        />
      )}
      {settings && (
        <BoardSettings
          initial={settings.board}
          revision={settings.revision}
          onClose={() => setSettings(null)}
          onSaved={(next) => {
            receive(next);
            setSettings(null);
            showToast('Dashboard enregistré');
          }}
        />
      )}
      {deleteTarget && (
        <Modal title="Supprimer cette tuile ?" onClose={() => setDeleteTarget(null)}>
          <div className="modal-body">
            <p>
              La tuile <strong>{deleteTarget.content.title}</strong> et sa configuration seront
              supprimées.
            </p>
          </div>
          <footer className="modal-footer">
            <button className="button secondary" onClick={() => setDeleteTarget(null)}>
              Annuler
            </button>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await api(`/tiles/${deleteTarget.id}`, 'DELETE', undefined, snapshot.revision);
                  setDeleteTarget(null);
                  await refresh();
                  showToast('Tuile supprimée');
                } catch (error) {
                  showToast((error as Error).message, true);
                }
              }}
            >
              Supprimer
            </button>
          </footer>
        </Modal>
      )}
      {keyModal && (
        <Modal title="Accès à l’édition" onClose={() => setKeyModal(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              sessionStorage.setItem('dashgrid-key', keyInput);
              setKeyModal(false);
              setEditing(true);
            }}
          >
            <div className="modal-body">
              <p>Ce dashboard utilise une clé API pour les modifications.</p>
              <label>
                Clé API
                <input
                  type="password"
                  autoFocus
                  required
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                />
              </label>
              <p className="help">La clé est conservée uniquement dans cet onglet.</p>
            </div>
            <footer className="modal-footer">
              <button className="button primary" type="submit">
                Continuer
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </main>
  );
}

function GripIcon() {
  return <Grid2X2 size={16} />;
}
function BoardSettings({
  initial,
  revision,
  onClose,
  onSaved,
}: {
  initial: Board;
  revision: number;
  onClose: () => void;
  onSaved: (next: Snapshot) => void;
}) {
  const [board, setBoard] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await api<Snapshot>('/dashboard', 'PATCH', board, revision));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Paramètres du dashboard" eyebrow="PERSONNALISATION" onClose={onClose}>
      <form onSubmit={save}>
        <div className="modal-body">
          <label>
            Nom du dashboard
            <input
              autoFocus
              required
              maxLength={100}
              value={board.title}
              onChange={(event) => setBoard({ ...board, title: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              Colonnes
              <input
                type="number"
                min={1}
                max={24}
                required
                value={board.columns}
                onChange={(event) => setBoard({ ...board, columns: Number(event.target.value) })}
              />
            </label>
            <label>
              Lignes
              <input
                type="number"
                min={1}
                max={24}
                required
                value={board.rows}
                onChange={(event) => setBoard({ ...board, rows: Number(event.target.value) })}
              />
            </label>
          </div>
          <label>
            Thème
            <select
              value={board.theme}
              onChange={(event) =>
                setBoard({ ...board, theme: event.target.value as Board['theme'] })
              }
            >
              <option value="pastel">Monitoror · Pastel</option>
              <option value="outline">Monitoror · Sombre, bordures colorées</option>
            </select>
          </label>
          <p className="help">
            La grille doit contenir toutes les tuiles existantes. Les positions sont conservées.
          </p>
          <label className="help">
            Clé d’édition (facultatif)
            <input
              type="password"
              placeholder="Remplacer la clé pour cet onglet"
              onChange={(event) => {
                if (event.target.value) sessionStorage.setItem('dashgrid-key', event.target.value);
                else sessionStorage.removeItem('dashgrid-key');
              }}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
