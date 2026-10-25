# Demo day: one-page checklist

The details behind each step are in `DEPLOY_LAPTOP.md`. Rule of thumb: **a slower game beats an error screen**. When in doubt, press **Pause game** and take a breath.

## The night before

- [ ] `git pull` on `main`, `npm install`, `npm run check`, `npm run build`.
- [ ] `.env`: `ADMIN_TOKEN` must be a long random string, **not** the example value (`npm run preflight` fails if it is). Write it down somewhere you can type it from.
- [ ] Rehearse with `npm run tunnel`: projector, admin and two phones on **mobile data**.
- [ ] **Test ngrok tonight**, so the backup is known to work:
  1. Close the tunnel. In window 1, run `npm run serve -- --url https://snuggle-steerable-subatomic.ngrok-free.dev`.
  2. In window 2, run `ngrok http --domain=snuggle-steerable-subatomic.ngrok-free.dev 3000`.
  3. Join from a phone on mobile data (tap **Visit Site** on ngrok's warning page), then Ctrl+C both windows.
- [ ] Charge the laptop and the hotspot phone. Pack the charger and the HDMI adapter.
- [ ] Laptop: sleep off while plugged in, Windows Update paused, Focus/Do Not Disturb on (commands in `DEPLOY_LAPTOP.md`).

## Arriving in class (before starting anything)

1. Plug in, connect to the best internet, and keep the phone hotspot ready.
2. Run **`npm run preflight` BEFORE starting the server.** Its port check fails if the server is already running. Every line must say PASS. It makes one tiny real AI call, which costs a fraction of a cent.

## Starting: try these in order

1. **Cloudflare tunnel:** `npm run tunnel`. Wait for the green **READY** banner.
2. **If it won't start:** the banner says why, and it retries twice by itself. If it gives up, use **ngrok**: run the two commands from "The night before", one per window. Warn the class that ngrok shows a **Visit Site** page first.
3. **If ngrok fails too:** use **same Wi-Fi**. Run `npm run serve` with no `--url`; the QR then shows the laptop's Wi-Fi address. Only phones on the same Wi-Fi (or the laptop's hotspot) can join.

Then:
1. Open the projector on `http://localhost:3000/projector` (F11 for full screen).
2. Open admin on `http://localhost:3000/admin`, then press **Reset** (click twice).
3. Under **Live settings**, set **AI replies: Live**, then **Apply settings**. Check that the badge says LIVE.
4. Join from your own phone on mobile data, check it on the projector, then kick it.
5. Let the class scan. When everyone is in, press **Start game**.

## During the game: watch the admin page

- **Spend this game** stays well under the budget (a full game is about $0.70).
- **Waiting in queue** should be about 0. **Crowded** and **Rate-limited, last minute** should be 0. A few now and then is fine: the phones show an in-character "crowded" line and the player simply tries again.
- **Best attempts:** press **Approve** on good ones to put them on the projector wall, and **Hide** on anything unkind.
- **Switch Floor 6 off:** untick **Floor 6 (Vorgath) open**, then **Apply settings**. Players who cleared Floor 5 see "stairs not built". Tick it again to reopen.
- **Pause:** **Pause game** freezes the timer and phones; **Resume game** carries on.

## The reveal

1. Press **Start reveal**. The class's messages are labelled first; the admin shows progress.
2. Step through the Bestiary cards with **Next** and **Previous**. **Back to game** returns to play if you need it.
3. The last card is the closing card. When you're done, press **End game** (click twice).

## If X goes wrong, do Y

| Problem | What to do |
|---|---|
| **Tunnel won't start** | Read the red banner; it retries by itself after 10 s and 30 s. If it gives up, switch to **ngrok**, then same Wi-Fi (see "Starting"). |
| **Tunnel was running, then died** | Run `npm run tunnel` again. It gives a new address: everyone re-scans and joins again. Or switch to ngrok, whose address never changes. |
| **Phones can't join** | Does the projector still update? If not, see "Projector frozen". If it does, the problem is the phones' network: ask them to switch to mobile data. On ngrok, they must tap **Visit Site**. "Too many new adventurers": wait a minute and try again. |
| **API errors or many "crowded" messages** | Press **Pause game** and check the laptop's internet (switch to the hotspot). For "crowded", raise **Seconds between messages** to 10 and Apply. If the AI stays down, set **AI replies: Mock** and treat it as a walkthrough: the mock answers instantly. |
| **Game paused itself: "Budget reached"** | The budget brake worked. Press **Resume game** only if you mean to keep spending. Otherwise go straight to **Start reveal**. |
| **Projector frozen** | Press F5 on the projector page. It always reloads the whole picture. If it still won't load, check the server window for a red banner: the server restarts itself after a crash. |
| **Server window shows "KEEPS CRASHING"** | Read the error above it, then start again the same way. Progress is kept in the database. |
