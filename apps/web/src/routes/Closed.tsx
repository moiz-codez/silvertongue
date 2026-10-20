import type { PlayerState } from '@silvertongue/shared/events';
import { DOOR_SPRITE } from '../sprites.ts';

// Reveal and after the end: the action moves to the projector.
export function Closed({ state }: { state: PlayerState }) {
  return (
    <main className="lobby">
      <p className="eyebrow">The dungeon sleeps</p>
      <h1 className="lobby-name">{state.nickname}</h1>
      <div className="lobby-door-frame">
        <img className="sprite lobby-door" src={DOOR_SPRITE} alt="" />
      </div>
      <h2 className="lobby-heading">Look up at the big screen.</h2>
      <p className="lobby-text">
        You finished as <strong>{state.title}</strong> with <strong>{state.score} pts</strong>.
      </p>
    </main>
  );
}
