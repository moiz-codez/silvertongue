# Deploying Silvertongue to the Oracle Cloud free VM

> **Optional / future.** Oracle had no free capacity, so the demo runs from the laptop through a Cloudflare quick tunnel: see `docs/DEPLOY_LAPTOP.md`. Keep this guide for a later move to a real server.

One VM runs everything: Caddy (HTTPS) → the Node process (Fastify + Socket.IO + SQLite). Commands below assume Ubuntu. Package commands change over time; if one fails, check the linked official docs for the current version.

## 1. The VM

- In the Oracle Cloud console, create an instance with an **Ubuntu** image.
- Shape: an **Ampere A1 (ARM)** shape if your Always Free allowance offers it (more CPU and RAM, good for the embeddings model). The small AMD micro shape also works, but it's tight on memory for Floor 6.
- Save the SSH private key and note the **public IP**.
- Oracle may reclaim Always Free instances that sit idle for long periods. Check Oracle's current idle-instance policy, and confirm the VM is still running a week before the demo.

## 2. A domain name (free)

Phones need a clean URL for the QR code, and HTTPS needs a hostname (a bare IP can't get a certificate). No paid domain is needed.
- **Use:** a free subdomain at duckdns.org (sign in with Google or GitHub), e.g. `silvertongue.duckdns.org`, pointed at the VM's public IP. Use it as `PUBLIC_URL` and in the Caddyfile.
- **Backup if DuckDNS is down or slow to update:** `<ip-with-dashes>.sslip.io`, e.g. `152-67-10-20.sslip.io`, which resolves to that IP with no signup. Certificate issuance on shared names like this can occasionally fail, so it's the fallback, not the plan.

The website and the game server are served from this one address (same origin), so there is no CORS configuration and no separate frontend host.

## 3. Open ports 80 and 443 (two places)

1. **Oracle console → your VCN → Security List → Add Ingress Rules:** source `0.0.0.0/0`, TCP, destination ports `80` and `443`.
2. **On the VM itself** (Oracle's Ubuntu images ship with restrictive iptables rules):
   ```bash
   sudo iptables -I INPUT -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT
   sudo netfilter-persistent save
   ```
If the site doesn't load from outside, one of these two is almost always the reason.

## 4. Install Node, build tools, Caddy

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git build-essential python3

# Node.js 24 LTS (NodeSource; see https://github.com/nodesource/distributions)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v

# Caddy (see https://caddyserver.com/docs/install for the current commands)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`build-essential` and `python3` are there in case `better-sqlite3` has no prebuilt binary for ARM64 and needs to compile.

## 5. The app

```bash
sudo useradd --system --create-home --shell /bin/bash silvertongue
sudo -iu silvertongue
git clone <your repo URL> app && cd app
npm ci
npm run build
mkdir -p data
nano .env        # fill in from .env.example: LLM_MODE=live, ANTHROPIC_API_KEY, ADMIN_TOKEN, PUBLIC_URL, DATABASE_PATH=./data/silvertongue.db
chmod 600 .env
exit
```

## 6. Run it with systemd

`/etc/systemd/system/silvertongue.service`:
```ini
[Unit]
Description=Silvertongue game server
After=network.target

[Service]
User=silvertongue
WorkingDirectory=/home/silvertongue/app
EnvironmentFile=/home/silvertongue/app/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now silvertongue
sudo systemctl status silvertongue
journalctl -u silvertongue -f      # live logs
```

## 7. HTTPS with Caddy

`/etc/caddy/Caddyfile`:
```
silvertongue.duckdns.org {
    reverse_proxy localhost:3000
}
```
```bash
sudo systemctl reload caddy
```
Caddy gets and renews the HTTPS certificate automatically and passes websocket upgrades through `reverse_proxy`.

## 8. Updating

```bash
sudo -iu silvertongue
cd app && git pull && npm ci && npm run build
exit
sudo systemctl restart silvertongue
```
Turn this into `scripts/deploy.ts` or a short documented routine once it works.

## 9. Checks after every deploy

- `https://<domain>/health` returns OK.
- Open the site on a phone using **mobile data** (not the same Wi-Fi), join, send a message: the socket connects and the reply arrives.
- The projector page shows the QR code with the right `PUBLIC_URL`.
- Run the `rune-security-auditor` subagent before the deploy, not after.

## 10. After the game

Back up the database for your report and reveal screenshots:
```bash
sudo -iu silvertongue sqlite3 app/data/silvertongue.db ".backup 'app/data/backup-$(date +%F).db'"
```
(Install the CLI with `sudo apt install -y sqlite3` if needed.)
