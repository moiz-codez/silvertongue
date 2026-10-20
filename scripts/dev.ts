// Starts the server and the Vite dev server together. Ctrl+C stops both.
import { execSync, spawn } from 'node:child_process';

const children = ['apps/server', 'apps/web'].map((workspace) =>
  // One command string (not an args array) because shell: true is needed for npm.cmd on Windows.
  spawn(`npm run dev -w ${workspace}`, { stdio: 'inherit', shell: true }),
);

function stopAll(code: number) {
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    // On Windows, kill() only stops the cmd.exe wrapper and leaves node running on the port.
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // Already gone.
      }
    } else {
      child.kill();
    }
  }
  process.exit(code);
}

for (const child of children) child.on('exit', (code) => stopAll(code ?? 0));
process.on('SIGINT', () => stopAll(0));
