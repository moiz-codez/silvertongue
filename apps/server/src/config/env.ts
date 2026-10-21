import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z
  .object({
    LLM_MODE: z.enum(['mock', 'live']).default('mock'),
    ANTHROPIC_API_KEY: z.string().default(''),
    ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN must be at least 16 characters'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    DATABASE_PATH: z.string().default('./data/silvertongue.db'),
    RATE_RPM: z.coerce.number().int().positive().default(800),
    RATE_ITPM: z.coerce.number().int().positive().default(400_000),
    RATE_OTPM: z.coerce.number().int().positive().default(64_000),
    COOLDOWN_MS: z.coerce.number().int().nonnegative().default(5000),
    MAX_MESSAGES_PER_PLAYER: z.coerce.number().int().positive().default(150),
    MAX_MESSAGE_CHARS: z.coerce.number().int().positive().default(300),
    BUDGET_USD: z.coerce.number().positive().default(4),
    JOIN_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60), // per address; a class shares one
  })
  .refine((env) => env.LLM_MODE === 'mock' || env.ANTHROPIC_API_KEY !== '', {
    message: 'ANTHROPIC_API_KEY is required when LLM_MODE=live',
    path: ['ANTHROPIC_API_KEY'],
  });

export type Env = z.infer<typeof EnvSchema>;

// Pure: validates whatever variables it is given. Throws a readable error listing every problem.
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

// The mode actually in use. A game saved as Live runs on the mock if this server has no API key
// (e.g. restarted without it), so the admin badge must show this, not the saved setting.
export function effectiveMode(saved: 'mock' | 'live', env: Env): 'mock' | 'live' {
  return saved === 'live' && env.ANTHROPIC_API_KEY !== '' ? 'live' : 'mock';
}

// Reads the repo-root .env (if there is one) into process.env, then validates it.
// Variables already set in the shell win over the file.
export function loadEnv(): Env {
  try {
    process.loadEnvFile(path.join(import.meta.dirname, '../../../../.env'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return parseEnv(process.env);
}
