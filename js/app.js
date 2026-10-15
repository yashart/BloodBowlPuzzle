/* ============================================================
   app.js — the quiz itself: run through the puzzles, get a score,
   a 90% interval on your error and a place on the leaderboard.
   ============================================================ */

import {
  loadPuzzles, md, esc, fmtPct, fmtNum, fmtDate, setId, mean,
  puzzleMediaHtml, legendHtml, tInterval90, wilson, toast,
} from './engine.js';
import { Leaderboard, cleanNick } from './leaderboard.js';

/** A guess counts as "correct" when it is within this many percentage points.
 *  A puzzle may override it with its own "tolerance" field. */
const TOLERANCE = 5;
const tolOf = (p) => (isFinite(p?.tolerance) && p.tolerance >= 0 ? p.tolerance : TOLERANCE);
const PROGRESS_KEY = 'bbp.progress.';

const $ = (sel, root = document) => root.querySelector(sel);
const app = () => $('#app');

const state = {
  puzzles: [],
  idx: 0,
  answers: [],       // {guess, answer, error, hit}
  runId: '',
  nick: '',
  finished: false,
  submitted: null,
  savedProgress: null,
};

/* ----------------------------------------------------------- storage */

function loadProgress(runId) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY + runId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.answers) && data.idx < state.puzzles.length) return data;
  } catch { /* ignore */ }
  return null;
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY + state.runId, JSON.stringify({
      idx: state.idx, answers: state.answers, savedAt: Date.now(),
    }));
  } catch { /* ignore */ }
}

function clearProgress() {
  try { localStorage.removeItem(PROGRESS_KEY + state.runId); } catch { /* ignore */ }
}

try { state.nick = localStorage.getItem('bbp.nick') || ''; } catch { /* ignore */ }

/* ----------------------------------------------------------- boot */

async function boot() {
  badge();
  try {
    state.puzzles = await loadPuzzles('puzzles.json');
  } catch (err) {
    return screenError('Cannot load puzzles.json', err.message);
  }
  state.runId = setId(state.puzzles);

  const saved = loadProgress(state.runId);
  if (saved && saved.answers.length) {
    state.savedProgress = saved;
    state.idx = saved.idx;
    state.answers = saved.answers;
    screenResume(saved);
  } else {
    screenRun();
  }
}

function badge() {
  const el = $('#lb-badge');
  if (!el) return;
  el.textContent = Leaderboard.isShared ? 'Leaderboard: online' : 'Leaderboard: this browser';
  el.className = 'badge ' + (Leaderboard.isShared ? 'firebase' : 'local');
  el.title = Leaderboard.message;
}

/* ----------------------------------------------------------- screens */

function screenError(title, message) {
  app().innerHTML = `
    <div class="zen-page">
    <div class="card">
      <h1>⚠️ ${esc(title)}</h1>
      <div class="err-box small">${esc(message)}</div>
      <p class="muted small" style="margin-top:.8rem">
        Checklist: <code>puzzles.json</code> must sit next to <code>index.html</code>;
        the file must be valid JSON (run it through a JSON validator);
        and the page should be served over http(s) — browsers refuse to read local JSON from <code>file://</code>.
      </p>
      <div class="btn-row"><button class="primary" onclick="location.reload()">Try again</button>
      <a class="btn btn-ghost" href="editor.html">Open the puzzle editor</a></div>
    </div>
    </div>`;
}

function screenResume(saved) {
  const n = state.puzzles.length;
  app().innerHTML = `
    <div class="zen-page">
      <div class="banner">
        <div style="flex:1 1 320px">
          <b>Unfinished run found.</b>
          <div class="muted small">You answered ${saved.answers.length} of ${n} puzzles before. Continue where you stopped, or start again from puzzle 1.</div>
        </div>
        <div class="btn-row">
          <button class="primary" id="btn-resume">Continue (puzzle ${saved.idx + 1})</button>
          <button class="btn-ghost" id="btn-fresh">Start over</button>
        </div>
      </div>
      <div id="run-root"></div>
    </div>`;

  $('#btn-resume').addEventListener('click', () => {
    $('.banner')?.remove();
    screenRun();
  });
  $('#btn-fresh').addEventListener('click', () => {
    clearProgress();
    state.idx = 0; state.answers = []; state.savedProgress = null;
    $('.banner')?.remove();
    screenRun();
  });
}

function progressHtml() {
  const n = state.puzzles.length;
  const done = Math.round((state.answers.filter(Boolean).length / n) * 100);
  return `
    <div class="zen-top">
      <div class="zen-progress"><i style="width:${done}%"></i></div>
      <div class="zen-count">Puzzle <b>${Math.min(state.idx + 1, n)}</b> / ${n}</div>
    </div>`;
}

