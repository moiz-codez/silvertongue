# Running the demo from the laptop (Cloudflare quick tunnel)

The game runs on the Windows laptop. `cloudflared` opens a **quick tunnel**: Cloudflare gives a free `https://<random-words>.trycloudflare.com` address and forwards it to the laptop. That means:
- no account, domain, router or firewall setup;
- HTTPS and websockets come from Cloudflare;
- phones on mobile data reach it too.

`DEPLOY_ORACLE.md` is the optional, future alternative.

```
phones / projector / admin ──HTTPS──▶ Cloudflare ──tunnel──▶ cloudflared on the laptop ──▶ Node on 127.0.0.1:PORT
```

`npm run tunnel` does both steps:
1. It starts `cloudflared` and reads the address it prints.
2. It starts the production server with `PUBLIC_URL` set to that address, so the projector QR is always right.

It then checks `/health` **through the tunnel** every 15 seconds and prints a red banner if the game stops answering. If the game server crashes, only the server restarts (after 2 s, same address); phones reconnect and carry on by themselves. After 5 restarts in a minute it gives up with a red banner.

## Limits to know

- **The address changes every time `npm run tunnel` starts.** Players' saved progress lives in their phone's browser for that address. After a restart they re-scan the QR and join again with a new name. Their old progress stays in the database, but their phones can't get back to it. So start the tunnel once, before the class arrives, and leave it running.
- Quick tunnels are meant for testing: Cloudflare gives no uptime guarantee, and it documents a cap of 200 requests in flight at once. 40 phones, the projector and the admin page use about 45 connections.
- The laptop *is* the server: if it sleeps, loses power or loses internet, the game stops.

## One-time setup (already done on this laptop)

- **cloudflared:** install from Cloudflare's official downloads page (developers.cloudflare.com → Cloudflare Tunnel → Downloads), or with `winget install --id Cloudflare.cloudflared`. Check it with `cloudflared --version`.
- **`.env`:** `ANTHROPIC_API_KEY` and `ADMIN_TOKEN` are filled in. `PUBLIC_URL` in `.env` doesn't matter; `npm run tunnel` overrides it. `LLM_MODE` in `.env` only seeds the very first game: switch to Live on the admin page (see the start order).
- **Firewall:** when Windows asks whether Node may accept connections, untick **Public networks**. The tunnel is an *outgoing* connection, so the game needs no incoming access on university Wi-Fi.

## The day before

- [ ] `git pull` on `main`, `npm install`, `npm run check`, `npm run build`.
- [ ] Do a full rehearsal with `npm run tunnel`: projector, admin and a few phones on **mobile data**.
- [ ] Switch the laptop from Wi-Fi to the phone hotspot and back while the tunnel runs. Check that the projector and a phone keep working. This is the backup plan, so test it.
- [ ] Charge the laptop and the hotspot phone. Pack the charger and an HDMI adapter.
- [ ] Top up the Anthropic credit if spend is close to `BUDGET_USD`.
- [ ] Mock load test: with the server in mock mode, `npm run loadtest -- --players 40 --minutes 5` must report 0 unanswered.

## Demo day: laptop setup

- [ ] **Plugged in** to the charger the whole time.
- [ ] **Sleep disabled while plugged in.** Run once in PowerShell: `powercfg /change standby-timeout-ac 0` and `powercfg /change monitor-timeout-ac 0`. Undo afterwards with `powercfg /change standby-timeout-ac 30`. Also set "When I close the lid" (plugged in) to **Do nothing**.
- [ ] Windows Update: Settings → Windows Update → **Pause updates** for a week, so no forced restart.
- [ ] Turn on Focus / Do Not Disturb, so no notifications pop up on the projector.
- [ ] Close other apps that use the network heavily: OneDrive sync, game launchers, torrents.
- [ ] Connect to the best internet available. Have the **phone hotspot** ready as the backup.

## Demo day: start order

1. Open a terminal in `C:\dev\silvertongue` and run `npm run tunnel`. Wait for the green **READY** banner with the address. Leave this window open and visible to you, not on the projector.
2. **Projector:** on this laptop, open `http://localhost:3000/projector` full screen (F11). Use localhost, not the tunnel address, so the big screen keeps working even if the tunnel drops. The QR still shows the tunnel address.
3. **Admin:** on this laptop, open `http://localhost:3000/admin` in another window (or `<address>/admin` on a second device) and enter `ADMIN_TOKEN`. The status should be **LOBBY**.
4. **Check from your phone on mobile data, with Wi-Fi off:** scan the projector QR, join with a test name, see it on the projector, then kick it from the admin page.
5. Open /admin, set AI replies to Live in Live settings and press Apply, then confirm the header badge says LIVE. Do this after the final Reset, before the class joins. (Settings live in the database, not `.env`: changing `LLM_MODE` in `.env` doesn't change an existing game.)
6. Let the class scan. When everyone is in, press **Start game** on the admin page.

## If something goes wrong

- **Red "THE SERVER CRASHED" banner:** nothing to do. It restarts in 2 s on the same address and phones carry on. If it says **"KEEPS CRASHING"**, read the error above it, then run `npm run tunnel` again (new address).
- **Red "GAME IS NOT ANSWERING" banner:** if the server didn't just crash, the laptop's internet dropped. Switch to the phone hotspot. The tunnel usually reconnects by itself with the **same** address, and a green "Tunnel is back" banner appears. Pause the game meanwhile: the localhost admin page still works.
- **Red "THE TUNNEL DIED" banner:** run `npm run tunnel` again. The game state is kept, because a restart never resets progress. But it's a **new address**: the projector QR updates by itself, and players re-scan and join again.
- **"Budget reached" alert on the admin page:** the game paused itself at `BUDGET_USD`. Resume only if you mean to keep spending.
- **Phones stuck on "connecting":** check the projector page first. If the projector works, the problem is the phone's network; ask them to try mobile data.

## Afterwards

- Ctrl+C in the tunnel terminal stops both cloudflared and the server.
- Restore sleep: `powercfg /change standby-timeout-ac 30` (or your old value).
