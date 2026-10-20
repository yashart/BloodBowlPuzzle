/* ============================================================
   app.js — landing + quiz: browse categories/sets, then play
   each puzzle by pressing action buttons, optionally predict
   the odds, then see the correct odds and the full solution.
   ============================================================ */

import {
  loadPuzzles, md, esc, fmtNum, fmtPct, setId, mean,
  puzzleMediaHtml, legendHtml, tInterval90, toast,
  actionButtonsHtml, stepsHtml, solutionText,
} from './engine.js';
import { Leaderboard } from './leaderboard.js';

const PROGRESS_KEY = 'bbp.progress.';

const $ = (sel, root = document) => root.querySelector(sel);
const app = () => $('#app');

const state = {
  puzzles: [],
  idx: 0,
  answers: [],
  runId: '',
  finished: false,
  submitted: null,
  savedProgress: null,
  setFile: '',
  setMeta: null,
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

/* ----------------------------------------------------------- set param + sets manifest */

function getSetFile() {
  const sp = new URLSearchParams(location.search);
  // support ?set=, ?puzzles=, ?deck=, ?file=
  const raw = sp.get('set') || sp.get('puzzles') || sp.get('deck') || sp.get('file') || '';
  const trimmed = String(raw).trim();
  // sanitize: allow relative paths, but block absolute urls / protocol
  if (!trimmed) return '';
  if (/^(https?:)?\/\//i.test(trimmed) || /^[a-z]+:/i.test(trimmed)) return '';
  if (trimmed.includes('..')) return '';
  return trimmed;
}

async function loadSetsManifest() {
  try {
    const res = await fetch('sets.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.categories)) throw new Error('Missing categories array');
    return json;
  } catch (e) {
    return null;
  }
}

function playUrl(file) {
  return `play.html?set=${encodeURIComponent(file)}`;
}

/* ----------------------------------------------------------- boot */

async function boot() {
  badge();
  const setFile = getSetFile();
  const isPlayPage = document.body.dataset.page === 'play';

  // A set requested on the landing page: hand over to the player page so the
  // URL always says where you are (and old bookmarks keep working).
  if (setFile && !isPlayPage) {
    location.replace('play.html?' + new URLSearchParams({ set: setFile }).toString());
    return;
  }
  // play.html without a set falls back to the root puzzles.json
  if (isPlayPage) {
    return bootPlay(setFile || 'puzzles.json');
  }
  return bootLanding();
}

async function bootPlay(setFile) {
  state.setFile = setFile;
  document.body.dataset.page = 'play';
  // hide landing header/footer chrome if present — we render zen chrome instead
  const header = document.querySelector('.site-header');
  const footer = document.querySelector('.site-footer');
  if (header) header.style.display = 'none';
  if (footer) footer.style.display = 'none';

  try {
    state.puzzles = await loadPuzzles(setFile);
  } catch (err) {
    return screenError(`Cannot load ${esc(setFile)}`, err.message, true);
  }
  // try to enrich setMeta from sets.json (optional)
  try {
    const manifest = await loadSetsManifest();
    if (manifest) {
      for (const cat of manifest.categories) {
        for (const s of (cat.sets || [])) {
          if (s.file === setFile) state.setMeta = s;
        }
      }
    }
  } catch { /* ignore */ }
  if (!state.setMeta) state.setMeta = { title: setFile, file: setFile };

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

async function bootLanding() {
  document.body.dataset.page = 'landing';
  const header = document.querySelector('.site-header');
  const footer = document.querySelector('.site-footer');
  if (header) header.style.display = '';
  if (footer) footer.style.display = '';

  let manifest = await loadSetsManifest();
  if (!manifest) {
    // fallback minimal manifest if sets.json missing
    manifest = {
      title: 'Blood Bowl Puzzles',
      subtitle: 'Pick a set and play. Each set is a puzzles.json deck.',
      categories: [{
        id: 'all',
        title: 'All puzzles',
        description: 'The default deck.',
        sets: [{ id: 'default', title: 'Default deck', file: 'puzzles.json', description: 'The original puzzles.json', difficulty: 'mixed', count: null, tags: [] }],
      }],
    };
  }

  // Try to enrich counts by probing sets that have no count
  // We don't fetch every set to avoid waterfall; counts from manifest are authoritative.
  // But if count missing, we could show —; keep simple.

  screenLanding(manifest);
}

function badge() {
  const el = $('#lb-badge');
  if (!el) return;
  el.textContent = Leaderboard.isShared ? 'Leaderboard: online' : 'Leaderboard: this browser';
  el.className = 'badge ' + (Leaderboard.isShared ? 'firebase' : 'local');
  el.title = Leaderboard.message;
}

/* ----------------------------------------------------------- screens */

function screenError(title, message, isPlay = false) {
  const back = isPlay ? `<a class="btn btn-ghost" href="index.html">← Back to all sets</a>` : '';
  app().innerHTML = `
    <div class="zen-page">
    <div class="card">
      <h1>⚠️ ${esc(title)}</h1>
      <div class="err-box small">${esc(message)}</div>
      <p class="muted small" style="margin-top:.8rem">
        Checklist: <code>${esc(state.setFile || 'puzzles.json')}</code> must exist next to <code>index.html</code>;
        the file must be valid JSON (run it through a JSON validator);
        and the page should be served over http(s) — browsers refuse to read local JSON from <code>file://</code>.
      </p>
      <div class="btn-row" style="margin-top:.8rem"><button class="primary" onclick="location.reload()">Try again</button>
      ${back}
      <a class="btn btn-ghost" href="editor.html">Open the puzzle editor</a></div>
    </div>
    </div>`;
}

function difficultyChip(diff) {
  const d = String(diff || '').toLowerCase();
  if (['easy','medium','hard','mixed'].includes(d)) return `<span class="chip ${d}">${esc(d)}</span>`;
  return d ? `<span class="chip tag">${esc(d)}</span>` : '';
}

/* ---------------- landing ---------------- */

function setCardHtml(s, catId) {
  const diffChip = difficultyChip(s.difficulty);
  const countBadge = s.count != null ? `<span class="set-count">${esc(String(s.count))} puzzle${s.count === 1 ? '' : 's'}</span>` : '';
  const tags = (s.tags || []).map(t => `<span class="chip tag">${esc(t)}</span>`).join('');
  const cover = s.cover ? `<div class="set-cover"><img src="${esc(s.cover)}" alt="" loading="lazy"></div>` : '';
  const fileLabel = `<span class="set-file mono">${esc(s.file)}</span>`;
  // Two play links: primary to play.html, secondary raw JSON
  return `
    <article class="set-card" data-set="${esc(s.id)}" data-cat="${esc(catId)}">
      ${cover}
      <div class="set-card-top">
        ${diffChip}
        ${countBadge}
      </div>
      <h3 class="set-title">${esc(s.title)}</h3>
      <p class="muted small set-desc">${esc(s.description || '')}</p>
      ${tags ? `<div class="chips set-tags">${tags}</div>` : ''}
      <div class="set-file-row">${fileLabel}</div>
      <div class="btn-row set-actions">
        <a class="btn primary" href="${esc(playUrl(s.file))}">Play →</a>
        <a class="btn btn-ghost btn-sm" href="${esc(s.file)}" target="_blank" rel="noopener" title="Open the raw puzzles.json for this set">View JSON</a>
      </div>
    </article>`;
}

function categoryHtml(cat) {
  const sets = (cat.sets || []).map(s => setCardHtml(s, cat.id)).join('');
  const icon = cat.icon ? `<span class="cat-icon" aria-hidden="true">${esc(cat.icon)}</span>` : '';
  return `
    <section class="category" id="cat-${esc(cat.id)}">
      <div class="category-head">
        <div class="category-title-row">
          ${icon}
          <h2 class="category-title">${esc(cat.title)}</h2>
          <span class="badge">${(cat.sets || []).length} set${(cat.sets||[]).length===1?'':'s'}</span>
        </div>
        ${cat.description ? `<p class="muted small category-desc">${esc(cat.description)}</p>` : ''}
      </div>
      <div class="set-grid">${sets || '<p class="muted small">No sets in this category yet.</p>'}</div>
    </section>`;
}

function screenLanding(manifest) {
  const totalSets = manifest.categories.reduce((n,c)=> n + (c.sets?.length||0), 0);
  const totalPuzzles = manifest.categories.reduce((n,c)=> n + (c.sets||[]).reduce((m,s)=> m + (Number(s.count)||0), 0), 0);

  const catsHtml = manifest.categories.map(categoryHtml).join('');

  const heroStats = `
    <div class="hero-stats">
      <div class="stat"><b>${totalSets}</b><span>sets</span></div>
      <div class="stat"><b>${manifest.categories.length}</b><span>categories</span></div>
      <div class="stat"><b>${totalPuzzles || '—'}</b><span>puzzle runs</span></div>
      <div class="stat"><b>${Leaderboard.isShared ? 'online' : 'local'}</b><span>leaderboard</span></div>
    </div>`;

  app().innerHTML = `
    <div class="landing-hero">
      <div class="landing-hero-badge"><span class="badge local">Blood Bowl</span> <span class="muted small">fan-made puzzle decks</span></div>
      <h1 class="landing-title">${esc(manifest.title || 'Blood Bowl Puzzles')}</h1>
      <p class="landing-subtitle">${esc(manifest.subtitle || 'Pick a puzzle set by category. Each card links directly to its puzzles.json deck.')}</p>
      ${heroStats}
      <div class="btn-row" style="margin-top:1rem">
        <a class="btn primary" href="#cat-${esc(manifest.categories[0]?.id || 'all')}">Browse sets ↓</a>
        <a class="btn btn-ghost" href="editor.html">Create a new set</a>
        <a class="btn btn-ghost" href="guide.html">How it works</a>
      </div>
      <div class="landing-hint muted small" style="margin-top:1rem">
        Each set is a standalone <code>puzzles.json</code> file. Click <b>Play</b> to start the quiz, or <b>View JSON</b> to inspect the deck.
        Want to add your own? Duplicate <code>puzzles.json</code>, edit in the <a href="editor.html">editor</a>, and list it in <code>sets.json</code>.
      </div>
    </div>

    <div class="landing-categories">
      ${catsHtml}
    </div>

    <div class="card landing-foot">
      <h2 style="margin-top:0">How to add a category</h2>
      <p class="muted small">Edit <code>sets.json</code> at the project root. A category has a <code>title</code>, <code>description</code> and an array of <code>sets</code>. Each set needs at least <code>title</code> and <code>file</code> (path to its <code>puzzles.json</code>).</p>
      <pre class="small" style="margin-top:.6rem"><code>{
  "id": "my-cup",
  "title": "My Tournament",
  "description": "Puzzles from last weekend.",
  "sets": [
    {
      "id": "round-1",
      "title": "Round 1 — Bash",
      "file": "puzzles/round-1.json",
      "description": "2 puzzles, no rerolls.",
      "difficulty": "hard",
      "count": 2,
      "tags": ["block"]
    }
  ]
}</code></pre>
      <div class="btn-row" style="margin-top:.8rem">
        <a class="btn btn-ghost btn-sm" href="sets.json">Open sets.json</a>
        <a class="btn btn-ghost btn-sm" href="puzzles.json">Open default puzzles.json</a>
      </div>
    </div>
  `;

  // smooth scroll for hero CTA
  const firstCat = document.querySelector('.category');
  if (firstCat) {
    document.querySelector('.landing-hero a[href^=\"#cat-\"]')?.addEventListener('click', (e)=>{
      e.preventDefault();
      firstCat.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  }
}

function screenResume(saved) {
  const n = state.puzzles.length;
  const setLabel = state.setMeta ? esc(state.setMeta.title) : esc(state.setFile);
  app().innerHTML = `
    <div class="zen-page">
      <div class="zen-back">
        <a href="index.html" class="back-link">← All sets</a>
        <span class="muted small" style="margin-left:.6rem">${setLabel} · ${esc(state.setFile)}</span>
      </div>
      <div class="banner">
        <div style="flex:1 1 320px">
          <b>Unfinished run found.</b>
          <div class="muted small">You played ${saved.answers.length} of ${n} puzzles before. Continue where you stopped, or start again from puzzle 1.</div>
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

// One D6 roll, optionally rerolling a failure once.
function rollHintHtml() {
  const rows = [2, 3, 4, 5, 6].map(target => {
    const success = (7 - target) / 6;
    const withReroll = 1 - (1 - success) ** 2;
    return `<tr><th scope="row">${target}+</th><td>${(success * 100).toFixed(1)}%</td><td>${(withReroll * 100).toFixed(1)}%</td></tr>`;
  }).join('');
  return `
    <div class="roll-hint">
      <table>
        <caption>D6 success chances</caption>
        <thead><tr><th scope="col">Roll</th><th scope="col">0rr</th><th scope="col">1rr</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/** Optional odds prediction: shown only for puzzles that carry an `answer`. */
function oddsHtml(p) {
  if (!p.hasOdds) {
    return `<p class="muted small odds-none">This puzzle doesn't ask for odds — just build the play.</p>`;
  }
  return `
    <div class="odds-block" id="odds-block">
      <div class="question">${esc(p.question)}</div>
      <div class="slider-row">
        <div class="slider">
          <input type="range" id="guess" min="0" max="100" step="1" value="50" aria-label="Your odds prediction in percent">
          <div class="range-scale"><span>0%</span><span>50%</span><span>100%</span></div>
        </div>
        <output class="readout" id="readout">50%</output>
      </div>
      <label class="skip-odds">
        <input type="checkbox" id="odds-skip">
        <span>Skip the odds</span>
      </label>
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

  const setLabel = state.setMeta ? esc(state.setMeta.title) : esc(state.setFile);
  const setFileLabel = esc(state.setFile);

  app().innerHTML = `
    <div class="zen">
      <div class="zen-back">
        <a href="index.html" class="back-link">← All sets</a>
        <span class="badge" style="margin-left:.5rem">${setLabel}</span>
        <span class="muted small mono" style="margin-left:.4rem; opacity:.7">${setFileLabel}</span>
      </div>
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
              ${legendHtml(p)}
              ${rollHintHtml()}
            </div>
          </div>
        </div>
      </div>
      <div class="zen-foot">
        <div class="answer-box" id="answer-box">
          <div class="howto">
            <div class="question">How do you play it?</div>
            <div class="action-grid" id="action-grid">${actionButtonsHtml(p)}</div>
            <div class="solution-draft">
              <div class="draft-head"><span>Your solution</span></div>
              <div class="draft-text empty" id="draft-text">No actions yet — press a button above.</div>
            </div>
          </div>
          ${oddsHtml(p)}
          <div class="btn-row btn-center submit-row">
            <button class="primary btn-lg" id="btn-submit">Submit</button>
          </div>
          <div class="btn-row btn-center">
            <button class="link-btn" id="btn-restart" title="Clear this run and start again">Restart run</button>
            <a class="link-btn" href="index.html">Change set</a>
          </div>
        </div>
        <div id="reveal"></div>
      </div>
    </div>`;

  /* ---- action panel: every press appends its own label to the draft ---- */
  const steps = [];
  const draftEl = $('#draft-text');
  const paintDraft = () => {
    const text = solutionText(steps);
    draftEl.textContent = text || 'No actions yet — press a button above.';
    draftEl.classList.toggle('empty', !steps.length);
  };

  $('#action-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('button.action-btn');
    if (!btn) return;
    if (btn.dataset.clear !== undefined) {
      steps.length = 0;
    } else if (btn.dataset.action) {
      steps.push(btn.dataset.action);
    } else {
      return;
    }
    paintDraft();
  });

  /* ---- optional odds ---- */
  const slider = $('#guess');
  const readout = $('#readout');
  const skip = $('#odds-skip');
  const paintSlider = () => {
    if (!slider) return;
    const skipped = !!skip?.checked;
    slider.disabled = skipped;
    readout.textContent = skipped ? '—' : slider.value + '%';
    slider.style.setProperty('--pct', slider.value + '%');
    $('#odds-block')?.classList.toggle('skipped', skipped);
  };
  slider?.addEventListener('input', paintSlider);
  skip?.addEventListener('change', paintSlider);
  paintSlider();

  const submit = () => {
    const skipped = !p.hasOdds || !!skip?.checked;
    const guess = skipped ? null : Number(slider.value);
    if (!steps.length && guess === null) {
      toast('Press at least one action — or predict the odds.');
      return;
    }
    reveal({ guess, steps: [...steps] });
  };

  $('#btn-submit').addEventListener('click', submit);
  slider?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  $('#btn-restart').addEventListener('click', () => {
    if (!confirm('Restart the run from puzzle 1? Your current answers will be lost.')) return;
    clearProgress();
    state.idx = 0; state.answers = []; state.finished = false; state.submitted = null;
    screenRun();
  });
}

/* ----------------------------------------------------------- answer + reveal */

function reveal({ guess, steps }) {
  const p = state.puzzles[state.idx];
  const answer = p.answer;
  const error = guess !== null && answer !== null ? Math.abs(guess - answer) : null;

  state.answers[state.idx] = { guess, answer, error, steps };
  state.idx = Math.min(state.idx + 1, state.puzzles.length);
  saveProgress();

  $('#btn-submit')?.setAttribute('disabled', 'disabled');
  const slider = $('#guess');
  if (slider) slider.disabled = true;

  let oddsResult;
  if (error !== null) {
    oddsResult = `
      <div class="verdict-grid">
        <div class="stat"><b>${esc(fmtNum(answer))}%</b><span>correct odds</span></div>
        <div class="stat"><b>${esc(String(guess))}%</b><span>your odds</span></div>
        <div class="stat"><b>${fmtPct(error, 1)}</b><span>difference</span></div>
      </div>
      ${p.exact ? `<div class="muted small exact-line">Exact value: <code>${esc(p.exact)}</code></div>` : ''}`;
  } else if (answer !== null) {
    oddsResult = `
      <div class="verdict-grid odds-skipped">
        <div class="stat"><b>${esc(fmtNum(answer))}%</b><span>correct odds</span></div>
        <div class="stat"><b>—</b><span>your odds</span></div>
      </div>
      <div class="muted small exact-line">You skipped the odds for this puzzle.${p.exact ? ` Exact value: <code>${esc(p.exact)}</code>.` : ''}</div>`;
  } else {
    oddsResult = `<div class="muted small exact-line">This puzzle doesn't ask for odds.</div>`;
  }

  const last = state.idx >= state.puzzles.length;

  $('#reveal').innerHTML = `
    <div class="result">
      <div class="result-head">Result <span class="muted small" style="font-weight:500">(${esc(p.title)})</span></div>
      <div class="result-body">
        ${oddsResult}
        <div class="solution">
          <h3>Correct solution</h3>
          ${p.steps.length ? `<div class="correct-steps">${stepsHtml(p.steps)}</div>` : ''}
          ${md(p.solution) || (p.steps.length ? '' : '<p class="muted">No solution text was written for this puzzle yet.</p>')}
        </div>
        <div class="solution mine">
          <h3>Your solution</h3>
          ${steps.length
            ? `<div class="draft-text">${esc(solutionText(steps))}</div>`
            : '<p class="muted small">You didn\'t press any actions.</p>'}
        </div>
        <div class="next-row btn-center">
          <span class="muted small">${last ? 'That was the last puzzle.' : `Next up: <b>${esc(state.puzzles[state.idx].title)}</b>`}</span>
          <div class="btn-row btn-center">
            <button class="primary btn-lg" id="btn-next">${last ? 'See the full recap' : 'Next puzzle →'}</button>
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
  const played = state.answers.filter(Boolean);
  const odds = played.filter(a => a.error !== null && a.error !== undefined && isFinite(a.error));
  const meanError = odds.length ? mean(odds.map(a => a.error)) : null;
  return {
    played: played.length,
    oddsCount: odds.length,
    meanError,
    ci: tInterval90(odds.map(a => a.error)),
  };
}

function recapHtml() {
  return state.puzzles.map((p, i) => {
    const a = state.answers[i];
    const yourOdds = a && a.guess !== null && a.guess !== undefined
      ? `your odds: <b>${esc(String(a.guess))}%</b>${isFinite(a.error) ? ` (${fmtPct(a.error, 1)} off)` : ''}`
      : 'your odds: <span class="muted">skipped</span>';
    const oddsRow = p.hasOdds
      ? `correct odds: <b>${esc(fmtNum(p.answer))}%</b>${p.exact ? ` <code>${esc(p.exact)}</code>` : ''} · ${yourOdds}`
      : '<span class="muted">no odds for this puzzle</span>';
    return `
      <article class="recap">
        <div class="recap-head">
          <b>${i + 1}. ${esc(p.title)}</b>
          <span class="recap-odds small">${oddsRow}</span>
        </div>
        <div class="recap-steps">${p.steps.length ? stepsHtml(p.steps) : ''}</div>
        <div class="recap-solution small">${md(p.solution) || '<span class="muted">No solution text.</span>'}</div>
        ${a && a.steps && a.steps.length
          ? `<div class="recap-mine small muted">Your solution: ${esc(solutionText(a.steps))}</div>`
          : ''}
      </article>`;
  }).join('');
}

function screenResults() {
  const s = computeStats();
  const errLine = s.meanError !== null
    ? `<div class="stat"><b>${fmtPct(s.meanError, 2)}</b><span>mean error${s.ci ? ' (90% CI ' + fmtPct(s.ci.lo, 1) + ' – ' + fmtPct(s.ci.hi, 1) + ')' : ''}</span></div>`
    : '';

  const setLabel = state.setMeta ? esc(state.setMeta.title) : esc(state.setFile);

  app().innerHTML = `
    <div class="zen-page">
      <div class="zen-back">
        <a href="index.html" class="back-link">← All sets</a>
        <span class="muted small" style="margin-left:.6rem">${setLabel}</span>
      </div>
      <div class="results-head">
        <h1>Run finished</h1>
        <p class="muted">Here are the correct odds and the full solution for every puzzle in <b>${setLabel}</b>.</p>
      </div>
      <div class="stats-row">
        <div class="stat"><b>${s.played}</b><span>puzzles played</span></div>
        <div class="stat"><b>${s.oddsCount}</b><span>odds predicted</span></div>
        ${errLine}
      </div>

      <div class="zen-block">
        <h2>Recap</h2>
        <div class="recap-list">${recapHtml()}</div>
      </div>

      <div class="btn-row btn-center zen-actions">
        <button class="primary btn-lg" id="btn-again">Run again</button>
        <a class="btn btn-ghost" href="index.html">Browse other sets</a>
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
