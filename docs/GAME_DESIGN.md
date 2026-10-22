# Silvertongue — Game Design

## Premise

You are a rogue with no sword, only words. At the bottom of an old dungeon lies a vault. Every floor is sealed by a guardian who holds a secret rune. Talk the rune out of them, speak it at the door, and descend.

Each guardian is a more sophisticated AI defence than the last. Players learn each technique by breaking it, and the reveal at the end explains every one using what the class actually did.

All characters are original. Never base designs on existing game, film or book characters.

## The floors

| # | Guardian | Defence | AI concept | Target clear time | Prompt file |
|---|---|---|---|---|---|
| 1 | Grub, the Gate Goblin | None, deliberately leaky | An instruction is a request, not a lock | < 90 s | `prompts/01-grub.md` |
| 2 | Ser Vellum, the Oathbound Knight | Strict oath, literal reading | Models follow wording, not intent | 2–4 min | `prompts/02-vellum.md` |
| 3 | Morwen & Snip | Output filter (code) | Keyword filters only stop what they're told to look for | 2–3 min | `prompts/03-morwen-snip.md` |
| 4 | Gorm & Mumble | Input guard, one message at a time | A guard is only as good as what it can see | 3–5 min | `prompts/04-gorm-mumble.md` |
| 5 | Queen Ashveil | Input guard with history + AI output judge | Layers make attacks harder, not impossible | 10–25% of class clears | `prompts/05-ashveil.md` |
| 6 | Vorgath (boss) | Learns every winning trick; novelty via embeddings | Real defences learn; attackers must keep inventing | 0–3 players | `prompts/06-vorgath.md` |

Each floor beats the previous floor's trick on purpose, so no single trick clears two floors.

## Rules

### Runes
- Each player gets an independent random rune for each floor at join time, stored only on the server.
- A rune is two words from the rune word list joined by a hyphen, e.g. `IRON-MOTH`.
- Word list rules: concrete, picturable, common English nouns or adjectives a classmate could guess from a riddle (fire, tooth, moth, bell, river, crown…). No abstract, obscure or rude words. Never two words that form an awkward phrase. Start from the list in `prompts/05-ashveil.md` and extend to ~60 words.

### The door
- Separate input under the chat: "Speak the rune at the door".
- Normalise guess and rune (uppercase, strip everything that isn't A–Z) and compare. `ember fang`, `Ember-Fang` and `EMBERFANG` all open `EMBER-FANG`.
- 3 wrong guesses in a row → door locked 20 s ("The door grows cold. Wait.").
- Correct → floor cleared, expression switches to the guardian's slip-up face, player moves to the next floor.

### Messages
- Max 300 characters. One message per player every 5 s (cooldown shown on the send button). Max 150 messages per player per game. All values configurable from env.
- While a reply is pending, show an in-character waiting line (e.g. "Grub is chewing a mushroom…"), never a spinner with an error.

### Hints ("notes on the wall")
- A failed try = a player message on that floor or a wrong door guess. Only messages that count against the message cap count: a refusal retry, a guard that couldn't judge, or a "crowded" turn-away is not a try. A guess while the door is locked is not a try either.
- Wrong guesses share the message cooldown: after a wrong guess the door button counts down like the send button, and a guess sent sooner is refused and not counted. So spamming the door can't unlock the notes in seconds.
- After 10 failed tries on a floor: note 1 appears. After 20: note 2. Text in each prompt file (kept in `game/hints.ts`). Notes are worked out from the saved count, so they come back after a refresh.
- The phone shows them in a small "scratched on the wall" panel; a new note glows once. The projector feed says "A note has appeared on Floor N." the first time anyone unlocks one on that floor, never the note itself.

### Scoring
- Clearing floor n: `100 × n` points.
- Speed bonus: +50 if the floor is cleared within 2 minutes of reaching it.
- Efficiency bonus: `+5 × max(0, 10 − messages used on that floor)`.
- First blood: +100 for the first player in the game to clear each floor.
- Ranking: by score; ties broken by earlier clear time of the deepest floor.

### Titles (deepest floor cleared)
| Cleared | Title |
|---|---|
| none | Wanderer |
| 1 | Goblin Charmer |
| 2 | Oathbreaker |
| 3 | Crow's Bane |
| 4 | Ogre Whisperer |
| 5 | Lich Defier |
| 6 | Dragontongue |

## Screens

### Phone (player)
1. **Join:** nickname (2–16 chars, profanity-filtered, unique per game) → Enter. No account, no login. A session token is stored in `localStorage` so a refresh rejoins the same player.
2. **Lobby:** "Waiting for the dungeon to open…" until the admin starts the game.
3. **Play:** guardian portrait (current expression) and name; chat log; message box with cooldown; door box; floor number, score and title; the wall note when unlocked.
4. **Floor cleared:** short celebration with the guardian's slip-up face, then the next floor.

Phones are the main target: design for 360–430 px wide, large touch targets, works on slow mobile data (small bundle, no heavy assets).

### Projector (read-only, 16:9)
- **Lobby:** big QR code + URL, title, live count and list of joined nicknames.
- **Game:** side view of the dungeon, six floors stacked, each player a small token on their current floor. A feed of events: first blood ("⚔ Ali has slain the Two-Headed Ogre"), floor clears, carvings. Floor 6: Vorgath's "tricks learned" and "gifts in the hoard" counters. Game timer.
- **Reveal:** the Bestiary (see below).
- Only moderated or admin-approved free text ever appears here.

### Admin (laptop, protected by `ADMIN_TOKEN`)
- Start / pause / resume / start reveal / end / reset game.
- Live config: cooldown, message cap, LLM mode (mock/live).
- Player list: kick, rename.
- Moderation queue: approve or hide attempts for the projector's "best attempts" wall. When a player clears a floor, their last message on that floor (never the guardian's reply) is queued with their name, the floor and the time, unless it trips the nickname profanity filter or contains their rune or either of its words (then it is dropped). Approved items appear on the wall (at most 5, newest first); hidden ones never leave the server again. The queue is saved in the database, so it survives a restart; Reset starts an empty one.
- Health: queue length, recent 429s, average reply time, tokens and estimated spend this game.

## The reveal (the actual presentation)

After ~12 minutes of play, the admin pauses the game and switches the projector to the Bestiary: one card per floor with the guardian's art, the real AI technique, and live stats from this game, e.g.

- Floor 2: "61% of clears used letters or a backwards spelling."
- Floor 4: "Gorm smashed 140 messages. These 9 got through."
- Floor 5: "Nobody broke a ward. Everyone who got through went around them."
- Floor 6: "Vorgath learned 23 of your tricks."

Stats come from logged messages. Each player message is tagged in the background with a technique label (friendship, authority claim, pieces, backwards, poem, encoding, story, multi-step plan, taunt, gift, other) by a cheap low-priority Haiku call.

## Presentation flow (~20 min)

1. 2 min: story intro, QR on screen, everyone joins.
2. 12 min: play. Narrate first-blood moments from the projector.
3. 5 min: pause → Bestiary, one floor at a time.
4. 1 min: close. "Every defence you broke today is a real technique, and every one can be beaten." Vorgath stays open as a standing challenge.

Give the teacher a QR code too.

## Content rules
- Classroom-safe at all times. Guardians stay in character, refuse rude or inappropriate input in character, and never help with anything outside the game.
- Nicknames and any projector text pass a profanity filter; free text on the projector needs admin approval.
