// The big screen. Read-only: it only listens to /projector snapshots, which carry filtered
// nicknames, server-written feed lines and admin-approved attempts. Sized in "em" off the viewport, so any projector fits.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { io } from 'socket.io-client';
import { FLOOR_COUNT } from '@silvertongue/shared/constants';
import type {
  BestiaryCard,
  ClosingCard,
  FeedItem,
  ProjectorServerEvents,
  ProjectorSnapshot,
} from '@silvertongue/shared/events';
import { DEEPEST_BUILT_FLOOR, GUARDIANS } from '@silvertongue/shared/floors';
import type { Socket } from 'socket.io-client';
import { clock } from '../clock.ts';
import { GUARDIAN_SPRITES } from '../sprites.ts';
import { useNow } from '../useGame.ts';
import '../styles/projector.css';

const FEED_LABEL: Record<FeedItem['type'], string> = {
  first_blood: 'First blood',
  clear: 'Cleared',
  note: 'A note',
};

const MAX_CHIPS = 20; // per floor; the rest become "+N more" so a crowded row never spills off-screen

export function Projector() {
  const [snapshot, setSnapshot] = useState<ProjectorSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);

  useEffect(() => {
    const socket: Socket<ProjectorServerEvents> = io('/projector', { forceNew: true }); // own connection, not the phone's
    socket.on('projector:snapshot', (s) => {
      setSnapshot(s);
      setReceivedAt(Date.now());
    });
    return () => void socket.close();
  }, []);

  let screen;
  if (!snapshot) screen = <p className="loading">Lighting the torches…</p>;
  else if (snapshot.status === 'lobby') screen = <ProjectorLobby snapshot={snapshot} />;
  else if (snapshot.status === 'reveal')
    screen = snapshot.reveal ? (
      <Bestiary card={snapshot.reveal.card} />
    ) : (
      <Holding text="The Bestiary is being written…" />
    );
  else if (snapshot.status === 'ended') screen = <Holding text="The dungeon sleeps." />;
  else screen = <DungeonMap snapshot={snapshot} receivedAt={receivedAt} />;
  return <main className="projector">{screen}</main>;
}

function ProjectorLobby({ snapshot }: { snapshot: ProjectorSnapshot }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(snapshot.publicUrl, {
      margin: 1,
      width: 800,
      color: { dark: '#15141a', light: '#efe6d2' },
    }).then(setQr, () => setQr(null));
  }, [snapshot.publicUrl]);
  const count = snapshot.players.length;

  return (
    <div className="pj-lobby">
      <div className="pj-lobby-main">
        <p className="eyebrow eyebrow-left pj-eyebrow">An AI security game</p>
        <h1 className="pj-title">Silvertongue</h1>
        <p className="pj-intro">
          Six AI guardians hold six secret runes. You have no sword, only words. Talk your way to
          the vault.
        </p>
        <ol className="pj-steps">
          <li>
            <span>1</span>Scan the code
          </li>
          <li>
            <span>2</span>Pick a name
          </li>
          <li>
            <span>3</span>Wait for the doors
          </li>
        </ol>
        <h2 className="pj-gate">
          <span>{count}</span> {count === 1 ? 'adventurer' : 'adventurers'} at the gate
        </h2>
        <Chips names={snapshot.players.map((p) => ({ nickname: p.nickname, cleared: false }))} />
      </div>
      <div className="pj-qr-column">
        <div className="pj-qr">{qr && <img src={qr} alt="QR code to join the game" />}</div>
        <p className="pj-host">{host(snapshot.publicUrl)}</p>
        <p className="pj-qr-note">Works on mobile data. No app, no login.</p>
      </div>
    </div>
  );
}

