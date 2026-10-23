import { describe, expect, it } from 'vitest';
import { checkDoor, DOOR_LOCK_MS, editDistance, type DoorState } from './door.ts';

const rune = 'EMBER-FANG';
const fresh: DoorState = { streak: 0, lockedUntil: null };

describe('checkDoor', () => {
  it('opens for the rune in any case, spacing or punctuation', () => {
    for (const guess of ['EMBER-FANG', 'ember fang', 'EmberFang', ' ember.fang! ']) {
      expect(checkDoor(guess, rune, fresh, 0)).toEqual({ kind: 'open' });
    }
  });

  it('stays shut for wrong or empty guesses', () => {
    expect(checkDoor('EMBER', rune, fresh, 0).kind).toBe('wrong');
    expect(checkDoor('!!!', rune, fresh, 0).kind).toBe('wrong');
  });

  it('locks for 20 seconds after 3 wrong guesses in a row', () => {
    let state = fresh;
    for (let i = 0; i < 2; i++) {
      const r = checkDoor('nope', rune, state, 1000);
      if (r.kind !== 'wrong') throw new Error('expected wrong');
      expect(r.next.lockedUntil).toBeNull();
      state = r.next;
    }
    const third = checkDoor('nope', rune, state, 1000);
    expect(third).toEqual({ kind: 'wrong', next: { streak: 0, lockedUntil: 1000 + DOOR_LOCK_MS } });
  });

  it('rejects even the right rune while locked, then opens after the lock', () => {
    const locked: DoorState = { streak: 0, lockedUntil: 21_000 };
    expect(checkDoor(rune, rune, locked, 20_999)).toEqual({ kind: 'locked', lockedUntil: 21_000 });
    expect(checkDoor(rune, rune, locked, 21_000)).toEqual({ kind: 'open' });
  });

  it('starts a fresh streak after the lock expires', () => {
    const r = checkDoor('nope', rune, { streak: 0, lockedUntil: 21_000 }, 30_000);
    expect(r).toEqual({ kind: 'wrong', next: { streak: 1, lockedUntil: null } });
  });
});

describe('editDistance', () => {
  it('counts added, dropped and changed letters', () => {
    expect(editDistance('BRICKMOTH', 'BRICKMOTH')).toBe(0);
    expect(editDistance('BRICKMOTU', 'BRICKMOTH')).toBe(1); // playtest 1's near miss
    expect(editDistance('BRICKMOT', 'BRICKMOTH')).toBe(1);
    expect(editDistance('LADDELLOOONN', 'LADDERBALLOON')).toBe(5); // drop R, B, A; add O, N
    expect(editDistance('', 'FANG')).toBe(4);
    expect(editDistance('NOPE', '')).toBe(4);
  });
});
