import type { FloorCleared, PlayerState } from '@silvertongue/shared/events';
import { FLOORS } from '@silvertongue/shared/floors';
import { GUARDIAN_SPRITES } from '../sprites.ts';

// Shown right after a clear (with the score breakdown), and after a refresh while the next
// floor isn't built yet (without it).
export function Cleared({
  state,
  cleared,
  onDescend,
}: {
  state: PlayerState;
  cleared: FloorCleared | null;
  onDescend: () => void;
}) {
  const floorNumber = cleared?.floor ?? state.floor - 1;
  const floor = FLOORS[floorNumber];
  const sprite = GUARDIAN_SPRITES[floorNumber]?.slipped;
  const next = FLOORS[floorNumber + 1];
  const nextReady = cleared ? cleared.nextFloorReady : state.floorReady;

  return (
    <main className="cleared">
      <p className="eyebrow">Floor {floorNumber} cleared</p>
      {sprite && <img className="sprite cleared-portrait" src={sprite} alt="" />}
      {floor && (
        <>
          <h1 className="cleared-quote">{floor.clearQuote}</h1>
          <p className="cleared-line">{floor.clearLine}</p>
        </>
      )}

      {cleared && (
        <table className="score-table">
          <tbody>
            {cleared.lines.map((line) => (
              <tr key={line.label} className={line.highlight ? 'highlight' : undefined}>
                <td>{line.label}</td>
                <td>+{line.points}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{cleared.total} pts</td>
            </tr>
          </tfoot>
        </table>
      )}

      <p className="new-title-label">{cleared ? 'New title' : 'Your title'}</p>
      <p className="new-title">{cleared?.title ?? state.title}</p>

      {nextReady && next ? (
        <>
          <p className="next-guardian">Next: {next.guardian}</p>
          <button className="button-primary" onClick={onDescend}>
            Descend to Floor {floorNumber + 1}
          </button>
        </>
      ) : (
        <p className="stairs-note">The stairs below are still being carved. Wait here, rogue.</p>
      )}
    </main>
  );
}
