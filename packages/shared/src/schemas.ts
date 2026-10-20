import { z } from 'zod';
import { MAX_MESSAGE_CHARS } from './constants.ts';

export const echoPayload = z.object({
  text: z.string().max(MAX_MESSAGE_CHARS),
});
