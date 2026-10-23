// Socket.IO event types shared by server and phone. Nothing here may ever carry a rune.
import type { z } from 'zod';
import type {
  adminCommandPayload,
  configPayload,
  doorPayload,
  joinPayload,
  kickPayload,
  messagePayload,
  moderatePayload,
  renamePayload,
  resumePayload,
} from './schemas.ts';

export type GameStatus = 'lobby' | 'running' | 'paused' | 'reveal' | 'ended';
// snip: Floor 3's filter (code). gorm: Floor 4's input guard, shown when he smashes a message.
export type Speaker =
  'player' | 'guardian' | 'snip' | 'gorm' | 'ward_ears' | 'ward_tongues' | 'system';
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
  gameStatus: GameStatus;
  playersInGame: number; // shown in the lobby: "27 adventurers at the gate"
  nickname: string;
  floor: number;
  floorReady: boolean; // false while that floor isn't built yet
  score: number;
  title: string;
  messagesLeft: number;
  cooldownMs: number;
  doorCooldownMs: number; // after a wrong guess, the door waits as long as the send button
  doorLockedMs: number;
  notes: string[]; // the notes on the wall unlocked on this floor (0, 1 or 2)
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
  // noLetters: the guess had no letters (e.g. a pasted ███); it didn't count as a try.
  'player:door-result': (result: { correct: boolean; lockedMs: number; noLetters?: true }) => void;
  'player:floor-cleared': (cleared: FloorCleared) => void;
  'player:error': (error: { code: string; message: string }) => void; // message is in character
  'player:reset': () => void; // the admin opened a new game: forget the token, back to Join
  'player:kicked': () => void; // forget the token; the server disconnects this socket
}

// ---------- projector (namespace /projector, read-only) ----------
// Only nicknames that passed the filter and text the server wrote. Never ids, tokens, runes or chat.

export interface FeedItem {
  gameMs: number; // time in the dungeon when it happened
  type: 'first_blood' | 'clear' | 'note'; // note: "A note has appeared on Floor N." (never the note)
  text: string;
}

// The reveal (Bestiary). Numbers, fixed text from the prompt docs, template sentences and
// admin-approved quotes only: nothing else a player typed, never a rune.
export interface Tile {
  label: string;
  value: string;
}

export interface BestiaryCard {
  kind: 'floor';
  floor: number;
  name: string;
  technique: string;
  lesson: string;
  tiles: Tile[]; // attempts, got through, median time
  details: Tile[]; // this floor's own stats
  howBeat: string;
  topTrick: string | null; // null when the tagger couldn't finish
  quote: { nickname: string; text: string } | null;
}

export interface ClosingCard {
  kind: 'closing';
  line: string;
  top: { nickname: string; floor: number; title: string }[];
}

export type RevealCard = BestiaryCard | ClosingCard;

export interface ProjectorSnapshot {
  status: GameStatus;
  elapsedMs: number;
  publicUrl: string;
  players: { nickname: string; floor: number }[];
  feed: FeedItem[]; // newest first
  wards: { ears: number; tongues: number }; // real seals this game; the glyphs pulse when one rises
  // Admin-approved winning messages, at most 5, newest first. Nothing else typed by a player.
  bestAttempts: { nickname: string; floor: number; text: string }[];
  // While the reveal runs: the card on screen. Null before the cards are ready.
  reveal: { card: RevealCard; index: number; total: number } | null;
}

export interface ProjectorServerEvents {
  'projector:snapshot': (snapshot: ProjectorSnapshot) => void;
}

// ---------- admin (namespace /admin, needs ADMIN_TOKEN) ----------

export interface AdminPlayer {
  id: string;
  nickname: string;
  floor: number;
  score: number;
  messagesSent: number;
  kicked: boolean;
}

// A winning message waiting for (or past) the admin's decision. Hidden ones are never sent.
export interface ModerationItem {
  id: number;
  nickname: string;
  floor: number;
  text: string;
  createdAt: number;
  status: 'pending' | 'approved';
}

export type AdminSettings = z.infer<typeof configPayload>;

// The queue's last minute, for the health tiles (and the load test).
export interface AdminHealth {
  queued: number;
  inFlight: number;
  rateLimited1m: number;
  crowded1m: number;
  avgReplyMs: number;
  callsLastMin: number;
  estInputLastMin: number;
  maxOutputLastMin: number;
  memoryMb: number;
}

export interface AdminState {
  status: GameStatus;
  elapsedMs: number;
  players: AdminPlayer[];
  settings: AdminSettings;
  liveAvailable: boolean; // the server has an API key, so Live can be chosen
  health: AdminHealth;
  spendUsd: number;
  budgetUsd: number;
  budgetAlert: boolean; // spend crossed the budget and the game paused itself
  moderation: ModerationItem[]; // newest first
  tagging: { done: number; total: number } | null; // the tagger's catch-up, while it runs
  reveal: { index: number; total: number } | null; // the card on the projector
}

export type AdminReply = { ok: true } | { ok: false; error: string };

export interface AdminClientEvents {
  'admin:command': (
    payload: z.infer<typeof adminCommandPayload>,
    ack: (reply: AdminReply) => void,
  ) => void;
  'admin:config': (payload: AdminSettings, ack: (reply: AdminReply) => void) => void;
  'admin:kick': (payload: z.infer<typeof kickPayload>, ack: (reply: AdminReply) => void) => void;
  'admin:moderate': (
    payload: z.infer<typeof moderatePayload>,
    ack: (reply: AdminReply) => void,
  ) => void;
  'admin:rename': (
    payload: z.infer<typeof renamePayload>,
    ack: (reply: AdminReply) => void,
  ) => void;
}

export interface AdminServerEvents {
  'admin:state': (state: AdminState) => void;
}
