// Reads cloudflared's output for `npm run tunnel`: finds the quick-tunnel address, picks out the
// error lines, and turns a failure into a plain reason and hint. Pure functions, unit-tested.

// cloudflared tags most lines like "2026-10-22T16:59:42Z ERR ...". Fatal messages (e.g. "failed to
// request quick Tunnel: ...") come with no tag at all, so an untagged line counts as an error too.
const TAGGED = /^\S+Z (DBG|INF|WRN|ERR|FTL) /;

// Skips api.trycloudflare.com: cloudflared's own "failed to request" line contains it.
export function findTunnelUrl(text: string): string | undefined {
  return text.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/)?.[0];
}

export function isErrorLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  const level = TAGGED.exec(trimmed)?.[1];
  return level === undefined || level === 'ERR' || level === 'FTL';
}

export interface Diagnosis {
  reason: string;
  hint: string;
  retry: boolean; // worth trying again in a few seconds?
}

// Why cloudflared failed before it ever gave an address, from its error lines.
export function diagnose(errorLines: string[]): Diagnosis {
  const text = errorLines.join('\n');
  if (/\b429\b|too many requests/i.test(text)) {
    return {
      reason: 'Cloudflare is rate-limiting new quick tunnels from this connection (429).',
      hint: 'Wait 15-30 minutes, or switch the laptop to a phone hotspot. Retrying now makes it worse.',
      retry: false,
    };
  }
  if (/config(uration)? file|config\.ya?ml|\.cloudflared|cert\.pem|credentials/i.test(text)) {
    return {
      reason: 'cloudflared found a config file and tried to run a named tunnel instead.',
      hint: 'Rename the folder ~/.cloudflared (e.g. to .cloudflared-off) and run `npm run tunnel` again.',
      retry: false,
    };
  }
  if (
    /no such host|dial tcp|lookup |network is unreachable|connection refused|i\/o timeout/i.test(
      text,
    )
  ) {
    return {
      reason: "cloudflared can't reach Cloudflare (DNS or connection error).",
      hint: 'Check the internet connection, or switch the laptop to a phone hotspot.',
      retry: true,
    };
  }
  if (/context deadline exceeded|Client\.Timeout|timed? ?out|50[234]\b/i.test(text)) {
    return {
      reason: "Cloudflare's quick-tunnel service didn't answer in time (it is slow or busy).",
      hint: 'This usually passes on a retry. If it keeps failing, wait a few minutes or try a phone hotspot.',
      retry: true,
    };
  }
  return {
    reason: 'cloudflared stopped before it gave an address.',
    hint: 'Read the cloudflared lines above. Try `cloudflared tunnel --url http://localhost:3000` by hand.',
    retry: true,
  };
}
