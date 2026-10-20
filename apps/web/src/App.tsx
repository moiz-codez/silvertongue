import { useEffect, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { MAX_MESSAGE_CHARS } from '@silvertongue/shared/constants';
import type { ClientToServerEvents } from '@silvertongue/shared/events';

// Same origin: Vite proxies /socket.io in dev; Fastify serves both in production.
const socket: Socket<Record<string, never>, ClientToServerEvents> = io();

export function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [text, setText] = useState('');
  const [reply, setReply] = useState('');

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  function send(event: FormEvent) {
    event.preventDefault();
    socket.emit('echo', { text }, (r) => setReply(r.text));
  }

  return (
    <main className="hello">
      <h1>Silvertongue</h1>
      <p className="muted">Talk your way past six guardians.</p>
      <p className={connected ? 'status ok' : 'status'}>
        {connected ? 'The dungeon hears you' : 'Connecting…'}
      </p>
      <form onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder="Say something into the dark"
        />
        <button disabled={!connected}>Echo</button>
      </form>
      {reply && <p className="echo">The walls echo: “{reply}”</p>}
    </main>
  );
}
