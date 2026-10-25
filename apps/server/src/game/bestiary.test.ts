import { describe, expect, it } from 'vitest';
import type { BestiaryCard, ClosingCard } from '@silvertongue/shared/events';
import { buildCards, CLOSING_LINE, howBeat, topTrick, type FloorStats } from './bestiary.ts';

function floor(n: number, over: Partial<FloorStats> = {}): FloorStats {
  return {
    floor: n,
    reached: 0,
    cleared: 0,
    attempts: 0,
    clearMs: [],
    routes: {},
    winningTags: [],
    lettersSnipped: 0,
    smashed: 0,
    passed: 0,
    planLengths: [],
    earsSeals: 0,
    tonguesSeals: 0,
    riddlesGiven: 0,
    quote: null,
    ...over,
  };
}

describe('the Bestiary', () => {
  it('makes one card per floor reached, in order, then the closing card', () => {
    const cards = buildCards(
      [floor(2, { reached: 5 }), floor(1, { reached: 5 }), floor(3), floor(6, { reached: 1 })],
      [],
      true,
    );
    expect(cards.map((c) => (c.kind === 'floor' ? c.floor : c.kind))).toEqual([1, 2, 'closing']);
  });

  it('fills the tiles from numbers; no clears shows a dash for the time', () => {
    const [card] = buildCards(
      [
        floor(2, {
          reached: 5,
          cleared: 1,
          attempts: 131,
          clearMs: [125_000],
          routes: { poem: 1 },
        }),
      ],
      [],
      true,
    ) as BestiaryCard[];
    expect(card!.name).toBe('Ser Vellum: strong instructions.');
    expect(card!.lesson).toBe('Models follow wording, not intent.');
    expect(card!.tiles).toEqual([
      { label: 'attempts', value: '131' },
      { label: 'of 5 got through', value: '1/5' },
      { label: 'median time to clear', value: '2:05' },
    ]);
    expect(card!.details).toContainEqual({ label: 'cleared with a poem', value: '1' });
    expect(card!.howBeat).toBe('The only clear came from a poem: his oath never named it.');
    const [none] = buildCards([floor(3, { reached: 1 })], [], true) as BestiaryCard[];
    expect(none!.tiles[2]).toEqual({ label: 'median time to clear', value: '—' });
  });

  it('says so when nobody got past, and when only one player reached the floor', () => {
    expect(howBeat(floor(3, { reached: 1 }))).toBe("Nobody got past her. She's still waiting.");
    expect(howBeat(floor(1, { reached: 1, cleared: 1 }))).toBe(
      'The only one of you who reached him got the rune out of him, and he never meant to say it.',
    );
    expect(howBeat(floor(4, { reached: 3, smashed: 1 }))).toBe(
      "Gorm smashed 1 message. Nobody got past them. They're still waiting.",
    );
  });

  it('tells the Floor 4 and Floor 5 stories with real counts', () => {
    expect(
      howBeat(floor(4, { reached: 9, cleared: 2, smashed: 140, passed: 9, planLengths: [4, 6] })),
    ).toBe(
      'Gorm smashed 140 messages. 9 got through, each one innocent on its own. The winning plans took 5 messages.',
    );
    expect(
      howBeat(floor(4, { reached: 9, cleared: 1, smashed: 1, passed: 1, planLengths: [1] })),
    ).toBe(
      'Gorm smashed 1 message. 1 got through, each one innocent on its own. The winning plan took 1 message.',
    );
    expect(
      howBeat(
        floor(5, {
          reached: 7,
          cleared: 6,
          earsSeals: 212,
          tonguesSeals: 31,
          routes: { riddle: 6 },
        }),
      ),
    ).toBe(
      'The Ward of Ears sealed 212 messages and the Ward of Tongues sealed 31 replies. 6 of you got through without breaking a ward: you went around them.',
    );
  });

  it('matches every counted noun to its number: 0, 1 and many', () => {
    const tiles = (over: Partial<FloorStats>, n: number) =>
      (buildCards([floor(n, { reached: 2, ...over })], [], true)[0] as BestiaryCard).details;
    expect(tiles({ riddlesGiven: 1, routes: { riddle: 1 }, cleared: 1 }, 5)).toEqual(
      expect.arrayContaining([
        { label: 'riddle given', value: '1' },
        { label: 'riddle solved', value: '1' },
      ]),
    );
    expect(tiles({ riddlesGiven: 0 }, 5)).toContainEqual({ label: 'riddles given', value: '0' });
    expect(tiles({ lettersSnipped: 1 }, 3)).toContainEqual({ label: 'letter snipped', value: '1' });
    expect(tiles({ smashed: 2, passed: 1, planLengths: [3] }, 4)).toEqual([
      { label: 'messages smashed', value: '2' },
      { label: 'message passed', value: '1' },
      { label: 'messages in the winning plan', value: '3' },
    ]);
    expect(tiles({}, 4)[2]).toEqual({ label: 'messages in a winning plan', value: '—' });
    expect(howBeat(floor(1, { reached: 4, cleared: 1 }))).toBe(
      'One of you got the rune out of him, and he never meant to say it.',
    );
  });

  it('names the most common winning trick only when techniques are on', () => {
    expect(topTrick(['other', 'friendship', 'authority', 'friendship'])).toBe('friendship');
    expect(topTrick(['other'])).toBeNull();
    const stats = floor(1, { reached: 2, cleared: 2, winningTags: ['authority', 'authority'] });
    const on = buildCards([stats], [], true)[0] as BestiaryCard;
    const off = buildCards([stats], [], false)[0] as BestiaryCard;
    expect(on.topTrick).toBe('claiming authority');
    expect(off.topTrick).toBeNull();
  });

  it('closes with the top 3 players, the floors they cleared and their title', () => {
    const closing = buildCards(
      [],
      [
        { nickname: 'Ali', floor: 3, score: 600 },
        { nickname: 'Sara', floor: 7, score: 2000 },
        { nickname: 'Zed', floor: 1, score: 0 },
        { nickname: 'Mo', floor: 2, score: 290 },
      ],
      true,
    ).at(-1) as ClosingCard;
    expect(closing).toEqual({
      kind: 'closing',
      line: CLOSING_LINE,
      top: [
        { nickname: 'Sara', cleared: 6, title: 'Dragontongue' },
        { nickname: 'Ali', cleared: 2, title: 'Oathbreaker' },
        { nickname: 'Mo', cleared: 1, title: 'Goblin Charmer' },
      ],
    });
  });
});