function screenRun() {
  const n = state.puzzles.length;
  if (state.idx >= n) return screenResults();
  const p = state.puzzles[state.idx];
  const chips = [
    `<span class="chip ${p.difficulty}">${esc(p.difficulty)}</span>`,
    ...p.tags.map(t => `<span class="chip tag">${esc(t)}</span>`),
  ].join('');

  app().innerHTML = `
    <div class="zen">
      ${progressHtml()}
      <div class="zen-main">
        <div class="zen-sheet">
          <div class="puzzle-grid">
            <div class="zen-media">${puzzleMediaHtml(p)}</div>
            <div class="zen-side">
              <div class="zen-title-row">
                <h2 class="zen-title">${esc(p.title)}</h2>
                <div class="chips">${chips}</div>
              </div>
              <div class="task">
                <h3>Mission</h3>
                <div>${md(p.task)}</div>
              </div>
              <h3 class="zen-sub">Conditions — who has what</h3>
              ${legendHtml(p)}
            </div>
          </div>
        </div>
      </div>
      <div class="zen-foot">
        <div class="answer-box" id="answer-box">
          <div class="question">${esc(p.question)}</div>
          <div class="slider-row">
            <div class="slider">
              <input type="range" id="guess" min="0" max="100" step="1" value="50" aria-label="Your answer in percent">
              <div class="range-scale"><span>0%</span><span>50%</span><span>100%</span></div>
            </div>
            <output class="readout" id="readout">50%</output>
          </div>
          <div class="btn-row btn-center">
            <button class="primary btn-lg" id="btn-submit">Submit answer</button>
          </div>
          <div class="btn-row btn-center">
            <button class="link-btn" id="btn-restart" title="Clear this run and start again">Restart run</button>
          </div>
        </div>
        <div id="reveal"></div>
      </div>
    </div>`;

  const slider = $('#guess');
  const readout = $('#readout');
  const paint = () => {
    readout.textContent = slider.value + '%';
    slider.style.setProperty('--pct', slider.value + '%');
  };
  slider.addEventListener('input', paint);
  paint();

  $('#btn-submit').addEventListener('click', () => reveal(Number(slider.value)));
  slider.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-submit').click(); });
  $('#btn-restart').addEventListener('click', () => {
    if (!confirm('Restart the run from puzzle 1? Your current answers will be lost.')) return;
    clearProgress();
    state.idx = 0; state.answers = []; state.finished = false; state.submitted = null;
    screenRun();
  });
}

/* ----------------------------------------------------------- answer + reveal */

function reveal(guess) {
  const p = state.puzzles[state.idx];
  const tol = tolOf(p);
  const error = Math.abs(guess - p.answer);
  const hit = error <= tol;
  state.answers[state.idx] = { guess, answer: p.answer, error, hit, tol };
  state.idx = Math.min(state.idx + 1, state.puzzles.length);
  saveProgress();

  const box = $('#answer-box');
  $('button#btn-submit', box)?.setAttribute('disabled', 'disabled');
  const slider = $('#guess');
  if (slider) slider.disabled = true;

  const last = state.idx >= state.puzzles.length;
  const verdict = hit
    ? `<b>${fmtPct(error, 1)} off — good enough.</b> This puzzle counts anything within ±${tol} pp.`
    : `<b>${fmtPct(error, 1)} off — that one hurt.</b> This puzzle needs you within ±${tol} pp.`;

  $('#reveal').innerHTML = `
    <div class="result ${hit ? 'hit' : 'miss'}">
      <div class="result-head">${hit ? '✔ Correct' : '✖ Missed'} <span class="muted small" style="font-weight:500">(${esc(p.title)})</span></div>
      <div class="result-body">
        <div class="verdict-grid">
          <div class="stat"><b>${esc(String(p.answer))}%</b><span>correct answer</span></div>
          <div class="stat"><b>${esc(String(guess))}%</b><span>your answer</span></div>
          <div class="stat"><b>${fmtPct(error, 1)}</b><span>error</span></div>
        </div>
        <div class="muted small" style="margin:-.3rem 0 .8rem">${verdict}${p.exact ? ' Exact value: <code>' + esc(p.exact) + '</code>.' : ''}</div>
        <div class="solution">
          <h3>Solution</h3>
          ${md(p.solution) || '<p class="muted">No solution text was written for this puzzle yet.</p>'}
        </div>
        <div class="next-row btn-center">
          <span class="muted small">${last ? 'That was the last puzzle.' : `Next up: <b>${esc(state.puzzles[state.idx].title)}</b>`}</span>
          <div class="btn-row btn-center">
            <button class="primary btn-lg" id="btn-next">${last ? 'See my results' : 'Next puzzle →'}</button>
          </div>
        </div>
      </div>
    </div>`;

  $('#btn-next').addEventListener('click', () => {
    if (last) { state.finished = true; clearProgress(); screenResults(); }
    else screenRun();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#reveal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ----------------------------------------------------------- results */

function computeStats() {
  const answers = state.answers.filter(Boolean);
  const n = answers.length;
  const errors = answers.map(a => a.error);
  const hits = answers.filter(a => a.hit).length;
  const ci = tInterval90(errors);
  const acc = wilson(hits, n);
  const missed = answers.filter(a => !a.hit);
  return {
    n, hits, misses: n - hits,
    accuracy: n ? (hits / n) * 100 : 0,
    meanError: n ? mean(errors) : 0,
    ci,
    acc,
    worst: answers.length ? answers.reduce((w, a) => (a.error > w.error ? a : w), answers[0]) : null,
    answers,
    missed,
  };
}

function screenResults() {
  const s = computeStats();

  app().innerHTML = `
    <div class="zen-page">
      <div class="results-head">
        <h1>Run finished</h1>
      </div>
      <div class="stats-row">
        <div class="stat"><b>${fmtPct(s.meanError, 2)}</b><span>mean error</span></div>
      </div>

      <div class="btn-row btn-center zen-actions">
        <button class="primary btn-lg" id="btn-again">Run again</button>
      </div>
    </div>`;

  $('#btn-again').addEventListener('click', () => {
    clearProgress();
    state.idx = 0; state.answers = []; state.finished = false; state.submitted = null;
    screenRun();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ----------------------------------------------------------- start */

async function main() {
  await Leaderboard.init();
  badge();
  await boot();
}

main();
