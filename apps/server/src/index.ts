import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import type { ClientToServerEvents } from '@silvertongue/shared/events';
import { echoPayload } from '@silvertongue/shared/schemas';
import { loadEnv } from './config/env.ts';

const env = loadEnv();
const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true, llmMode: env.LLM_MODE }));

// After `npm run build`, the same process serves the web app (this is how production runs).
const webDist = path.join(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
}

const io = new Server<ClientToServerEvents>(app.server);

io.on('connection', (socket) => {
  socket.on('echo', (payload, ack) => {
    // Never trust the client: validate the payload even though it is typed.
    const parsed = echoPayload.safeParse(payload);
    if (!parsed.success || typeof ack !== 'function') return;
    ack({ text: parsed.data.text });
  });
});

await app.listen({ port: env.PORT, host: '0.0.0.0' });
