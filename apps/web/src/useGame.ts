// All the phone's game state in one hook. The server is the source of truth: this only
// mirrors what it sends, plus a few local things (the waiting line, countdowns).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bubble, Expression, FloorCleared, PlayerState } from '@silvertongue/shared/events';
import { FLOORS } from '@silvertongue/shared/floors';
import { loadToken, saveToken, socket } from './socket.ts';

export interface DoorNote {
  text: string;
  tone: 'wrong' | 'locked';
}

export function useGame() {
  const [token, setToken] = useState(loadToken);
  const tokenRef = useRef(token);
  const [state, setState] = useState<PlayerState | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [expression, setExpression] = useState<Expression>('idle');
  const [cleared, setCleared] = useState<FloorCleared | null>(null);
  const [waitingLine, setWaitingLine] = useState<string | null>(null);
  const [doorNote, setDoorNote] = useState<DoorNote | null>(null);
  // Local deadlines built from the server's "ms from now" values.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [doorLockedUntil, setDoorLockedUntil] = useState(0);

  const forget = useCallback(() => {
    saveToken(null);
    tokenRef.current = null;
    setToken(null);
    setState(null);
  }, []);

  useEffect(() => {
    // Runs on the first connect and after every reconnect (Wi-Fi drop, phone sleep).
    const onConnect = () => {
      const t = tokenRef.current;
      if (t) socket.emit('player:resume', { token: t }, (reply) => !reply.ok && forget());
    };
    const addLocal = (text: string) =>
      setBubbles((list) => [...list, { id: -Date.now(), floor: 0, speaker: 'system', text }]);

    socket.on('connect', onConnect);
    socket.on('player:state', (s) => {
      setState(s);
      setCooldownUntil(Date.now() + s.cooldownMs);
      setDoorLockedUntil(Date.now() + s.doorLockedMs);
    });
    socket.on('player:history', (h) => setBubbles(h.bubbles));
    socket.on('player:bubble', (b) => {
      setBubbles((list) => (list.some((x) => x.id === b.id) ? list : [...list, b]));
      if (b.speaker === 'guardian') setWaitingLine(null);
    });
    socket.on('player:expression', (e) => setExpression(e.state));
    socket.on('player:door-result', (r) => {
      if (r.correct) return setDoorNote(null);
      if (r.lockedMs > 0) {
        setDoorLockedUntil(Date.now() + r.lockedMs);
        setDoorNote({ text: 'The door grows cold. Wait.', tone: 'locked' });
      } else {
        setDoorNote({ text: 'The door doesn’t budge.', tone: 'wrong' });
      }
    });
    socket.on('player:floor-cleared', (c) => setCleared(c));
    socket.on('player:error', (e) => {
      setWaitingLine(null);
      addLocal(e.message);
    });
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      for (const event of [
        'player:state',
        'player:history',
        'player:bubble',
        'player:expression',
        'player:door-result',
        'player:floor-cleared',
        'player:error',
      ] as const) {
        socket.off(event);
      }
    };
  }, [forget]);

  async function join(nickname: string): Promise<string | null> {
    const reply = await socket.emitWithAck('player:join', { nickname });
    if (!reply.ok) return reply.error;
    saveToken(reply.token);
    tokenRef.current = reply.token;
    setToken(reply.token);
    return null;
  }

  function send(text: string) {
    const lines = FLOORS[state?.floor ?? 1]?.waitingLines ?? [];
    setWaitingLine(lines[Math.floor(Math.random() * lines.length)] ?? '…');
    socket.emit('player:message', { text });
  }

  function openDoor(guess: string) {
    setDoorNote(null);
    socket.emit('player:door', { guess });
  }

  function descend() {
    setCleared(null);
    setExpression('idle');
    setBubbles([]);
  }

  return {
    token,
    state,
    bubbles,
    expression,
    cleared,
    waitingLine,
    doorNote,
    cooldownUntil,
    doorLockedUntil,
    join,
    send,
    openDoor,
    descend,
  };
}

// Re-renders every 250 ms while `active`, for countdowns.
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
