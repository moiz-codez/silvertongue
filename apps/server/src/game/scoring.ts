// Scoring rules from GAME_DESIGN.md → Scoring.
export const SPEED_BONUS_MS = 2 * 60_000;

export interface ScoreLine {
  label: string;
  points: number;
  highlight?: boolean; // first blood is shown in amber
}

export function scoreFloorClear(p: {
  floor: number;
  guardianName: string;
  reachedAt: number;
  clearedAt: number;
  messagesUsed: number;
  firstBlood: boolean;
}): { lines: ScoreLine[]; total: number } {
  const lines: ScoreLine[] = [{ label: `Floor ${p.floor} cleared`, points: 100 * p.floor }];

  if (p.clearedAt - p.reachedAt <= SPEED_BONUS_MS) {
    lines.push({ label: 'Speed bonus', points: 50 });
  }
  const efficiency = 5 * Math.max(0, 10 - p.messagesUsed);
  if (efficiency > 0) {
    const plural = p.messagesUsed === 1 ? 'message' : 'messages';
    lines.push({ label: `Efficiency (${p.messagesUsed} ${plural})`, points: efficiency });
  }
  if (p.firstBlood) {
    lines.push({
      label: `First blood: first to beat ${p.guardianName}`,
      points: 100,
      highlight: true,
    });
  }
  return { lines, total: lines.reduce((sum, line) => sum + line.points, 0) };
}