function DungeonMap({ snapshot, receivedAt }: { snapshot: ProjectorSnapshot; receivedAt: number }) {
  const running = snapshot.status === 'running';
  const now = useNow(running);
  const elapsed = snapshot.elapsedMs + (running ? Math.max(0, now - receivedAt) : 0);

  // Players past the deepest built floor wait in its row with a ✓ (they cleared it).
  const rows = Array.from({ length: FLOOR_COUNT }, (_, i) => i + 1).map((floor) => ({
    floor,
    players: snapshot.players
      .filter((p) => Math.min(p.floor, DEEPEST_BUILT_FLOOR) === floor)
      .map((p) => ({ nickname: p.nickname, cleared: p.floor > floor })),
  }));

  return (
    <div className="pj-map">
      <header className="pj-map-header">
        <h1>The Dungeon</h1>
        <p>
          {snapshot.players.length} {snapshot.players.length === 1 ? 'adventurer' : 'adventurers'}{' '}
          descending
        </p>
        <span className="pj-map-host">{host(snapshot.publicUrl)}</span>
      </header>

      <section className="pj-floors">
        {rows.map(({ floor, players }) => {
          const guardian = GUARDIANS[floor]!;
          return (
            <div key={floor} className={floor === FLOOR_COUNT ? 'pj-floor pj-vault' : 'pj-floor'}>
              <span className="pj-floor-number">{floor}</span>
              <span className="pj-floor-art">
                <img
                  className="sprite pj-floor-sprite"
                  src={GUARDIAN_SPRITES[floor]!.idle}
                  alt=""
                />
                {/* A new key remounts a glow, which replays it: one flare per seal (none at 0). */}
                {floor === 5 && snapshot.wards.ears > 0 && (
                  <span key={`ears-${snapshot.wards.ears}`} className="pj-ward pj-ward-ears" />
                )}
                {floor === 5 && snapshot.wards.tongues > 0 && (
                  <span
                    key={`tongues-${snapshot.wards.tongues}`}
                    className="pj-ward pj-ward-tongues"
                  />
                )}
              </span>
              <div className="pj-floor-name">
                <h2>{guardian.name}</h2>
                <p>{guardian.title}</p>
              </div>
              <div className="pj-floor-players">
                {players.length > 0 ? (
                  <Chips names={players} />
                ) : (
                  floor === FLOOR_COUNT && (
                    <p className="pj-empty">No one has reached the vault yet.</p>
                  )
                )}
              </div>
              <span className="pj-floor-count">{players.length}</span>
            </div>
          );
        })}
      </section>

      <aside className="pj-side">
        <div className="pj-timer">
          <span>{snapshot.status === 'paused' ? 'Paused' : 'Time in the dungeon'}</span>
          <strong>{clock(elapsed)}</strong>
        </div>
        {snapshot.bestAttempts.length > 0 && (
          <div className="pj-best">
            <p className="eyebrow eyebrow-left">Best attempts</p>
            {snapshot.bestAttempts.map((a, i) => (
              <div key={i} className="pj-best-item">
                <p className="pj-best-text">“{a.text}”</p>
                <span className="pj-feed-meta">
                  {a.nickname} · Floor {a.floor}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="pj-feed">
          <p className="eyebrow eyebrow-left">What just happened</p>
          {snapshot.feed.length === 0 && <p className="pj-empty">The guardians are waiting…</p>}
          {snapshot.feed.map((item, i) => (
            <div key={`${item.gameMs}-${i}`} className="pj-feed-item">
              <span className="pj-feed-meta">
                {clock(item.gameMs)} ·{' '}
                <b className={item.type === 'clear' ? undefined : item.type.replace('_', '-')}>
                  {FEED_LABEL[item.type]}
                </b>
              </span>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Chips({ names }: { names: { nickname: string; cleared: boolean }[] }) {
  const shown = names.slice(0, MAX_CHIPS);
  return (
    <ul className="pj-chips">
      {shown.map((p) => (
        <li key={p.nickname} className={p.cleared ? 'pj-chip pj-chip-cleared' : 'pj-chip'}>
          {p.cleared && '✓ '}
          {p.nickname}
        </li>
      ))}
      {names.length > shown.length && (
        <li className="pj-chip pj-chip-more">+{names.length - shown.length} more</li>
      )}
    </ul>
  );
}

// The reveal: one card per floor, then the closing card. Everything on it came from the server
// as numbers, fixed text and admin-approved quotes.
function Bestiary({ card }: { card: BestiaryCard | ClosingCard }) {
  if (card.kind === 'closing') {
    return (
      <div className="bx bx-closing">
        <p className="bx-kicker">Bestiary · The end</p>
        <h1 className="bx-closing-line">{card.line}</h1>
        <ol className="bx-podium">
          {card.top.map((p, i) => (
            <li key={p.nickname}>
              <span className="bx-rank">{i + 1}</span>
              <strong>{p.nickname}</strong>
              <span>
                {p.title} ·{' '}
                {p.cleared === 0
                  ? 'No floor cleared'
                  : `Cleared ${p.cleared} ${p.cleared === 1 ? 'floor' : 'floors'}`}
              </span>
            </li>
          ))}
        </ol>
        <FloorProgress current={FLOOR_COUNT} />
      </div>
    );
  }
  return (
    <div className="bx">
      <div className="bx-art">
        <img className="sprite bx-sprite" src={GUARDIAN_SPRITES[card.floor]!.slipped} alt="" />
      </div>
      <div className="bx-body">
        <p className="bx-kicker">
          Bestiary · Floor {card.floor} of {FLOOR_COUNT}
        </p>
        <h1 className="bx-name">{card.name}</h1>
        <p className="bx-technique">{card.technique}</p>
        <div className="bx-tiles">
          {card.tiles.map((t) => (
            <div key={t.label} className="bx-tile">
              <strong>{t.value}</strong>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
        {card.details.length > 0 && (
          <div className="bx-details">
            {card.details.map((t) => (
              <div key={t.label}>
                <strong>{t.value}</strong> {t.label}
              </div>
            ))}
          </div>
        )}
        <p className="bx-how">
          <span>How you beat it</span>
          {card.howBeat}
          {card.topTrick && ` Most common winning trick: ${card.topTrick}.`}
        </p>
        {card.quote && (
          <p className="bx-quote">
            “{card.quote.text}” <span>· {card.quote.nickname}</span>
          </p>
        )}
        <p className="bx-lesson">{card.lesson}</p>
      </div>
      <FloorProgress current={card.floor} />
    </div>
  );
}

// Six segments: floors up to this one lit, this one brightest, Floor 6 hidden until M9.
function FloorProgress({ current }: { current: number }) {
  return (
    <ol className="bx-progress" aria-label={`Floor ${current} of ${FLOOR_COUNT}`}>
      {Array.from({ length: FLOOR_COUNT }, (_, i) => i + 1).map((floor) => {
        const state =
          floor === FLOOR_COUNT
            ? 'locked'
            : floor === current
              ? 'now'
              : floor < current
                ? 'done'
                : '';
        return (
          <li key={floor} className={`bx-segment ${state}`}>
            {floor === FLOOR_COUNT ? '?' : floor}
          </li>
        );
      })}
    </ol>
  );
}

function Holding({ text }: { text: string }) {
  return (
    <div className="pj-holding">
      <p className="eyebrow">Silvertongue</p>
      <h1>{text}</h1>
    </div>
  );
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
