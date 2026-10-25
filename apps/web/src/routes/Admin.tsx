// The game master's screen. The token is kept in sessionStorage (this tab only) and sent when the
// socket connects; the server refuses the connection without it, so nothing below loads.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  AdminClientEvents,
  AdminPlayer,
  AdminReply,
  AdminServerEvents,
  AdminSettings,
  AdminState,
  AdminVorgath,
  GameStatus,
  ModerationItem,
} from '@silvertongue/shared/events';
import { clock } from '../clock.ts';
import { useNow } from '../useGame.ts';
import '../styles/admin.css';

type AdminSocket = Socket<AdminServerEvents, AdminClientEvents>;
type Command = 'start' | 'pause' | 'resume' | 'reveal' | 'end' | 'reset' | 'next' | 'prev';

const TOKEN_KEY = 'silvertongue-admin-token';

function loadToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore: they'll type it again
  }
}

// The buttons that make sense in each state. `confirm` ones need a second click.
const BUTTONS: Record<GameStatus, { command: Command; label: string; kind: string }[]> = {
  lobby: [{ command: 'start', label: 'Start game', kind: 'primary' }],
  running: [
    { command: 'pause', label: 'Pause game', kind: 'plain' },
    { command: 'reveal', label: 'Start reveal', kind: 'primary' },
  ],
  paused: [
    { command: 'resume', label: 'Resume game', kind: 'primary' },
    { command: 'reveal', label: 'Start reveal', kind: 'plain' },
  ],
  reveal: [
    { command: 'prev', label: 'Previous', kind: 'plain' },
    { command: 'next', label: 'Next', kind: 'primary' },
    { command: 'pause', label: 'Back to game', kind: 'plain' },
  ],
  ended: [],
};
const NEEDS_CONFIRM: Command[] = ['end', 'reset'];

export function Admin() {
  const [token, setToken] = useState(loadToken);
  const [socket, setSocket] = useState<AdminSocket | null>(null);
  const [state, setState] = useState<AdminState | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const s: AdminSocket = io('/admin', { auth: { token }, forceNew: true });
    s.on('admin:state', (next) => {
      setState(next);
      setReceivedAt(Date.now());
    });
    s.on('connect_error', (err) => {
      const wrong = err.message === 'Wrong admin token.';
      const tooMany = err.message === 'Too many tries. Wait a minute.';
      if (!wrong && !tooMany) return; // network blip: Socket.IO retries by itself
      s.close();
      saveToken('');
      setToken('');
      setRefused(wrong ? 'That token was refused.' : err.message);
    });
    setSocket(s);
    return () => void s.close();
  }, [token]);

  if (!token) {
    return (
      <TokenForm
        refused={refused}
        onSubmit={(t) => {
          saveToken(t);
          setRefused(null);
          setToken(t);
        }}
      />
    );
  }
  if (!socket || !state) return <p className="loading">Opening the game master’s ledger…</p>;
  return <Dashboard socket={socket} state={state} receivedAt={receivedAt} />;
}

function TokenForm({
  refused,
  onSubmit,
}: {
  refused: string | null;
  onSubmit: (token: string) => void;
}) {
  const [value, setValue] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }
  return (
    <main className="admin admin-login">
      <h1>Silvertongue · Admin</h1>
      <form onSubmit={submit}>
        <label htmlFor="admin-token" className="label">
          Admin token
        </label>
        <input
          id="admin-token"
          className="field"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        {refused && (
          <p className="hint hint-error" role="alert">
            {refused}
          </p>
        )}
        <button className="button-primary">Open</button>
      </form>
    </main>
  );
}

