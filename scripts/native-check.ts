// Proves the two native/heavy dependencies work on this machine:
// better-sqlite3 (with WAL mode) and a local MiniLM embedding for Floor 6.
// Run it on the Oracle ARM server too: `npm run native-check`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { EMBED_DIMS, loadEmbedder } from '../apps/server/src/embeddings/embed.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silvertongue-'));
const db = new Database(path.join(dir, 'check.db'));
const journalMode = db.pragma('journal_mode = WAL', { simple: true });
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`better-sqlite3: journal_mode = ${journalMode}`);

console.log(
  'Loading Xenova/all-MiniLM-L6-v2 into .cache/models (downloads ~23 MB the first time)…',
);
const embed = await loadEmbedder(); // the server's own loader, cache folder and warm-up
const vector = await embed('A shiny gift for the dragon');
console.log(`embedding dims: ${vector.length}`);

const ok = journalMode === 'wal' && vector.length === EMBED_DIMS;
console.log(ok ? 'NATIVE CHECK PASSED' : 'NATIVE CHECK FAILED');
process.exit(ok ? 0 : 1);
