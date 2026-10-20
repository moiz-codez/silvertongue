// Payloads the phone sends. The server validates every one with these before using it.
// Limits here are generous upper bounds; the server applies the real rules (sanitize, 2–16 chars…).
import { z } from 'zod';

export const joinPayload = z.object({ nickname: z.string().max(64) });
export const resumePayload = z.object({ token: z.string().max(128) });
export const messagePayload = z.object({ text: z.string().max(2000) });
export const doorPayload = z.object({ guess: z.string().max(100) });
