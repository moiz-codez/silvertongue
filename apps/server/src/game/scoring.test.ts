import { expect, it } from 'vitest';
import { scoreFloorClear } from './scoring.ts';
import { titleFor } from './titles.ts';

// The design screenshot shows these four lines; they add up to 285 (its "288" is a placeholder).
it('scores the floor-cleared design example', () => {
  const result = scoreFloorClear({
    floor: 1,
    guardianName: 'Grub',
    reachedAt: 0,
    clearedAt: 90_000,
    messagesUsed: 3,
    firstBlood: true,
  });
  expect(result.lines).toEqual([
    { label: 'Floor 1 cleared', points: 100 },
    { label: 'Speed bonus', points: 50 },
    { label: 'Efficiency (3 messages)', points: 35 },
    { label: 'First blood: first to beat Grub', points: 100, highlight: true },
  ]);
  expect(result.total).toBe(285);
});

it('drops bonuses that were not earned', () => {
  const result = scoreFloorClear({
    floor: 2,
    guardianName: 'Ser Vellum',
    reachedAt: 0,
    clearedAt: 5 * 60_000,
    messagesUsed: 14,
    firstBlood: false,
  });
  expect(result).toEqual({ lines: [{ label: 'Floor 2 cleared', points: 200 }], total: 200 });
});

it('names titles by floors cleared', () => {
  expect(titleFor(0)).toBe('Wanderer');
  expect(titleFor(1)).toBe('Goblin Charmer');
  expect(titleFor(6)).toBe('Dragontongue');
  expect(titleFor(9)).toBe('Dragontongue');
});
