// The game master's screen. The token is kept in sessionStorage (this tab only) and sent when the
// socket connects; the server refuses the connection without it, so nothing below loads.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  AdminClientEvents,
  AdminPlayer,
  AdminReply,
  AdminServerEvents,
  AdminState,
  GameStatus,
} from '@silvertongue/shared/events';
import { clock } from '../clock.ts';
import { useNow } from '../useGame.ts';
import '../styles/admin.css';

type AdminSocket = Socket<AdminServerEvents, AdminClientEvents>;
type Command = 'start' | 'pause' | 'resume' | 'reveal' | 'end' | 'reset';

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
  reveal: [],
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
      if (err.message !== 'Wrong admin token.') return; // network blip: Socket.IO retries by itself
      s.close();
      saveToken('');
      setToken('');
      setRefused('That token was refused.');
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
  const spendShare = Math.min(1, state.spendUsd / state.budgetUsd);

  return (
    <main className="admin">
      <header className="admin-header">
        <h1>Silvertongue · Admin</h1>
        <span className={`status-pill status-${state.status}`}>
          {state.status.toUpperCase()}
          {state.status !== 'lobby' && ` · ${clock(elapsed)}`}
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

      <section className="admin-tiles">
        <div className="tile">
          <span>Players</span>
          <strong>{active}</strong>
          {active !== state.players.length && <small>{state.players.length - active} kicked</small>}
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

      <section className="admin-panel">
        <h2>Players ({active})</h2>
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
    </main>
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
