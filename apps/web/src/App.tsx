import { Admin } from './routes/Admin.tsx';
import { Cleared } from './routes/Cleared.tsx';
import { Closed } from './routes/Closed.tsx';
import { Join } from './routes/Join.tsx';
import { Lobby } from './routes/Lobby.tsx';
import { Play } from './routes/Play.tsx';
import { Projector } from './routes/Projector.tsx';
import { useGame } from './useGame.ts';

// Three apps in one build, picked by the path. No router library needed for three screens.
export function App() {
  if (location.pathname === '/projector') return <Projector />;
  if (location.pathname === '/admin') return <Admin />;
  return <Phone />;
}

// On the phone the game state decides the screen.
function Phone() {
  const game = useGame();

  if (!game.token) return <Join notice={game.notice} kicked={game.kicked} onJoin={game.join} />;
  if (!game.state) return <p className="loading">Lighting the torches…</p>;
  const status = game.state.gameStatus;
  if (status === 'lobby') return <Lobby state={game.state} />;
  if (status === 'reveal' || status === 'ended') return <Closed state={game.state} />;
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
