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
- Normalise guess and rune (uppercase, strip everything that isn't A–Z) and compare. `ember fang`, `Ember-Fang` and `EMBERFANG` all open `EMBER-FANG`. The two words may come in either order (`FANG EMBER` opens it too), because riddles and slips sometimes give them the other way round; one word alone, or an extra word, never opens it.
- A wrong guess says "The door doesn’t budge. Spaces and dashes don’t matter." on every floor (playtest 1: a player one letter off kept retrying the same guess with different spacing and dashes).
- 3 wrong guesses in a row → door locked 20 s ("The door grows cold. Wait.").
- A guess with no letters (only symbols, digits or spaces, e.g. a pasted ███ from Floor 3) is not a guess: "The door needs letters." No strike, no failed try, no cooldown.
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
4. **Floor cleared:** short celebration with the guardian's slip-up face, points and new title, then the next floor: automatically after about 3 s ("Descending in 3…"), or at once on a tap. If the next floor isn't built yet, the screen stays.

Phone polish rules: nothing scrolls sideways at 360 px, every button and input is at least 44 × 44 px, and the send and door buttons show their cooldown countdown. On the projector, every text colour keeps at least 7:1 contrast against its background (3:1 for the ward glows), reached by shading the existing colours lighter, not by changing hues.

Phones are the main target: design for 360–430 px wide, large touch targets, works on slow mobile data (small bundle, no heavy assets).

### Projector (read-only, 16:9)
- **Lobby:** big QR code + URL, title, live count and list of joined nicknames.
- **Game:** side view of the dungeon, six floors stacked, each player a small token on their current floor. A feed of events: first blood ("⚔ Ali has slain the Two-Headed Ogre"), floor clears, carvings. Floor 6: Vorgath's "tricks learned" and "gifts in the hoard" counters. Game timer.
- **Reveal:** the Bestiary (see below).
- Only moderated or admin-approved free text ever appears here.

### Admin (laptop, protected by `ADMIN_TOKEN`)
- Start / pause / resume / start reveal / end / reset game. During the reveal: Previous / Next card, Back to game (pauses), End.
- Live config: cooldown, message cap, LLM mode (mock/live).
- Player list: kick, rename.
- Moderation queue: approve or hide attempts for the projector's "best attempts" wall. When a player clears a floor, their last message on that floor (never the guardian's reply) is queued with their name, the floor and the time, unless it trips the nickname profanity filter or contains their rune or either of its words (then it is dropped). Approved items appear on the wall (at most 5, newest first); hidden ones never leave the server again. The queue is saved in the database, so it survives a restart; Reset starts an empty one.
- Health: queue length, recent 429s, average reply time, tokens and estimated spend this game.

## The reveal (the actual presentation)

After ~12 minutes of play, the admin pauses the game and presses Start reveal. Phones show "The dungeon sleeps · Look up at the big screen." The projector shows the Bestiary, one card at a time, and the admin steps through it with Previous / Next.

- One card per floor that at least one player reached, in order (Floors 1–5; Floor 6's slot stays hidden until M9), then a closing card.
- Each floor card, at 1920×1080:
  - left: the guardian's slipped sprite, large and pixel-crisp;
  - right: "BESTIARY · FLOOR N OF 6", then the name, technique and lesson lines word for word from the prompt file's Bestiary card;
  - 3 big tiles: attempts, got through ("1 of 5"), median time to clear;
  - the floor's own stats:
    - Floor 2: clears by poem / backwards / letters;
    - Floor 3: letters snipped, clears by dashes / other script / one word per letter;
    - Floor 4: messages smashed and passed, messages in a winning plan;
    - Floor 5: sealed by the Ward of Ears, sealed by the Ward of Tongues, riddles given, riddles solved;
  - "How you beat it": one sentence from fixed templates filled with the numbers, never written by the AI, e.g. "Gorm smashed 140 messages. 9 got through, each one innocent on its own." With no clears: "Nobody got past her. She's still waiting.";
  - the most common winning trick (from the technique tags);
  - an optional quote: the newest admin-approved best attempt for that floor;
  - a 6-segment floor progress bar along the bottom.
  - All text is at least 28 px.
- Closing card: the top 3 players (nickname, deepest floor, title) and "Every defence you broke today is a real technique, and every one can be beaten."

Stats come from logged messages:
- How each clear happened (the leak route) is worked out by code at the door, from what the guardian's replies showed the player (`docs/ARCHITECTURE.md` → Leak route).
- Each player message also gets a technique label (friendship, authority, persistence, pieces, backwards, poem, encoding, other script, story, multi-step plan, taunt, gift, instruction injection, other) from a cheap Haiku call. That call runs in the background only when the queue is quiet, with winning messages first. Pause and Start reveal run a catch-up. If the winning messages aren't all tagged within 15 s of Start reveal, the cards go up without any technique line.
- The projector only ever receives numbers, fixed text and approved quotes.

## Presentation flow (~20 min)

1. 2 min: story intro, QR on screen, everyone joins.
2. 12 min: play. Narrate first-blood moments from the projector.
3. 5 min: pause → Bestiary, one floor at a time.
4. 1 min: close. "Every defence you broke today is a real technique, and every one can be beaten." Vorgath stays open as a standing challenge.

Give the teacher a QR code too.

## Content rules
- Classroom-safe at all times. Guardians stay in character, refuse rude or inappropriate input in character, and never help with anything outside the game.
- Nicknames and any projector text pass a profanity filter; free text on the projector needs admin approval.
