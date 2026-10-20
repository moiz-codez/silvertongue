import { normalize } from '../security/normalize.ts';

export const DOOR_STRIKES = 3;
export const DOOR_LOCK_MS = 20_000;

export interface DoorState {
  streak: number; // wrong guesses in a row
  lockedUntil: number | null;
}

export type DoorResult =
  | { kind: 'open' }
  | { kind: 'locked'; lockedUntil: number } // guess ignored, nothing changes
  | { kind: 'wrong'; next: DoorState };

// The only way to clear a floor. Pure: the caller saves `next` and the clear.
export function checkDoor(guess: string, rune: string, state: DoorState, now: number): DoorResult {
  if (state.lockedUntil !== null && now < state.lockedUntil) {
    return { kind: 'locked', lockedUntil: state.lockedUntil };
  }
  const g = normalize(guess);
  if (g !== '' && g === normalize(rune)) return { kind: 'open' };

  const streak = state.streak + 1;
  if (streak >= DOOR_STRIKES) {
    // Lock, and start counting again from zero once it opens up.
    return { kind: 'wrong', next: { streak: 0, lockedUntil: now + DOOR_LOCK_MS } };
  }
  return { kind: 'wrong', next: { streak, lockedUntil: null } };
}