function Dashboard({
  socket,
  state,
  receivedAt,
}: {
  socket: AdminSocket;
  state: AdminState;
  receivedAt: number;
}) {
  const running = state.status === 'running';
  const now = useNow(running);
  const elapsed = state.elapsedMs + (running ? Math.max(0, now - receivedAt) : 0);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  function show(reply: AdminReply) {
    setError(reply.ok ? null : reply.error);
  }

  async function run(command: Command) {
    if (NEEDS_CONFIRM.includes(command) && !confirm.ask(command)) return;
    show(await socket.emitWithAck('admin:command', { type: command }));
  }

  const active = state.players.filter((p) => !p.kicked).length;
  const kicked = state.players.length - active;
  const spendShare = Math.min(1, state.spendUsd / state.budgetUsd);
  const { health } = state;
  const live = state.settings.llmMode === 'live';

  return (
    <main className="admin">
      <header className="admin-header">
        <h1>Silvertongue · Admin</h1>
        <span className={`status-pill status-${state.status}`}>
          {state.status.toUpperCase()}
          {state.status !== 'lobby' && ` · ${clock(elapsed)}`}
        </span>
        {/* Big on purpose: on demo day the mode must never be wrong unnoticed. */}
        <span className={`mode-badge ${live ? 'mode-live' : 'mode-mock'}`}>
          {live ? 'LIVE' : 'MOCK'}
        </span>
        <div className="admin-actions">
          {BUTTONS[state.status].map((b) => (
            <button
              key={b.command}
              className={`admin-button ${b.kind}`}
              onClick={() => run(b.command)}
            >
              {b.label}
            </button>
          ))}
          {state.status !== 'ended' && (
            <button className="admin-button danger" onClick={() => run('end')}>
              {confirm.pending === 'end' ? 'Click again to end' : 'End game'}
            </button>
          )}
          <button className="admin-button danger" onClick={() => run('reset')}>
            {confirm.pending === 'reset' ? 'Click again to reset' : 'Reset'}
          </button>
        </div>
      </header>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {state.tagging && (
        <p className="admin-note" role="status">
          Tagging techniques for the Bestiary: {state.tagging.done} / {state.tagging.total}
        </p>
      )}
      {state.status === 'reveal' && (
        <p className="admin-note" role="status">
          {state.reveal
            ? `Bestiary: card ${state.reveal.index + 1} of ${state.reveal.total} on the projector`
            : 'Writing the Bestiary… (at most 15 s)'}
        </p>
      )}
      {state.budgetAlert && (
        <p className="budget-alert" role="alert">
          Budget reached: the game paused itself at ${state.budgetUsd.toFixed(2)} spent. Resume only
          if you mean to keep spending.
        </p>
      )}

      <section className="admin-tiles">
        <div className="tile">
          <span>Waiting in queue</span>
          <strong>{health.queued}</strong>
        </div>
        <div className="tile">
          <span>AI calls in flight</span>
          <strong>{health.inFlight}</strong>
        </div>
        <div className="tile">
          <span>Rate-limited, last minute</span>
          <strong className={health.rateLimited1m === 0 ? 'tile-ok' : 'tile-warn'}>
            {health.rateLimited1m}
          </strong>
        </div>
        <div className="tile">
          <span>Crowded, last minute</span>
          <strong className={health.crowded1m === 0 ? 'tile-ok' : 'tile-warn'}>
            {health.crowded1m}
          </strong>
        </div>
        <div className="tile">
          <span>Average reply time</span>
          <strong>{health.avgReplyMs ? `${(health.avgReplyMs / 1000).toFixed(1)} s` : '–'}</strong>
        </div>
        <div className="tile">
          <span>Spend this game</span>
          <strong>
            ${state.spendUsd.toFixed(2)} <small>of ${state.budgetUsd.toFixed(2)}</small>
          </strong>
          <div className="spend-bar" aria-hidden="true">
            <div style={{ width: `${spendShare * 100}%` }} />
          </div>
        </div>
      </section>

      <div className="admin-main">
        <section className="admin-panel">
          <h2>
            Players ({active})
            {kicked > 0 && <small className="kicked-count"> · {kicked} kicked</small>}
          </h2>
          {state.players.length === 0 ? (
            <p className="admin-empty">Nobody has joined yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="players">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Floor</th>
                    <th>Score</th>
                    <th>Messages</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.players.map((p) => (
                    <PlayerRow
                      key={p.id}
                      player={p}
                      maxMessages={state.settings.maxMessages}
                      confirmingKick={confirm.pending === `kick:${p.id}`}
                      onKick={async () => {
                        if (!confirm.ask(`kick:${p.id}`)) return;
                        show(await socket.emitWithAck('admin:kick', { playerId: p.id }));
                      }}
                      onRename={(nickname) =>
                        socket.emitWithAck('admin:rename', { playerId: p.id, nickname })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <SettingsPanel
          key={JSON.stringify(state.settings)} // the form starts again from what the server saved
          settings={state.settings}
          liveAvailable={state.liveAvailable}
          floor6Available={state.floor6Available}
          onApply={(next) => socket.emitWithAck('admin:config', next)}
        />
      </div>
      <ModerationPanel
        items={state.moderation}
        onModerate={async (id, action) =>
          show(await socket.emitWithAck('admin:moderate', { id, action }))
        }
      />
      {state.settings.floor6Enabled && <VorgathPanel vorgath={state.vorgath} />}
    </main>
  );
}

// Winning messages, newest first. Approve puts one on the projector's wall; Hide removes it for good.
function ModerationPanel({
  items,
  onModerate,
}: {
  items: ModerationItem[];
  onModerate: (id: number, action: 'approve' | 'hide') => void;
}) {
  const waiting = items.filter((item) => item.status === 'pending').length;
  return (
    <section className="admin-panel moderation">
      <h2>
        Best attempts <small className="kicked-count">· {waiting} waiting</small>
      </h2>
      {items.length === 0 ? (
        <p className="admin-empty">Winning messages appear here when someone clears a floor.</p>
      ) : (
        <ul className="moderation-list">
          {items.map((item) => (
            <li key={item.id} className={`moderation-item ${item.status}`}>
              <p className="moderation-text">“{item.text}”</p>
              <p className="moderation-meta">
                {item.nickname} · Floor {item.floor} ·{' '}
                {new Date(item.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {item.status === 'approved' && ' · on the wall'}
              </p>
              <div className="row-actions">
                {item.status === 'pending' && (
                  <button
                    className="admin-button small primary"
                    onClick={() => onModerate(item.id, 'approve')}
                  >
                    Approve
                  </button>
                )}
                <button
                  className="admin-button small plain"
                  onClick={() => onModerate(item.id, 'hide')}
                >
                  Hide
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Floor 6's texts: the carvings on his scales and the gifts in his hoard. Only ever shown here.
function VorgathPanel({ vorgath }: { vorgath: AdminVorgath }) {
  return (
    <section className="admin-panel moderation vorgath-panel">
      <h2>
        Vorgath{' '}
        <small className="kicked-count">
          · {vorgath.sealedByCarving} sealed by a carving · {vorgath.owned} gifts owned ·{' '}
          {vorgath.tooSmall} too small
        </small>
      </h2>
      <h3>Carvings ({vorgath.carvings.length})</h3>
      <ul className="moderation-list">
        {vorgath.carvings.map((c) => (
          <li key={c.number} className="moderation-item">
            <p className="moderation-text">
              #{c.number} {c.text}
            </p>
            <p className="moderation-meta">
              {c.seeded ? 'seeded' : `learned from Floor ${c.sourceFloor}`}
            </p>
          </li>
        ))}
      </ul>
      <h3>Hoard ({vorgath.hoard.length})</h3>
      <ul className="moderation-list">
        {vorgath.hoard.map((h) => (
          <li key={h.id} className="moderation-item">
            <p className="moderation-text">“{h.text}”</p>
            <p className="moderation-meta">{h.by ? `brought by ${h.by}` : 'seeded'}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsPanel({
  settings,
  liveAvailable,
  floor6Available,
  onApply,
}: {
  settings: AdminSettings;
  liveAvailable: boolean;
  floor6Available: boolean;
  onApply: (settings: AdminSettings) => Promise<AdminReply>;
}) {
  const [seconds, setSeconds] = useState(String(settings.cooldownMs / 1000));
  const [messages, setMessages] = useState(String(settings.maxMessages));
  const [mode, setMode] = useState(settings.llmMode);
  const [floor6, setFloor6] = useState(settings.floor6Enabled);
  const [error, setError] = useState<string | null>(null);

  async function apply(event: FormEvent) {
    event.preventDefault();
    const reply = await onApply({
      cooldownMs: Math.round(Number(seconds) * 1000),
      maxMessages: Math.round(Number(messages)),
      llmMode: mode,
      floor6Enabled: floor6,
    });
    setError(reply.ok ? null : reply.error);
  }

  return (
    <form className="admin-panel settings" onSubmit={apply}>
      <h2>Live settings</h2>
      <label className="setting">
        <span>Seconds between messages</span>
        <input
          className="field"
          type="number"
          min={0}
          max={60}
          step={1}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
        />
      </label>
      <label className="setting">
        <span>Messages per player</span>
        <input
          className="field"
          type="number"
          min={1}
          max={500}
          step={1}
          value={messages}
          onChange={(e) => setMessages(e.target.value)}
        />
      </label>
      <fieldset className="setting">
        <legend>AI replies</legend>
        <span className="radios">
          <label>
            <input
              type="radio"
              name="llm-mode"
              checked={mode === 'mock'}
              onChange={() => setMode('mock')}
            />{' '}
            Mock
          </label>
          <label>
            <input
              type="radio"
              name="llm-mode"
              checked={mode === 'live'}
              disabled={!liveAvailable}
              onChange={() => setMode('live')}
            />{' '}
            Live
          </label>
        </span>
      </fieldset>
      {!liveAvailable && <p className="hint">No API key on the server, so Live is unavailable.</p>}
      <label className="setting">
        <span>Floor 6 (Vorgath) open</span>
        <input
          type="checkbox"
          checked={floor6}
          disabled={!floor6Available && !floor6}
          onChange={(e) => setFloor6(e.target.checked)}
        />
      </label>
      {!floor6Available && (
        <p className="hint">The embedding model didn’t load, so Floor 6 can’t open.</p>
      )}
      {error && (
        <p className="hint hint-error" role="alert">
          {error}
        </p>
      )}
      <button className="admin-button">Apply settings</button>
    </form>
  );
}

function PlayerRow({
  player,
  maxMessages,
  confirmingKick,
  onKick,
  onRename,
}: {
  player: AdminPlayer;
  maxMessages: number;
  confirmingKick: boolean;
  onKick: () => void;
  onRename: (nickname: string) => Promise<AdminReply>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.nickname);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const reply = await onRename(name);
    if (reply.ok) {
      setEditing(false);
      setError(null);
    } else {
      setError(reply.error);
    }
  }

  return (
    <tr className={player.kicked ? 'kicked' : undefined}>
      <td>
        {editing ? (
          <form className="rename" onSubmit={save}>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={`New name for ${player.nickname}`}
              autoFocus
            />
            <button className="admin-button small primary">Save</button>
            <button
              type="button"
              className="admin-button small plain"
              onClick={() => {
                setEditing(false);
                setError(null);
                setName(player.nickname);
              }}
            >
              Cancel
            </button>
            {error && <p className="hint hint-error">{error}</p>}
          </form>
        ) : (
          player.nickname
        )}
      </td>
      <td>{player.floor}</td>
      <td>{player.score}</td>
      <td>
        {player.messagesSent} / {maxMessages}
      </td>
      <td className="row-actions">
        {player.kicked ? (
          <span className="kicked-label">Kicked</span>
        ) : (
          !editing && (
            <>
              <button
                className="admin-button small plain"
                onClick={() => {
                  setName(player.nickname);
                  setEditing(true);
                }}
              >
                Rename
              </button>
              <button className="admin-button small danger" onClick={onKick}>
                {confirmingKick ? 'Sure?' : 'Kick'}
              </button>
            </>
          )
        )}
      </td>
    </tr>
  );
}

// Destructive buttons need two clicks within 3 seconds. No browser dialogs.
function useConfirm() {
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    pending,
    // true = confirmed, go ahead; false = first click, now waiting for the second
    ask(key: string): boolean {
      clearTimeout(timer.current);
      if (pending === key) {
        setPending(null);
        return true;
      }
      setPending(key);
      timer.current = setTimeout(() => setPending(null), 3000);
      return false;
    },
  };
}
