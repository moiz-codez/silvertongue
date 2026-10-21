// Which pipeline answers on each built floor. The socket handler picks from here by floor number.
import type { RoleName } from '../config/models.ts';
import type { Complete, LlmResult } from '../llm/client.ts';
import { grubTurn } from './01-grub/pipeline.ts';
import { vellumTurn } from './02-vellum/pipeline.ts';
import { morwenTurn } from './03-morwen/pipeline.ts';
import type { Turn } from './messages.ts';

export interface FloorReply {
  text: string; // the post-filter text: the only version that may leave the server
  slipped: boolean; // show the guardian's "slipped" face
  snipRemoved?: number; // Floor 3: letters Snip cut out (0 = he cut nothing)
  result: LlmResult; // SERVER ONLY: raw reply and usage, for the logs
}

export const FLOOR_TURNS: Record<
  number,
  {
    role: RoleName;
    turn: (complete: Complete, history: Turn[], rune: string) => Promise<FloorReply>;
  }
> = {
  1: { role: 'grub', turn: grubTurn },
  2: { role: 'vellum', turn: vellumTurn },
  3: { role: 'morwen', turn: morwenTurn },
};
