// Payloads the phone sends. The server validates every one with these before using it.
// Limits here are generous upper bounds; the server applies the real rules (sanitize, 2–16 chars…).
import { z } from 'zod';

export const joinPayload = z.object({ nickname: z.string().max(64) });
export const resumePayload = z.object({ token: z.string().max(128) });
export const messagePayload = z.object({ text: z.string().max(2000) });
export const doorPayload = z.object({ guess: z.string().max(100) });

// Admin payloads (only accepted on the /admin namespace, after the ADMIN_TOKEN check).
export const adminCommandPayload = z.object({
  type: z.enum(['start', 'pause', 'resume', 'reveal', 'end', 'reset', 'next', 'prev']),
});
// Live settings from the admin screen. Cooldown 0–60 s, cap 1–500 messages.
export const configPayload = z.object({
  cooldownMs: z.number().int().min(0).max(60_000),
  maxMessages: z.number().int().min(1).max(500),
  llmMode: z.enum(['mock', 'live']),
});
export const moderatePayload = z.object({
  id: z.number().int().positive(),
  action: z.enum(['approve', 'hide']),
});
export const kickPayload = z.object({ playerId: z.string().max(64) });
export const renamePayload = z.object({
  playerId: z.string().max(64),
  nickname: z.string().max(64),
});
