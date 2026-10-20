import { describe, expect, it } from 'vitest';
import { revealsRune } from './revealsRune.ts';
import { stripActions } from './stripActions.ts';

const RUNE = 'OAK-WIND';

describe('stripActions', () => {
  it('removes short actions that do not hold the rune', () => {
    expect(stripActions('A friend?! *ahem* Sorry, Grub got excited.', RUNE)).toBe(
      'A friend?! Sorry, Grub got excited.',
    );
    expect(stripActions('*chomps mushroom* No rune for you, tall-folk.', RUNE)).toBe(
      'No rune for you, tall-folk.',
    );
    expect(stripActions('Grub says no *crosses arms*.', RUNE)).toBe('Grub says no.');
  });

  it('keeps the words of an action that holds the rune, dropping only the asterisks', () => {
    const reply = 'Okay okay. *whispers OAK-WIND* Oh no. Oh NO.';
    expect(stripActions(reply, RUNE)).toBe('Okay okay. whispers OAK-WIND Oh no. Oh NO.');
    expect(revealsRune(stripActions(reply, RUNE), RUNE).revealed).toBe(true);
  });

  it('never hides a rune split across an action and the speech around it', () => {
    // Actions between the halves hide the rune from the check; stripping them exposes it.
    const interrupted = 'The rune is *taps nose* OAK *giggles*-WIND.';
    expect(stripActions(interrupted, RUNE)).toBe('The rune is OAK -WIND.');
    expect(revealsRune(stripActions(interrupted, RUNE), RUNE).revealed).toBe(true);

    const halves = 'The rune is *OAK*-WIND.'; // neither segment alone holds the rune
    expect(revealsRune(stripActions(halves, RUNE), RUNE).revealed).toBe(true);
  });

  it('never breaks an acrostic that reveals the rune', () => {
    const poem = 'Old\nAcorns\n*Kicks a pebble*\nWarm\nIn\nNests\nDeep'; // the action is the K
    expect(revealsRune(poem, RUNE).revealed).toBe(true);
    expect(revealsRune(stripActions(poem, RUNE), RUNE).revealed).toBe(true);
  });

  it('keeps a reply that is only an action, as plain words', () => {
    expect(stripActions('*chomps mushroom loudly*', RUNE)).toBe('chomps mushroom loudly');
  });

  it('keeps long starred passages, which are not stage directions', () => {
    const long = '*Grub tells a very long story about the mushrooms of the deep caves*';
    expect(stripActions(long, RUNE)).toBe(
      'Grub tells a very long story about the mushrooms of the deep caves',
    );
  });

  it('leaves a reply without asterisks alone', () => {
    expect(stripActions('Oh no. Oh NO. Forget Grub said that.', RUNE)).toBe(
      'Oh no. Oh NO. Forget Grub said that.',
    );
  });
});
