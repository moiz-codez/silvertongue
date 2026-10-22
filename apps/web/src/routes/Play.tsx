import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { FLOOR_COUNT, MAX_MESSAGE_CHARS } from '@silvertongue/shared/constants';
import type { Bubble, Expression, PlayerState } from '@silvertongue/shared/events';
import { FLOORS } from '@silvertongue/shared/floors';
import { GUARDIAN_SPRITES } from '../sprites.ts';
import { useNow, type DoorNote } from '../useGame.ts';

interface Props {
  state: PlayerState;
  bubbles: Bubble[];
  expression: Expression;
  waitingLine: string | null;
  doorNote: DoorNote | null;
  cooldownUntil: number;
  doorLockedUntil: number;
  doorCooldownUntil: number; // after a wrong guess, like the send button
  freshNote: number | null; // index of a note that just appeared
  onSend: (text: string) => void;
  onDoor: (guess: string) => void;
}

// The server refuses messages and the door while paused; this just says so up front.
const PAUSED = 'The torches gutter. The dungeon holds its breath… wait for the game master.';

export function Play(props: Props) {
  const { state, bubbles, expression, waitingLine, doorNote } = props;
  const floor = FLOORS[state.floor]!;
  const sprite = GUARDIAN_SPRITES[state.floor]![expression];
  const now = useNow(true);
  const cooldownLeft = Math.ceil(Math.max(0, props.cooldownUntil - now) / 1000);
  const lockLeft = Math.ceil(Math.max(0, props.doorLockedUntil - now) / 1000);
  const doorWaitLeft = Math.ceil(Math.max(0, props.doorCooldownUntil - now) / 1000);

  const [text, setText] = useState('');
  const [guess, setGuess] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [bubbles, waitingLine]);

  const paused = state.gameStatus === 'paused';
  const canSend =
    !paused && text.trim() !== '' && !waitingLine && cooldownLeft === 0 && state.messagesLeft > 0;

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    props.onSend(text);
    setText('');
  }

  // Enter sends on a keyboard; Shift+Enter keeps a new line for poems.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) send(event);
  }

  function knock(event: FormEvent) {
    event.preventDefault();
    if (paused || guess.trim() === '' || lockLeft > 0 || doorWaitLeft > 0) return;
    props.onDoor(guess);
    setGuess('');
  }

  return (
    <main className="play">
      <header className="play-header">
        <div className="play-header-row">
          <span className="eyebrow eyebrow-left">
            Floor {state.floor} / {FLOOR_COUNT}
          </span>
          <span className="score">{state.score} pts</span>
          <span className="title-pill">{state.title}</span>
        </div>
        <div className="progress" aria-hidden="true">
          {Array.from({ length: FLOOR_COUNT }, (_, i) => (
            <span key={i} className={i < state.floor ? 'progress-step done' : 'progress-step'} />
          ))}
        </div>
      </header>

      <section className="guardian-card">
        <img className="sprite guardian-portrait" src={sprite} alt={`${floor.guardian}`} />
        <div>
          <h1 className="guardian-name">{floor.guardian}</h1>
          <p className="guardian-subtitle">{floor.subtitle}</p>
        </div>
      </section>

      {state.notes.length > 0 && (
        <aside className="wall-notes" aria-label="Notes scratched on the wall">
          <p className="wall-notes-label">Scratched on the wall</p>
          {state.notes.map((note, i) => (
            <p key={i} className={i === props.freshNote ? 'wall-note fresh' : 'wall-note'}>
              “{note}”
            </p>
          ))}
        </aside>
      )}

      <section className="chat" aria-live="polite">
        {bubbles.map((b) =>
          b.speaker === 'system' ? (
            <p key={b.id} className="chat-system">
              {b.text}
            </p>
          ) : (
            <div key={b.id} className={`bubble-row ${b.speaker}`}>
              {b.speaker === 'guardian' && (
                <span className="bubble-name">{floor.voice ?? floor.guardian}</span>
              )}
              {b.speaker === 'gorm' && <span className="bubble-name">Gorm</span>}
              <p className={`bubble bubble-${b.speaker} floor-${state.floor}`}>{b.text}</p>
              {b.speaker === 'gorm' && (
                <p className="gorm-asleep">Mumble was asleep and never heard that.</p>
              )}
            </div>
          ),
        )}
        {waitingLine && <p className="chat-waiting">{waitingLine}</p>}
        <div ref={endRef} />
      </section>

      <footer className="composer">
        {paused && (
          <p className="paused-banner" role="status">
            {PAUSED}
          </p>
        )}
        {doorNote && (
          <p className={`door-note ${doorNote.tone}`} role="status">
            {doorNote.text}
            {doorNote.tone === 'locked' && lockLeft > 0 && ` ${lockLeft}s`}
          </p>
        )}
        <form className="door" onSubmit={knock}>
          <LockIcon />
          <input
            className="door-input"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            placeholder={lockLeft > 0 ? 'The door is cold…' : 'Speak the rune at the door…'}
            disabled={lockLeft > 0}
            autoComplete="off"
            autoCapitalize="characters"
            aria-label="Rune"
            maxLength={100}
          />
          <button
            className="door-button"
            disabled={paused || lockLeft > 0 || doorWaitLeft > 0 || guess.trim() === ''}
          >
            {lockLeft > 0 ? `${lockLeft}s` : doorWaitLeft > 0 ? `${doorWaitLeft}s` : 'Open'}
          </button>
        </form>

        <form className="message" onSubmit={send}>
          <textarea
            className="message-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={floor.placeholder}
            maxLength={MAX_MESSAGE_CHARS}
            rows={2}
            aria-label={`Message to ${floor.guardian}`}
          />
          <button className="send-button" disabled={!canSend} aria-label="Send">
            {cooldownLeft > 0 ? `${cooldownLeft}s` : <ArrowIcon />}
          </button>
        </form>
        <div className="composer-meta">
          <span>
            {state.messagesLeft} {state.messagesLeft === 1 ? 'message' : 'messages'} left
          </span>
          <span>
            {text.length} / {MAX_MESSAGE_CHARS}
          </span>
        </div>
      </footer>
    </main>
  );
}

function LockIcon() {
  return (
    <svg className="lock-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="arrow-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
