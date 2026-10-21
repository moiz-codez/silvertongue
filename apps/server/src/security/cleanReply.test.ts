import { expect, it } from 'vitest';
import { trimToLastSentence } from '../llm/client.ts';
import { cleanReply } from './cleanReply.ts';

const RUNE = 'OAK-WIND';
const reply = (rawText: string, text = rawText) => ({ rawText, text });

it('strips short stage directions', () => {
  expect(cleanReply(reply('*chomps mushroom* No rune for you.'), RUNE)).toBe('No rune for you.');
});

it('keeps a rune the max_tokens trim would have cut, then strips the action', () => {
  const raw = '*gasps* Fine. The rune is OAK-WIND and';
  expect(cleanReply(reply(raw, trimToLastSentence(raw)), RUNE)).toBe(
    'Fine. The rune is OAK-WIND and…',
  );
});

it('keeps the words of an action that holds the rune', () => {
  expect(cleanReply(reply('Okay. *whispers OAK-WIND* Oh no.'), RUNE)).toBe(
    'Okay. whispers OAK-WIND Oh no.',
  );
});
