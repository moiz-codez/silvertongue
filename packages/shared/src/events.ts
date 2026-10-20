// Socket.IO event types shared by server and phone. Nothing here may ever carry a rune.
import type { z } from 'zod';
import type { doorPayload, joinPayload, messagePayload, resumePayload } from './schemas.ts';

export type Speaker = 'player' | 'guardian' | 'system';
export type Expression = 'idle' | 'slipped';

export interface Bubble {
  id: number;
  floor: number;
  speaker: Speaker;
  text: string;
}

export interface ScoreLine {
  label: string;
  points: number;
  highlight?: boolean;
}

// Durations are "milliseconds from now", so a phone with a wrong clock still counts down correctly.
export interface PlayerState {
  nickname: string;
  floor: number;
  floorReady: boolean; // false while that floor isn't built yet
  score: number;
  title: string;
  messagesLeft: number;
  cooldownMs: number;
  doorLockedMs: number;
}

export interface FloorCleared {
  floor: number;
  lines: ScoreLine[];
  total: number;
  score: number;
  title: string;
  nextFloorReady: boolean;
}

export type JoinReply =
  { ok: true; playerId: string; token: string } | { ok: false; error: string };

export interface ClientToServerEvents {
  'player:join': (payload: z.infer<typeof joinPayload>, ack: (reply: JoinReply) => void) => void;
  'player:resume': (
    payload: z.infer<typeof resumePayload>,
    ack: (reply: { ok: boolean }) => void,
  ) => void;
  'player:message': (payload: z.infer<typeof messagePayload>) => void;
  'player:door': (payload: z.infer<typeof doorPayload>) => void;
}

export interface ServerToClientEvents {
  'player:state': (state: PlayerState) => void;
  'player:history': (history: { floor: number; bubbles: Bubble[] }) => void;
  'player:bubble': (bubble: Bubble) => void;
  'player:expression': (expression: { floor: number; state: Expression }) => void;
  'player:door-result': (result: { correct: boolean; lockedMs: number }) => void;
  'player:floor-cleared': (cleared: FloorCleared) => void;
  'player:error': (error: { code: string; message: string }) => void; // message is in character
}
