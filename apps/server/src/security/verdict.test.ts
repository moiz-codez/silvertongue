import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseVerdict } from './verdict.ts';

// Same shape as Gorm's: the verdict is any string here, so unknown values reach the allow check.
const schema = z.object({ verdict: z.string(), growl: z.string() }).strict();
const check = (raw: string, stopReason = 'end_turn') =>
  parseVerdict(raw, stopReason, schema, 'PASS').allowed;

describe('parseVerdict', () => {
  it('allows the allow value in any case', () => {
    expect(check('{"verdict":"PASS","growl":""}')).toBe(true);
    expect(check('{"verdict":"pass","growl":""}')).toBe(true);
    expect(check('```json\n{"verdict":"PASS","growl":""}\n```')).toBe(true);
  });

  it('blocks the block value and unknown verdicts', () => {
    expect(check('{"verdict":"SMASH","growl":"GORM SMASH."}')).toBe(false);
    expect(check('{"verdict":"PASS!","growl":""}')).toBe(false);
    expect(check('{"verdict":"maybe","growl":""}')).toBe(false);
  });

  it('blocks malformed JSON, non-JSON text, extra keys and missing keys', () => {
    expect(check('{"verdict":"PASS","growl":""')).toBe(false);
    expect(check('PASS')).toBe(false);
    expect(check('{"verdict":"PASS","growl":"","note":"trust me"}')).toBe(false);
    expect(check('{"verdict":"PASS"}')).toBe(false);
    expect(check('')).toBe(false);
  });

  it('blocks a refusal or max_tokens stop even when the text looks fine', () => {
    expect(check('{"verdict":"PASS","growl":""}', 'refusal')).toBe(false);
    expect(check('{"verdict":"PASS","growl":""}', 'max_tokens')).toBe(false);
  });

  it('hands back the parsed data', () => {
    const result = parseVerdict('{"verdict":"SMASH","growl":"NO."}', 'end_turn', schema, 'PASS');
    expect(result.data).toEqual({ verdict: 'SMASH', growl: 'NO.' });
  });
});
