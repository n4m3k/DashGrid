import { useState, type FormEvent } from 'react';
import { Plus, Trash2, ChevronRight, Play, Check, Save } from 'lucide-react';
import {
  tileSchema,
  dataSchema,
  palette,
  type Tile,
  type TileData,
  type Runtime,
  type Rule,
  type Condition,
} from '../shared/model';
import { api } from './api';
import { Modal } from './Modal';
import { stateLabels, icons } from './TileCard';
import { TileId } from './TileId';
import { randomIdSuffix } from './ids';

const operators: Record<Condition['operator'], string> = {
  gte: '≥ Supérieur ou égal',
  gt: '> Supérieur',
  lte: '≤ Inférieur ou égal',
  lt: '< Inférieur',
  eq: '= Égal',
  neq: '≠ Différent',
  between: 'Entre (inclus)',
};
function scalar(text: string): string | number | boolean {
  if (text === 'true') return true;
  if (text === 'false') return false;
  const numeric = text.trim().replace(',', '.');
  return numeric !== '' && Number.isFinite(Number(numeric)) ? Number(numeric) : text;
}
function ConditionFields({
  value,
  onChange,
  label,
}: {
  value: Condition;
  onChange: (value: Condition) => void;
  label: string;
}) {
  return (
    <div className="condition-row">
      <label>
        {label}
        <select
          aria-label={`${label} : opérateur`}
          value={value.operator}
          onChange={(event) =>
            onChange({ ...value, operator: event.target.value as Condition['operator'] })
          }
        >
          {Object.entries(operators).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valeur
        <input
          aria-label={`${label} : valeur`}
          value={String(value.value)}
          onChange={(event) => onChange({ ...value, value: scalar(event.target.value) })}
        />
      </label>
      {value.operator === 'between' && (
        <label>
          Maximum
          <input
            type="number"
            value={value.max ?? ''}
            onChange={(event) => onChange({ ...value, max: Number(event.target.value) })}
          />
        </label>
      )}
    </div>
  );
}

export function Editor({
  initial,
  creating,
  revision,
  onClose,
  onSaved,
}: {
  initial: Tile;
  creating: boolean;
  revision: number;
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const [draft, setDraft] = useState<Tile>(() => structuredClone(initial));
  const [tab, setTab] = useState('content');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dataValue, setDataValue] = useState('');
  const [dataMessage, setDataMessage] = useState('');
  const [sendData, setSendData] = useState(false);
  const [headersText, setHeadersText] = useState('');
  const [previewValue, setPreviewValue] = useState('85');
  const [preview, setPreview] = useState<Runtime | null>(null);
  const update = (fn: (tile: Tile) => void) =>
    setDraft((old) => {
      const next = structuredClone(old);
      fn(next);
      return next;
    });
  const updateRule = (index: number, patch: Partial<Rule>) =>
    update((tile) => {
      Object.assign(tile.thresholds.rules[index], patch);
    });
  const addRule = () =>
    update((tile) =>
      tile.thresholds.rules.push({
        id: `regle-${randomIdSuffix(6)}`,
        state: 'critical',
        enter: { operator: 'gte', value: 80 },
        exit: { operator: 'lt', value: 75 },
        holdSeconds: 0,
      }),
    );
  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const parsed = tileSchema.parse({ ...draft, demo: false });
      const payload: Record<string, unknown> = structuredClone(parsed);
      if (parsed.source.type === 'http') {
        const source = payload.source as Record<string, unknown>;
        if (headersText.trim()) source.headers = JSON.parse(headersText);
        else if (!creating && initial.source.type === 'http') delete source.headers;
      }
      // Validate pushed data before saving configuration, avoiding preventable partial saves.
      const data: TileData | undefined =
        sendData && parsed.source.type === 'push'
          ? {
              value:
                parsed.content.type === 'text' || parsed.content.type === 'status'
                  ? dataValue
                  : scalar(dataValue),
              message: dataMessage,
            }
          : undefined;
      if (data) dataSchema.parse(data);
      await api(
        creating ? '/tiles' : `/tiles/${initial.id}`,
        creating ? 'POST' : 'PATCH',
        payload,
        revision,
      );
      if (data) {
        try {
          await api(`/tiles/${parsed.id}/data`, 'POST', data);
        } catch (error) {
          onSaved(`Configuration enregistrée, mais données refusées : ${(error as Error).message}`);
          onClose();
          return;
        }
      }
      onSaved();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setError('');
    try {
      const result = await api<Runtime>(`/tiles/${draft.id}/preview`, 'POST', {
        tile: tileSchema.parse(draft),
        data: { [draft.thresholds.field]: scalar(previewValue) },
      });
      setPreview(result);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <Modal
      wide
      title={creating ? 'Nouvelle tuile' : 'Modifier la tuile'}
      eyebrow="CONFIGURATION"
      onClose={onClose}
    >
      <div className="editor-identity">
        <span>Identifiant de la tuile</span>
        <TileId id={draft.id} />
      </div>
      <nav className="editor-tabs" aria-label="Configuration de la tuile">
        {[
          ['content', 'Contenu'],
          ['source', 'Source'],
          ['thresholds', 'Couleurs & seuils'],
        ].map(([id, name]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </nav>
      <form className="editor-form" onSubmit={save}>
        <div className="editor-body">
          {tab === 'content' && (
            <>
              <section className="form-section">
                <h3>Présentation</h3>
                <label>
                  Titre
                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={draft.content.title}
                    onChange={(event) =>
                      update((tile) => {
                        tile.content.title = event.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  Sous-titre
                  <input
                    value={draft.content.subtitle}
                    maxLength={250}
                    onChange={(event) =>
                      update((tile) => {
                        tile.content.subtitle = event.target.value;
                      })
                    }
                  />
                </label>
                <div className="form-row">
                  <label>
                    Type
                    <select
                      value={draft.content.type}
                      onChange={(event) =>
                        update((tile) => {
                          tile.content.type = event.target.value as Tile['content']['type'];
                        })
                      }
                    >
                      <option value="metric">Valeur numérique</option>
                      <option value="text">Texte</option>
                      <option value="status">Statut</option>
                      <option value="progress">Progression</option>
                    </select>
                  </label>
                  <label>
                    Icône
                    <select
                      value={draft.content.icon}
                      onChange={(event) =>
                        update((tile) => {
                          tile.content.icon = event.target.value as keyof typeof icons;
                        })
                      }
                    >
                      {[
                        ['activity', 'Activité'],
                        ['server', 'Serveur'],
                        ['database', 'Base de données'],
                        ['globe', 'Réseau'],
                        ['git', 'Git / build'],
                        ['clock', 'Horloge'],
                        ['shield', 'Protection'],
                        ['cloud', 'Cloud'],
                      ].map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Unité
                    <input
                      placeholder="%, ms, Go…"
                      maxLength={20}
                      value={draft.content.unit}
                      onChange={(event) =>
                        update((tile) => {
                          tile.content.unit = event.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Identifiant
                    <input
                      required
                      readOnly={!creating}
                      pattern="[a-zA-Z0-9_-]{1,80}"
                      value={draft.id}
                      onChange={(event) =>
                        update((tile) => {
                          tile.id = event.target.value;
                        })
                      }
                    />
                  </label>
                </div>
                {draft.content.type === 'progress' && (
                  <div className="form-row">
                    <label>
                      Minimum
                      <input
                        type="number"
                        value={draft.content.min}
                        onChange={(event) =>
                          update((tile) => {
                            tile.content.min = Number(event.target.value);
                          })
                        }
                      />
                    </label>
                    <label>
                      Maximum
                      <input
                        type="number"
                        value={draft.content.max}
                        onChange={(event) =>
                          update((tile) => {
                            tile.content.max = Number(event.target.value);
                          })
                        }
                      />
                    </label>
                  </div>
                )}
              </section>
              <section className="form-section">
                <h3>
                  Emplacement <span>Coordonnées à partir de 1</span>
                </h3>
                <div className="form-row four">
                  {[
                    ['x', 'Colonne'],
                    ['y', 'Ligne'],
                    ['w', 'Largeur'],
                    ['h', 'Hauteur'],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={1}
                        required
                        value={
                          draft.layout[key as keyof Tile['layout']] +
                          (key === 'x' || key === 'y' ? 1 : 0)
                        }
                        onChange={(event) =>
                          update((tile) => {
                            tile.layout[key as keyof Tile['layout']] =
                              Number(event.target.value) - (key === 'x' || key === 'y' ? 1 : 0);
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>
              {draft.source.type === 'push' && (
                <section className="form-section">
                  <h3>Données initiales</h3>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={sendData}
                      onChange={(event) => setSendData(event.target.checked)}
                    />
                    Envoyer une valeur à l’enregistrement
                  </label>
                  {sendData && (
                    <>
                      <label>
                        Valeur
                        <input
                          value={dataValue}
                          maxLength={4000}
                          onChange={(event) => setDataValue(event.target.value)}
                        />
                      </label>
                      <label>
                        Message
                        <textarea
                          value={dataMessage}
                          maxLength={4000}
                          onChange={(event) => setDataMessage(event.target.value)}
                        />
                      </label>
                    </>
                  )}
                </section>
              )}
            </>
          )}
          {tab === 'source' && (
            <>
              <section className="form-section">
                <h3>Alimentation des données</h3>
                <div className="segmented">
                  <button
                    type="button"
                    className={draft.source.type === 'push' ? 'active' : ''}
                    onClick={() =>
                      update((tile) => {
                        tile.source = { type: 'push' };
                      })
                    }
                  >
                    Push API
                  </button>
                  <button
                    type="button"
                    className={draft.source.type === 'http' ? 'active' : ''}
                    onClick={() =>
                      update((tile) => {
                        tile.source = {
                          type: 'http',
                          url: '',
                          intervalSeconds: 30,
                          timeoutSeconds: 10,
                          valuePath: 'value',
                          messagePath: '',
                          headers: {},
                        };
                      })
                    }
                  >
                    Collecte HTTP
                  </button>
                </div>
                {draft.source.type === 'push' ? (
                  <>
                    <p className="help">
                      Vos scripts envoient les données à cette adresse. Chaque envoi remplace les
                      données précédentes.
                    </p>
                    <pre className="code-block">{`POST /api/v1/tiles/${draft.id}/data\n\n{ "value": 42, "message": "Tout va bien" }`}</pre>
                  </>
                ) : (
                  <>
                    <label>
                      URL HTTP(S)
                      <input
                        type="url"
                        placeholder="https://api.example.com/metrics"
                        required
                        value={draft.source.url}
                        onChange={(event) =>
                          update((tile) => {
                            if (tile.source.type === 'http') tile.source.url = event.target.value;
                          })
                        }
                      />
                    </label>
                    <div className="form-row">
                      <label>
                        Intervalle (secondes)
                        <input
                          type="number"
                          min={5}
                          max={86400}
                          value={draft.source.intervalSeconds}
                          onChange={(event) =>
                            update((tile) => {
                              if (tile.source.type === 'http')
                                tile.source.intervalSeconds = Number(event.target.value);
                            })
                          }
                        />
                      </label>
                      <label>
                        Délai maximal (secondes)
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={draft.source.timeoutSeconds}
                          onChange={(event) =>
                            update((tile) => {
                              if (tile.source.type === 'http')
                                tile.source.timeoutSeconds = Number(event.target.value);
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Chemin de la valeur JSON
                      <input
                        placeholder="metrics.cpu"
                        value={draft.source.valuePath}
                        onChange={(event) =>
                          update((tile) => {
                            if (tile.source.type === 'http')
                              tile.source.valuePath = event.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      Chemin du message (facultatif)
                      <input
                        placeholder="message"
                        value={draft.source.messagePath}
                        onChange={(event) =>
                          update((tile) => {
                            if (tile.source.type === 'http')
                              tile.source.messagePath = event.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      Chemin du statut (facultatif)
                      <input
                        placeholder="health.status"
                        value={draft.source.statusPath ?? ''}
                        onChange={(event) =>
                          update((tile) => {
                            if (tile.source.type === 'http')
                              tile.source.statusPath = event.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      En-têtes HTTP (JSON)
                      <textarea
                        className="mono"
                        placeholder={'{ "Authorization": "Bearer …" }'}
                        value={headersText}
                        onChange={(event) => setHeadersText(event.target.value)}
                      />
                    </label>
                    <p className="help">
                      Laisser vide conserve les en-têtes existants. Saisir {'{}'} les efface. Les
                      secrets ne sont pas renvoyés au navigateur.
                    </p>
                  </>
                )}
              </section>
              <section className="form-section">
                <h3>Fraîcheur</h3>
                <label>
                  Données périmées après (secondes)
                  <input
                    type="number"
                    min={5}
                    max={604800}
                    value={draft.thresholds.staleAfterSeconds}
                    onChange={(event) =>
                      update((tile) => {
                        tile.thresholds.staleAfterSeconds = Number(event.target.value);
                      })
                    }
                  />
                </label>
                <p className="help">
                  Sans nouvelle donnée valide, l’état devient « Inconnu ». La dernière valeur reste
                  visible.
                </p>
              </section>
            </>
          )}
          {tab === 'thresholds' && (
            <>
              <section className="form-section">
                <h3>Mode de couleur</h3>
                <div className="segmented">
                  <button
                    type="button"
                    className={draft.appearance.mode === 'fixed' ? 'active' : ''}
                    onClick={() =>
                      update((tile) => {
                        tile.appearance.mode = 'fixed';
                      })
                    }
                  >
                    Couleur fixe
                  </button>
                  <button
                    type="button"
                    className={draft.appearance.mode === 'thresholds' ? 'active' : ''}
                    onClick={() =>
                      update((tile) => {
                        tile.appearance.mode = 'thresholds';
                      })
                    }
                  >
                    Seuils automatiques
                  </button>
                </div>
                {draft.appearance.mode === 'fixed' ? (
                  <label className="color-field">
                    Couleur de la tuile
                    <input
                      aria-label="Couleur fixe"
                      type="color"
                      value={draft.appearance.fixedColor}
                      onChange={(event) =>
                        update((tile) => {
                          tile.appearance.fixedColor = event.target.value;
                        })
                      }
                    />
                    <code>{draft.appearance.fixedColor}</code>
                  </label>
                ) : (
                  <>
                    <div className="palette-fields">
                      {Object.keys(palette).map((state) => (
                        <label key={state}>
                          <input
                            type="color"
                            aria-label={`Couleur ${stateLabels[state as keyof typeof palette]}`}
                            value={draft.appearance.colors[state as keyof typeof palette]}
                            onChange={(event) =>
                              update((tile) => {
                                tile.appearance.colors[state as keyof typeof palette] =
                                  event.target.value;
                              })
                            }
                          />
                          {stateLabels[state as keyof typeof palette]}
                        </label>
                      ))}
                    </div>
                    <div className="form-row">
                      <label>
                        Champ à évaluer
                        <select
                          value={draft.thresholds.field}
                          onChange={(event) =>
                            update((tile) => {
                              tile.thresholds.field = event.target.value as 'value' | 'status';
                            })
                          }
                        >
                          <option value="value">value</option>
                          <option value="status">status</option>
                        </select>
                      </label>
                      <label>
                        État par défaut
                        <select
                          value={draft.thresholds.defaultState}
                          onChange={(event) =>
                            update((tile) => {
                              tile.thresholds.defaultState = event.target.value as 'ok' | 'info';
                            })
                          }
                        >
                          <option value="ok">Normal</option>
                          <option value="info">Information</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}
              </section>
              {draft.appearance.mode === 'thresholds' && (
                <section className="form-section">
                  <div className="section-heading">
                    <h3>Règles</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={addRule}
                      disabled={draft.thresholds.rules.length >= 20}
                    >
                      <Plus size={15} />
                      Ajouter
                    </button>
                  </div>
                  <p className="help">
                    Critique prioritaire sur Attention, puis Information. La condition de sortie
                    évite les bascules près d’un seuil.
                  </p>
                  {draft.thresholds.rules.length === 0 && (
                    <div className="empty-rules">
                      Aucun seuil configuré.
                      <button type="button" className="text-button" onClick={addRule}>
                        Créer une première règle
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  )}
                  {draft.thresholds.rules.map((rule, index) => (
                    <div className="rule-card" key={index}>
                      <div className="rule-title">
                        <span
                          className="status-dot"
                          style={{ background: draft.appearance.colors[rule.state] }}
                        />
                        <input
                          aria-label={`Nom de règle ${index + 1}`}
                          value={rule.id}
                          onChange={(event) => updateRule(index, { id: event.target.value })}
                        />
                        <select
                          aria-label={`État de règle ${index + 1}`}
                          value={rule.state}
                          onChange={(event) =>
                            updateRule(index, { state: event.target.value as Rule['state'] })
                          }
                        >
                          <option value="critical">Critique</option>
                          <option value="warning">Attention</option>
                          <option value="info">Information</option>
                        </select>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Supprimer la règle ${index + 1}`}
                          onClick={() =>
                            update((tile) => {
                              tile.thresholds.rules.splice(index, 1);
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <ConditionFields
                        label="Déclenchement"
                        value={rule.enter}
                        onChange={(value) => updateRule(index, { enter: value })}
                      />
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={Boolean(rule.exit)}
                          onChange={(event) =>
                            updateRule(index, {
                              exit: event.target.checked
                                ? { operator: 'lt', value: 75 }
                                : undefined,
                            })
                          }
                        />
                        Seuil de retour distinct (hystérésis)
                      </label>
                      {rule.exit && (
                        <ConditionFields
                          label="Retour"
                          value={rule.exit}
                          onChange={(value) => updateRule(index, { exit: value })}
                        />
                      )}
                      <label>
                        Confirmation à l’entrée et à la sortie (secondes)
                        <input
                          type="number"
                          min={0}
                          max={86400}
                          value={rule.holdSeconds}
                          onChange={(event) =>
                            updateRule(index, { holdSeconds: Number(event.target.value) })
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <div className="preview-box">
                    <h4>Tester une valeur</h4>
                    <div className="preview-input">
                      <input
                        aria-label="Valeur de test"
                        value={previewValue}
                        onChange={(event) => {
                          setPreviewValue(event.target.value);
                          setPreview(null);
                        }}
                      />
                      <button type="button" className="button secondary" onClick={test}>
                        <Play size={14} />
                        Tester
                      </button>
                    </div>
                    {preview && (
                      <div className="preview-result">
                        <span className="status-dot" style={{ background: preview.color }} />
                        <Check size={14} />
                        {stateLabels[preview.state]} · {preview.reason}
                      </div>
                    )}
                    <p className="help">
                      Aperçu sur une mesure, sans modifier la tuile. Une temporisation nécessite
                      plusieurs mesures fraîches.
                    </p>
                  </div>
                </section>
              )}
            </>
          )}
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
          <button className="button primary" type="submit" disabled={busy}>
            <Save size={16} />
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
