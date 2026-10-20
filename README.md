<h1 align="center">Blood Bowl Puzzles</h1>
<p align="center">A static quiz site: read a Blood Bowl situation, build the play with the action buttons ("block 2d, dodge…"),
and compare your answer with the correct play and — optionally — the real odds.</p>

---

## What it does

For every puzzle the player gets a pitch image, the mission text ("score the touchdown"), a **legend of who has which
skills in this puzzle**, and a panel of action buttons:

```
block 1d   block 2d   block uphill   dodge   gfi   pass   catch   clear
```

Every press appends that button's label to **Your solution**, so pressing *block 2d* and then *dodge* gives
`block 2d, dodge`; *clear* wipes the draft. Then they press **Submit** and get:

* the correct action sequence (if the puzzle defines one) and the full worked solution,
* **optionally** their odds prediction next to the correct odds — odds are no longer required and a puzzle may not
  have any; skipping them is one checkbox away,
* no win/lose verdict: just the right odds and the solution text,
* a **Next puzzle** button.

At the end of the run there is a **recap** with the correct odds and the solution for every puzzle, plus how many
puzzles were played and, if any odds were predicted, their mean error.

## Files

```
index.html              the quiz
editor.html             puzzle editor (form → live JSON → export)
guide.html              how it works + hosting/Firebase instructions
puzzles.json            the deck — the only content file you normally touch
css/style.css           all styling
js/app.js               quiz flow: action buttons, optional odds, reveal, recap
js/engine.js            markdown subset, action panel builders, statistics, puzzle loading/validation
js/leaderboard.js       Firebase OR localStorage behind one API
js/editor.js            editor logic and export
js/config.example.js    copy to js/config.js and paste your Firebase keys
firestore.rules         rules for the shared leaderboard
images/                 pitch artwork (demo files are generated SVGs)
site-src/build.py       validates the deck + checks every referenced file exists
site-src/generate_images.py  regenerates the demo pitch diagrams from coordinates
site-src/seed_puzzles.py     regenerates the demo deck
site-src/tests/         jsdom end-to-end tests + run-tests.sh
```

## Preview locally

Service workers are not used and there is no build step, but the site does `fetch('puzzles.json')`, and browsers refuse
that from `file://`. So run a one-liner server:

```bash
cd blood-bowl-puzzles
python3 -m http.server 8000     # then open http://localhost:8000
# or: npx serve .
```

## Tests

```bash
python3 site-src/build.py          # deck + file check (fast, no dependencies)
bash site-src/tests/run-tests.sh   # logic + jsdom end-to-end tests (needs npm, installs jsdom)
```

`run-tests.sh` copies the ES modules into a temp folder, installs jsdom there and then

* unit-tests the markdown subset, the t-interval, the Wilson interval and the puzzle loader,
* plays a full 6-puzzle run in a simulated DOM (slider → submit → reveal → results → leaderboard),
* exercises the editor (validation states, deck add/replace/reorder, paste import, export),
* checks the resume-an-unfinished-run flow and the "puzzles.json missing" error screen.

Run `python3 site-src/build.py` before every push: it fails if a puzzle has no image file, a
duplicate id, an answer outside 0–100 or no task text.

## Publish on GitHub Pages

1. Create a repository (for example `blood-bowl-puzzles`) and push this folder's contents to `main`.
2. **Settings → Pages → Source:** *Deploy from a branch*, branch `main`, folder `/ (root)`, **Save**.
3. A minute later: `https://<your-login>.github.io/blood-bowl-puzzles/`.

Name the repository `<your-login>.github.io` if you want it at the bare domain. The empty `.nojekyll` file is already
there so GitHub serves the folders as-is.

## Adding puzzles

Everything lives in `puzzles.json`. Author them in the browser:

1. Open `editor.html` (locally or on the deployed site).
2. Fill the form, watch the JSON and the live preview on the right.
3. **Add to export** for every puzzle — the deck order is the playing order.
4. **Download puzzles.json** and commit it over the old one. Put new images into `images/`.
5. Reload the site: the new deck is live. No rebuild, no deploy step.

A single puzzle looks like this:

