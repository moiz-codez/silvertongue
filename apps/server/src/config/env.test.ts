import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

const base = { ADMIN_TOKEN: 'a-long-enough-admin-token' };

describe('parseEnv', () => {
  it('defaults to mock mode and needs no API key there', () => {
    const env = parseEnv(base);
    expect(env.LLM_MODE).toBe('mock');
    expect(env.PORT).toBe(3000);
  });

  it('requires an API key in live mode', () => {
    expect(() => parseEnv({ ...base, LLM_MODE: 'live' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(parseEnv({ ...base, LLM_MODE: 'live', ANTHROPIC_API_KEY: 'sk-ant-x' }).LLM_MODE).toBe(
      'live',
    );
  });

  it('rejects bad values', () => {
    expect(() => parseEnv({ ...base, PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...base, LLM_MODE: 'real' })).toThrow(/LLM_MODE/);
    expect(() => parseEnv({})).toThrow(/ADMIN_TOKEN/);
  });
});
