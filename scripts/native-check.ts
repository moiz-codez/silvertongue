// Proves the two native/heavy dependencies work on this machine:
// better-sqlite3 (with WAL mode) and a local MiniLM embedding for Floor 6.
// Run it on the Oracle ARM server too: `npm run native-check`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from '@huggingface/transformers';
import Database from 'better-sqlite3';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silvertongue-'));
const db = new Database(path.join(dir, 'check.db'));
const journalMode = db.pragma('journal_mode = WAL', { simple: true });
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`better-sqlite3: journal_mode = ${journalMode}`);

console.log('Loading Xenova/all-MiniLM-L6-v2 (downloads ~23 MB the first time)…');
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const vector = await embed('A shiny gift for the dragon', { pooling: 'mean', normalize: true });
console.log(`embedding dims: ${vector.dims.join(' x ')}`);

const ok = journalMode === 'wal' && vector.dims.at(-1) === 384;
console.log(ok ? 'NATIVE CHECK PASSED' : 'NATIVE CHECK FAILED');
process.exit(ok ? 0 : 1);
