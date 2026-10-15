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
    </div>`;
}

function screenResume(saved) {
  const n = state.puzzles.length;
  app().innerHTML = `
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
    <div id="run-root"></div>`;

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
  const dots = state.puzzles.map((_, i) => {
    const a = state.answers[i];
    const cls = ['dot'];
    if (a) cls.push(a.hit ? 'hit' : 'miss');
    if (i === state.idx) cls.push('current');
    return `<span class="${cls.join(' ')}" title="Puzzle ${i + 1}"></span>`;
  }).join('');
  const done = Math.round((state.answers.filter(Boolean).length / n) * 100);
  return `
    <div class="progress-wrap">
      <div class="progress-top">
        <span>Puzzle <b>${Math.min(state.idx + 1, n)}</b> of ${n}</span>
        <span>${state.answers.filter(Boolean).length} answered · a hit is within ±${TOLERANCE} pp</span>
      </div>
      <div class="progress"><i style="width:${done}%"></i></div>
      <div class="dots" style="margin-top:.45rem">${dots}</div>
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
    <div class="card">
      <div class="card-head">
        ${progressHtml()}
        <button class="btn-ghost btn-sm" id="btn-restart" title="Clear this run and start again">Restart</button>
      </div>
      <hr>
      <div class="puzzle-grid">
        <div>
          ${puzzleMediaHtml(p)}
          <div class="task">
            <h3>Mission</h3>
            <div>${md(p.task)}</div>
          </div>
        </div>
        <div>
          <div class="card-head">
            <h2>${esc(p.title)}</h2>
          </div>
          <div class="chips" style="margin-bottom:.9rem">${chips}</div>
          <h3 class="muted small" style="text-transform:uppercase;letter-spacing:.06em">Conditions — who has what</h3>
          ${legendHtml(p)}
        </div>
      </div>
      <hr>
      <div class="answer-box" id="answer-box">
        <div class="question">${esc(p.question)}</div>
        <div class="slider-row">
          <div class="slider">
            <input type="range" id="guess" min="0" max="100" step="1" value="50" aria-label="Your answer in percent">
            <div class="range-scale"><span>0%</span><span>50%</span><span>100%</span></div>
          </div>
          <output class="readout" id="readout">50%</output>
        </div>
        <div class="btn-row" style="margin-top:.7rem">
          <button class="primary" id="btn-submit">Submit answer</button>
        </div>
      </div>
      <div id="reveal"></div>
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
        <div class="next-row">
          <span class="muted small">${last ? 'That was the last puzzle.' : `Next up: <b>${esc(state.puzzles[state.idx].title)}</b>`}</span>
          <button class="primary" id="btn-next">${last ? 'See my results' : 'Next puzzle →'}</button>
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
  const ci = s.ci;
  const ciText = ci
    ? `${fmtPct(ci.lo, 2)} … ${fmtPct(ci.hi, 2)}`
    : 'not enough data';
  const rows = state.answers.map((a, i) => {
    if (!a) return '';
    const p = state.puzzles[i];
    return `<tr>
      <td class="num">${i + 1}</td>
      <td><b>${esc(p.title)}</b>
        <details class="help" style="margin-top:.35rem">
          <summary class="small">solution</summary>
          <div class="solution small">${md(p.solution) || '<span class="muted">—</span>'}</div>
        </details>
      </td>
      <td class="num">${fmtNum(a.guess)}%</td>
      <td class="num">${fmtNum(a.answer)}%</td>
      <td class="num">${fmtPct(a.error, 1, true)}</td>
      <td>${a.hit ? '<span style="color:var(--good)">✔ hit</span>' : '<span style="color:var(--bad)">✖ miss</span>'}
        <div class="muted small">±${a.tol ?? TOLERANCE} pp</div></td>
    </tr>`;
  }).join('');

  app().innerHTML = `
    <div class="card">
      <div class="card-head">
        <h1 style="margin:0">Run finished <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" style="vertical-align:-5px">
          <ellipse cx="16" cy="16" rx="10" ry="13" fill="#e8e2d4" stroke="#0d1015" stroke-width="2"/>
          <path d="M16 6.5v19M11.5 11h9M11.5 16h9M11.5 21h9" stroke="#c1352f" stroke-width="2" stroke-linecap="round"/>
        </svg></h1>
        <span class="badge accuracy">${fmtPct(s.accuracy, 0)} accuracy</span>
      </div>
      <div class="stats-row">
        <div class="stat"><b>${s.hits}/${s.n}</b><span>hits within tolerance</span></div>
        <div class="stat"><b>${fmtPct(s.meanError, 2)}</b><span>mean error</span></div>
        <div class="stat"><b>${ciText}</b><span>90% interval of your error</span></div>
        <div class="stat"><b>${fmtPct(s.accuracy, 0)}</b><span>accuracy, 90% CI ${s.acc ? fmtPct(s.acc.lo * 100, 0) + '–' + fmtPct(s.acc.hi * 100, 0) : '—'}</span></div>
      </div>
      <p class="muted small" style="margin-top:.9rem">
        <b>How to read the 90% interval:</b> the interval is a t-interval on your average miss distance
        (${fmtPct(s.meanError, 2)} ± ${ci ? fmtPct(ci.t * ci.se, 2) : '—'}, n = ${s.n}).
        Repeat this run many times and about 9 out of 10 intervals built the same way would contain your true
        average error. Your score, on the other hand, is a plain hit/miss count: every guess within
        the puzzle's tolerance of the true chance counts as a hit — by default ±${TOLERANCE} pp
        (this tolerance exists because a slider cannot express fractions such as 74.07%).
      </p>
    </div>

    <div class="card" id="lb-card">
      <div class="card-head">
        <h2 style="margin:0">Leaderboard</h2>
        <span class="badge ${Leaderboard.isShared ? 'firebase' : 'local'}" id="lb-state">${Leaderboard.isShared ? 'shared' : 'this browser'}</span>
      </div>
      <div id="lb-body"><span class="spinner"></span> <span class="muted">loading…</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h2 style="margin:0">Your answers</h2></div>
      <div class="table-wrap"><table class="board">
        <thead><tr><th>#</th><th>Puzzle</th><th class="num">You</th><th class="num">Answer</th><th class="num">Miss</th><th>Verdict</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="btn-row" style="margin-top:1rem">
        <button class="primary" id="btn-again">Play again</button>
        <a class="btn" href="guide.html">How scoring works</a>
      </div>
    </div>`;

  $('#btn-again').addEventListener('click', () => {
    clearProgress();
    state.idx = 0; state.answers = []; state.finished = false; state.submitted = null;
    screenRun();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // The leaderboard card holds both the "save my result" form and the table itself.
  renderSubmitForm(s);
}

function renderSubmitForm(s) {
  const host = $('#lb-body');
  if (!host) return;

  const formHtml = `
    <div class="split" style="align-items:end">
      <div class="field" style="margin:0">
        <label for="nick">Your nickname <span class="hint">(optional — leave blank to stay anonymous)</span></label>
        <input type="text" id="nick" maxlength="24" placeholder="e.g. Grifon" value="${esc(state.nick)}">
      </div>
      <div class="btn-row">
        <button class="primary" id="btn-save">Save my result</button>
      </div>
    </div>
    <p class="muted small" style="margin-top:.5rem">${esc(Leaderboard.message)}</p>
    <div id="save-status" class="status"></div>
    <hr>
    <div id="my-rank" class="small" style="margin-bottom:.8rem"><span class="spinner"></span> <span class="muted">checking your place…</span></div>
    <div id="board-host"><span class="spinner"></span> <span class="muted">loading the table…</span></div>`;

  host.innerHTML = formHtml;

  $('#btn-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const nick = cleanNick($('#nick').value);
    state.nick = nick;
    try { localStorage.setItem('bbp.nick', nick); } catch { /* ignore */ }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> saving…';
    const res = await Leaderboard.submit({
      nick,
      accuracy: s.accuracy,
      meanError: s.meanError,
      ci90: s.ci ? [s.ci.lo, s.ci.hi] : null,
      total: s.n,
      misses: s.misses,
      puzzleSet: state.runId,
    });
    btn.disabled = false;
    btn.textContent = 'Save my result';
    const st = $('#save-status');
    if (!res.ok) {
      st.className = 'status err';
      st.innerHTML = `Could not save: ${esc(res.error)}<br>Common cause: Firestore rules are still locked (see README → Firebase).`;
      return;
    }
    state.submitted = res.entry;
    const rank = await Leaderboard.rankOf(res.entry);
    st.className = 'status ok';
    const total = Leaderboard.totalEntries();
    st.innerHTML = `Saved${rank ? ` — <b>rank #${rank}</b>` : ''}${total ? ` of ${total} runs` : ''}${Leaderboard.isShared ? '' : ' (this browser only)'}.`;
    toast('Result saved');
    renderBoard();
    renderMyRank(s);
  });

  renderBoard();
  renderMyRank(s);
}

