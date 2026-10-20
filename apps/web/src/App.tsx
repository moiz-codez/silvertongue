import { Cleared } from './routes/Cleared.tsx';
import { Join } from './routes/Join.tsx';
import { Play } from './routes/Play.tsx';
import { useGame } from './useGame.ts';

// No router: the game state decides which screen the phone shows.
export function App() {
  const game = useGame();

  if (!game.token) return <Join onJoin={game.join} />;
  if (!game.state) return <p className="loading">Lighting the torches…</p>;
  if (game.cleared || !game.state.floorReady) {
    return <Cleared state={game.state} cleared={game.cleared} onDescend={game.descend} />;
  }
  return (
    <Play
      state={game.state}
      bubbles={game.bubbles}
      expression={game.expression}
      waitingLine={game.waitingLine}
      doorNote={game.doorNote}
      cooldownUntil={game.cooldownUntil}
      doorLockedUntil={game.doorLockedUntil}
      onSend={game.send}
      onDoor={game.openDoor}
    />
  );
}
