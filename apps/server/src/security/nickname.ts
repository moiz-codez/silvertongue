// One nickname rule for joining and for the admin's rename, so they can never drift apart.
import { NICKNAME_MAX, NICKNAME_MIN } from '@silvertongue/shared/constants';
import { isProfane } from './profanity.ts';

export const cleanNickname = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

// In-character reason a nickname is refused, or null if it's fine. Never says which word matched.
export function nicknameProblem(nickname: string): string | null {
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return `Names need ${NICKNAME_MIN} to ${NICKNAME_MAX} characters.`;
  }
  if (!/^[A-Za-z0-9 _.-]+$/.test(nickname)) return 'Use letters, numbers, spaces, dots, - or _.';
  if (isProfane(nickname)) return 'Grub covers his ears. Pick a kinder name, tall-folk.';
  return null;
}

export const NICKNAME_TAKEN = 'Someone in the dungeon already goes by that name.';
