import type { z } from 'zod';
import type { echoPayload } from './schemas.ts';

export type EchoPayload = z.infer<typeof echoPayload>;

export interface ClientToServerEvents {
  echo: (payload: EchoPayload, ack: (reply: EchoPayload) => void) => void;
}
