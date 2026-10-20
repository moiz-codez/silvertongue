import type { PlayerState } from '@silvertongue/shared/events';
import { DOOR_SPRITE } from '../sprites.ts';

// Before the game master presses Start. When they do, the next player:state moves this phone on.
export function Lobby({ state }: { state: PlayerState }) {
  const count = state.playersInGame;
  return (
    <main className="lobby">
      <p className="eyebrow">You’re in</p>
      <p className="lobby-welcome">Welcome, adventurer</p>
      <h1 className="lobby-name">{state.nickname}</h1>
      <div className="lobby-door-frame">
        <img className="sprite lobby-door" src={DOOR_SPRITE} alt="" />
      </div>

      <h2 className="lobby-heading">The doors are still sealed.</h2>
      <p className="lobby-text">
        Watch the big screen. When the game master opens the dungeon, this page will take you to the
        first guardian.
      </p>
      <p className="lobby-count">
        <span className="lobby-dot" aria-hidden="true" />
        <strong>{count}</strong> {count === 1 ? 'adventurer' : 'adventurers'} at the gate
      </p>

      <section className="how-to">
        <p className="eyebrow eyebrow-left">How to play</p>
        <p>
          Talk each guardian into revealing their secret rune. Then speak it at the door to go
          deeper. Six floors. No sword. Only words.
        </p>
      </section>
    </main>
  );
}
