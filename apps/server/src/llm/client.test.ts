import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { finishedText, isRetryable, trimToLastSentence } from './client.ts';

describe('trimToLastSentence', () => {
  it('drops the unfinished sentence at the end', () => {
    expect(trimToLastSentence('Grub likes you. The rune is BEAR-IR')).toBe('Grub likes you.');
    expect(trimToLastSentence('A VISITOR! Want a mushroom? This one is a')).toBe(
      'A VISITOR! Want a mushroom?',
    );
  });

  it('keeps closing quotes and ellipses with their sentence', () => {
    expect(trimToLastSentence('Boss said "Grub, don\'t tell." So Grub wo')).toBe(
      'Boss said "Grub, don\'t tell."',
    );
    expect(trimToLastSentence('Hmm… Grub forgot. And then')).toBe('Hmm… Grub forgot.');
  });

  it('does not treat a dot inside a word as a sentence end', () => {
    expect(trimToLastSentence('Grub has 4.5 mushrooms. Grub eats 2.5 of')).toBe(
      'Grub has 4.5 mushrooms.',
    );
  });

  it('leaves a reply that already ends cleanly alone', () => {
    expect(trimToLastSentence('Oh no. Oh NO.')).toBe('Oh no. Oh NO.');
  });

  it('keeps a reply with no complete sentence, marked as trailing off', () => {
    expect(trimToLastSentence('Grub thinks that the')).toBe('Grub thinks that the…');
    expect(trimToLastSentence('   ')).toBe('');
  });
});

describe('finishedText', () => {
  it('trims any reply that did not finish normally, a refusal included', () => {
    const cut = 'Ooh, posh! Alpha, Lima, Tango. Hehe, wait: Sierra, Alpha,';
    expect(finishedText(cut, 'refusal')).toBe('Ooh, posh! Alpha, Lima, Tango.');
    expect(finishedText(cut, 'max_tokens')).toBe('Ooh, posh! Alpha, Lima, Tango.');
    expect(finishedText(cut, 'end_turn')).toBe(cut);
  });
});

describe('isRetryable', () => {
  it('retries dropped connections and server trouble, never timeouts or bad requests', () => {
    expect(isRetryable(new Anthropic.APIConnectionError({ message: 'reset' }))).toBe(true);
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 529 })).toBe(true);
    // A timed-out call may already be billed: retrying could pay twice.
    expect(isRetryable(new Anthropic.APIConnectionTimeoutError())).toBe(false);
    expect(isRetryable(new Anthropic.APIUserAbortError())).toBe(false);
    expect(isRetryable({ status: 400 })).toBe(false);
  });
});
