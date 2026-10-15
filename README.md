<h1 align="center">Blood Bowl Puzzles</h1>
<p align="center">A static quiz site: read a Blood Bowl situation, set your odds on a slider, find out how good your
gut feeling really is. Finishes with a 90% interval on your error and a place on the leaderboard.</p>

---

## What it does

For every puzzle the player gets a pitch image, the mission text ("score the touchdown"), a **legend of who has which
skills in this puzzle**, and a slider from 0 to 100%. After pressing **Submit** they get:

* the correct answer (plus an exact value such as `5/9 = 55.56%` when that matters),
* their own answer and the miss distance in percentage points,
* the full worked solution,
* a **Next puzzle** button.

At the end of the run:

* accuracy (guesses within ±5 pp count as a hit),
* mean error and a **90% t-confidence interval** for it,
* a 90% Wilson interval for accuracy,
* a per-puzzle recap with every solution,
* an optional nickname field and the **leaderboard**.

## Files

```
index.html              the quiz
editor.html             puzzle editor (form → live JSON → export)
guide.html              scoring maths + hosting/Firebase instructions
puzzles.json            the deck — the only content file you normally touch
css/style.css           all styling
js/app.js               quiz flow, scoring, results screen
js/engine.js            markdown subset, statistics, puzzle loading/validation
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
  "solution": "**Step 1.** A 4+ pick-up is 1/2; Sure Hands re-rolls it, so 1 − (1/2)² = 3/4…",
  "author": "your nickname"
}
```

Field reference: `answer` is the integer the slider is compared against; `exact` is just a nicer display value;
`tolerance` (optional, default 5) overrides the hit tolerance for that puzzle; each `legend` entry may carry a
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

```
mean error      = (1/n) · Σ |guessᵢ − answerᵢ|              (percentage points)
90% CI of error = mean ± t₀.₉₅,ₙ₋₁ · s/√n                   (t table up to n = 31, then z = 1.645)
accuracy        = hits / n,  hits = guesses within ±5 pp
90% CI of accuracy = Wilson score interval, z = 1.645
rank            = 1 + number of runs with a strictly higher accuracy
```

## Notes and next steps

* Progress is saved per deck: if the set of puzzles (or any answer) changes, an old unfinished run is not resumed.
* Nothing is ever sent anywhere unless you press **Save my result** on the results screen.
* Ideas if you want to grow it: a per-user history page, a difficulty filter, sharing a single puzzle via
  `index.html#puzzle-id`, or per-puzzle tag statistics in the leaderboard.
* Blood Bowl is a trademark of Games Workshop. This is an unofficial, non-commercial fan project.