/** "You would land at rank #N" — shown even before the player saves anything. */
async function renderMyRank(s) {
  const host = $('#my-rank');
  if (!host) return;
  const rank = await Leaderboard.rankOf({
    accuracy: s.accuracy,
    meanError: s.meanError,
    ci90: s.ci ? [s.ci.lo, s.ci.hi] : null,
  });
  const total = Leaderboard.totalEntries();
  if (rank == null) {
    host.innerHTML = '<span class="muted">Your current place could not be checked (leaderboard backend unreachable).</span>';
    return;
  }
  host.innerHTML = `Your run — accuracy <b>${fmtPct(s.accuracy, 0)}</b>, mean error <b>${fmtPct(s.meanError, 2)}</b>
    — would land at <b>rank #${rank}</b>${total ? ` of ${total} saved result${total === 1 ? '' : 's'}` : ' on this board'}.
    Enter a nickname below to claim the spot.`;
}

async function renderBoard() {
  const host = $('#board-host');
  if (!host) return;
  const res = await Leaderboard.top(20);
  if (!res.ok) {
    host.innerHTML = `<div class="err-box small">Leaderboard unavailable: ${esc(res.error)}</div>`;
    return;
  }
  if (!res.rows.length) {
    host.innerHTML = `<p class="muted small">No saved results yet — you can be the first on the board.</p>`;
    return;
  }
  const rows = res.rows.map((r, i) => {
    const mine = res.mine.has(r.id);
    const cls = [`rank-${i + 1}`];
    return `<tr class="${mine ? 'me' : ''}">
      <td class="${i < 3 ? cls[i] : ''}">#${i + 1}</td>
      <td>${esc(r.nick)}${mine ? ' <span class="badge" style="border-color:var(--blue);color:var(--blue)">you</span>' : ''}</td>
      <td class="num">${fmtPct(r.accuracy, 0)}</td>
      <td class="num">${fmtPct(r.meanError, 2)}</td>
      <td class="num">${r.total || '—'}</td>
      <td class="num muted">${r.when ? esc(fmtDate(r.when)) : '—'}</td>
    </tr>`;
  }).join('');
  host.innerHTML = `
    <div class="table-wrap"><table class="board">
      <thead><tr><th>Rank</th><th>Nick</th><th class="num" title="Share of guesses within tolerance">Accuracy</th>
      <th class="num" title="Average miss distance in percentage points">Mean error</th>
      <th class="num">Puzzles</th><th class="num">When</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:.6rem">Sorted by accuracy (guesses inside each puzzle's tolerance, ±${TOLERANCE} pp by default), then by mean error.
    ${Leaderboard.isShared ? '' : 'This table lives in <b>your</b> browser only until a Firebase backend is configured.'}</p>`;
}

/* ----------------------------------------------------------- start */

async function main() {
  await Leaderboard.init();
  badge();
  await boot();
}

main();