```json
{
  "id": "pickup-01-loose-ball",
  "title": "The Loose Ball",
  "difficulty": "easy",
  "tags": ["pick-up", "reroll"],
  "image": "images/puzzle-01.svg",
  "imageAlt": "Pitch diagram: Blitzer next to a loose ball",
  "task": "Turn 8 … The ball lies in the tackle zone of **#5 Lineman**. Your **#1 Blitzer** has to pick it up (4+)…",
  "question": "What is the chance that you score the touchdown this turn? (%)",
  "legend": [
    { "name": "#1 Blitzer (your team)", "skills": ["Sure Hands", "Block"], "note": "MA 6 ST 3 AG 3+", "color": "blue" },
    { "name": "#5 Lineman (opponent)", "skills": [], "note": "MA 6 ST 3 AG 3+", "color": "red" }
  ],
  "answer": 75,
  "exact": "3/4 = 75%",
  "steps": ["block 2d", "dodge"],
  "solution": "**Step 1.** A 4+ pick-up is 1/2; Sure Hands re-rolls it, so 1 − (1/2)² = 3/4…",
  "author": "your nickname"
}
```

Field reference: `answer` is the optional correct odds (leave it out and the puzzle asks only "how to play");
`exact` is just a nicer display value; `steps` is the optional correct action sequence (use the button labels);
`actions` optionally replaces the button list for that puzzle; `tolerance` is kept for reference only; each `legend` entry may carry a
`color` — one of `blue`, `red`, `green`, `yellow`, `purple`, `white` — that tints the player's name, dot and skill
chips so the legend matches the markers on the pitch image (cosmetic only, omit it and the row is neutral);
`task` and `solution` accept a small
markdown subset — `**bold**`, `` `code` ``, `- ` bullets, blank lines for paragraphs. HTML is escaped, so anything you
paste is rendered literally.

### Pitch images

Use whatever you like — a screenshot from the video game, a photo of your tabletop board, or an exported SVG. Reference
it relative to the site root (`images/...`). The demo diagrams in `images/` were generated from coordinates by
`site-src/generate_images.py`; feel free to delete them.

## Shared leaderboard (Firebase, free tier)

The site ships with a **local** leaderboard (results are kept in the player's own browser) and switches to a **shared**
one automatically as soon as you configure Firebase.

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. **Build → Firestore Database → Create database** (production mode is fine, pick a region).
3. **Project settings → Your apps → Web `</>`** → register an app → copy the `firebaseConfig` values.
4. `cp js/config.example.js js/config.js`, paste your values, commit, push.
5. Paste `firestore.rules` into **Firestore → Rules** and publish. They allow public reads, shape-checked writes and
   nothing else.
6. Optional housekeeping: **Firestore → TTL** on `createdAt` if you want scores to expire.

Why a `config.js` and not just hardcoded keys? Because the file is optional: the repo stays runnable for anyone
(including you) without a Firebase project, and the code decides its mode at runtime. Firebase web keys are public by
design — the rules are the actual protection.

Prefer Supabase or jsonbin? Replace the two methods in `js/leaderboard.js` (`submit`, `top`, `rankOf`) — nothing else in
the app knows where the scores come from.

## Scoring maths

There is no pass/fail. If the player predicted odds, the site reports the absolute difference and, across the run,
the mean error over the puzzles where odds were actually predicted:

```
error           = |guess − answer|                          (percentage points)
mean error      = (1/n) · Σ errorᵢ                           (n = puzzles with odds predicted)
90% CI of error = mean ± t₀.₉₅,ₙ₋₁ · s/√n                   (t table up to n = 31, then z = 1.645)
```

## Notes and next steps

* Progress is saved per deck: if the set of puzzles (or any answer/solution sequence) changes, an old unfinished run
  is not resumed.
* Nothing is ever sent anywhere unless you press **Save my result** on the results screen.
* Ideas if you want to grow it: a per-user history page, a difficulty filter, sharing a single puzzle via
  `index.html#puzzle-id`, or per-puzzle tag statistics in the leaderboard.
* Blood Bowl is a trademark of Games Workshop. This is an unofficial, non-commercial fan project.
