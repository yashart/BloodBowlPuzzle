/* ============================================================
   editor.js — create and edit puzzles as JSON, with a live preview
   and an in-memory "deck" that can be exported as puzzles.json.
   ============================================================ */

import {
  esc, md, toast, normalizePuzzle, normalizeCollection, legendHtml,
  legendColor, legendColorOptions, actionButtonsHtml, stepsHtml,
} from './engine.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Puzzle currently being edited, plus the deck (= content of puzzles.json). */
const state = { deck: [], deckSource: '', dirtyDeck: false, loadedFromFile: false };

/* ----------------------------------------------------------- form <-> object */

function blankPuzzle() {
  return {
    id: '', title: '', difficulty: 'medium', tags: [],
    image: '', imageAlt: '',
    task: '', question: 'What are the odds? (%)',
    legend: [{ name: '', skills: [], note: '', color: '' }],
    answer: null, exact: '', steps: [], solution: '', author: '', tolerance: 5,
  };
}

function legendRowHtml(entry = {}) {
  const hex = legendColor(entry.color);
  return `<div class="row">
    <div class="row-line">
      <select class="lg-color" title="Colour of this player in the legend"${hex ? ` style="border-left:4px solid ${hex}"` : ''}>
        ${legendColorOptions(entry.color)}
      </select>
      <input type="text" class="lg-name" placeholder="Player, e.g. #1 Blitzer (your team)" value="${esc(entry.name || '')}">
      <button type="button" class="btn-ghost btn-remove-legend" title="Remove this player">✕</button>
    </div>
    <div class="row-line two">
      <input type="text" class="lg-skills" placeholder="Skills, comma separated, e.g. Sure Hands, Block" value="${esc((entry.skills || []).join(', '))}">
      <input type="text" class="lg-note" placeholder="Note, e.g. MA 6 ST 3 AG 3+" value="${esc(entry.note || '')}">
    </div>
  </div>`;
}

function renderLegendRows(legend) {
  $('#legend-rows').innerHTML = (legend && legend.length ? legend : [{}]).map(legendRowHtml).join('');
}

function readForm() {
  const legend = $$('#legend-rows .row').map(row => ({
    name: $('.lg-name', row).value.trim(),
    skills: $('.lg-skills', row).value.split(',').map(s => s.trim()).filter(Boolean),
    note: $('.lg-note', row).value.trim(),
    color: $('.lg-color', row)?.value || '',
  })).filter(e => e.name || e.skills.length || e.note || e.color);

  return {
    id: $('#f-id').value.trim(),
    title: $('#f-title').value.trim(),
    difficulty: $('#f-difficulty').value,
    tags: $('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    image: $('#f-image').value.trim(),
    imageAlt: $('#f-imagealt').value.trim(),
    task: $('#f-task').value.trim(),
    question: $('#f-question').value.trim() || 'What are the odds? (%)',
    legend,
    answer: $('#f-answer').value.trim() === '' ? null : Number($('#f-answer').value),
    exact: $('#f-exact').value.trim(),
    steps: $('#f-steps').value.split(',').map(s => s.trim()).filter(Boolean),
    solution: $('#f-solution').value.trim(),
    author: $('#f-author').value.trim(),
    tolerance: Number($('#f-tolerance').value || 5),
  };
}

function writeForm(p) {
  $('#f-id').value = p.id || '';
  $('#f-title').value = p.title || '';
  $('#f-difficulty').value = p.difficulty || 'medium';
  $('#f-tags').value = (p.tags || []).join(', ');
  $('#f-image').value = p.image || '';
  $('#f-imagealt').value = p.imageAlt || '';
  $('#f-task').value = p.task || '';
  $('#f-question').value = p.question || 'What are the odds? (%)';
  $('#f-answer').value = isFinite(p.answer) ? p.answer : '';
  $('#f-exact').value = p.exact || '';
  $('#f-steps').value = (p.steps || []).join(', ');
  $('#f-solution').value = p.solution || '';
  $('#f-author').value = p.author || '';
  $('#f-tolerance').value = p.tolerance ?? 5;
  renderLegendRows(p.legend);
  refresh();
}

/* ----------------------------------------------------------- validation */

function validate(p) {
  const errors = [];
  if (!p.id) errors.push('id is required (letters, digits, dashes — used in the URL hash and in the leaderboard data).');
  else if (!/^[a-z0-9._-]+$/i.test(p.id)) errors.push('id may only contain letters, digits, dot, dash and underscore.');
  if (!p.title) errors.push('title is required.');
  if (!p.task) errors.push('task text is required — this is the puzzle description the player reads.');
  if (p.answer !== null) {
    if (!isFinite(p.answer)) errors.push('answer must be a number, or leave the field empty for a puzzle that asks only "how to play".');
    else if (p.answer < 0 || p.answer > 100) errors.push('answer must be between 0 and 100 (or empty for no odds).');
  }
  if (!p.image) errors.push('image path is empty — the puzzle will render a "no image" placeholder. (Warning, not an error.)');
  if (!p.solution && !p.steps.length) errors.push('solution text is empty — players will see nothing after submitting. (Warning, not an error.)');
  return errors;
}

/** Split messages into hard errors and warnings (warnings end with "(Warning, not an error.)"). */
function splitIssues(issues) {
  const warn = issues.filter(i => i.includes('Warning, not an error'));
  const err = issues.filter(i => !i.includes('Warning, not an error'));
  return { err, warn };
}

/* ----------------------------------------------------------- live refresh */

function refresh() {
  const p = readForm();
  const issues = validate(p);
  const { err, warn } = splitIssues(issues);

  $('#json-out').textContent = JSON.stringify(p, null, 2);

  const status = $('#json-status');
  if (err.length) {
    status.className = 'status err';
    status.innerHTML = err.map(e => '• ' + esc(e)).join('<br>');
  } else if (warn.length) {
    status.className = 'status';
    status.innerHTML = warn.map(e => '• ' + esc(e)).join('<br>');
  } else {
    status.className = 'status ok';
    status.textContent = 'Looks good — ready to export.';
  }

  // preview
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.imageAlt || p.title)}"
         onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'muted small center',textContent:'Image not found: ${esc(p.image).replace(/'/g, '')} — put the file in the images/ folder.'}))">`
    : `<div class="muted small center" style="padding:1.5rem">No image path yet.</div>`;

  $('#preview').innerHTML = `
    <div class="preview-frame">${img}</div>
    <h3 style="margin:.7rem 0 .2rem">${esc(p.title || 'untitled puzzle')}</h3>
    <div class="chips" style="margin-bottom:.5rem">
      <span class="chip ${['easy', 'medium', 'hard'].includes(p.difficulty) ? p.difficulty : 'medium'}">${esc(p.difficulty)}</span>
      ${(p.tags || []).map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}
    </div>
    <div class="solution small">${md(p.task) || '<span class="muted">No task text yet.</span>'}</div>
    <div style="margin-top:.6rem">${legendHtml({ legend: p.legend || [] })}</div>
    <div class="howto" style="margin-top:.9rem">
      <p class="small muted" style="margin-bottom:.4rem">The answer panel the player gets:</p>
      <div class="action-grid">${actionButtonsHtml(p)}</div>
    </div>
    <div style="margin-top:.5rem">${p.steps.length ? stepsHtml(p.steps) : ''}</div>
    <p class="small muted" style="margin-top:.6rem">
      ${p.answer !== null
        ? `${esc(p.question || '')} → correct odds <b>${isFinite(p.answer) ? esc(String(p.answer)) + '%' : '—'}</b>${p.exact ? ` <code>${esc(p.exact)}</code>` : ''}`
        : 'No odds for this puzzle — the player only builds the action sequence.'}
    </p>`;
}

/* ----------------------------------------------------------- deck */

function renderDeck() {
  const src = $('#deck-source');
  if (src) {
    src.textContent = state.deckSource
      ? `source: ${state.deckSource}${state.dirtyDeck ? ' (edited)' : ''}`
      : (state.deck.length ? 'new deck build in this browser' : '');
  }
  const host = $('#deck');
  if (!state.deck.length) {
    host.innerHTML = `<p class="muted small">The deck is empty. Load <code>puzzles.json</code> (button above) or start building puzzles — every puzzle you add to the deck goes into the export.</p>`;
    return;
  }
  host.innerHTML = `<div class="list-puzzles">${state.deck.map((p, i) => `
    <div class="item">
      <div><b>${esc(p.title || p.id)}</b><div class="muted small mono">${esc(p.id)} · ${p.answer === null || p.answer === undefined ? 'no odds' : 'odds ' + esc(String(p.answer)) + '%'}</div></div>
      <div class="btn-row">
        <button class="btn-sm" data-load="${i}">Edit</button>
        <button class="btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button class="btn-sm" data-down="${i}" ${i === state.deck.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button class="btn-sm" data-del="${i}" title="Remove from export">✕</button>
      </div>
    </div>`).join('')}</div>
  <p class="muted small" style="margin-top:.5rem">${state.deck.length} puzzle(s) will be exported${state.dirtyDeck ? ' — <b>changes not downloaded yet</b>' : ''}.</p>`;

  $$('#deck [data-load]').forEach(b => b.addEventListener('click', () => {
    writeForm(state.deck[Number(b.dataset.load)]);
    toast('Loaded into the form');
  }));
  $$('#deck [data-del]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.del);
    if (!confirm(`Remove "${state.deck[i].id}" from the export?`)) return;
    state.deck.splice(i, 1);
    state.dirtyDeck = true;
    renderDeck();
  }));
  $$('#deck [data-up]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.up);
    [state.deck[i - 1], state.deck[i]] = [state.deck[i], state.deck[i - 1]];
    state.dirtyDeck = true; renderDeck();
  }));
  $$('#deck [data-down]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.down);
    [state.deck[i + 1], state.deck[i]] = [state.deck[i], state.deck[i + 1]];
    state.dirtyDeck = true; renderDeck();
  }));
}

function addToDeck(p) {
  const i = state.deck.findIndex(x => x.id === p.id);
  if (i >= 0) state.deck[i] = p; else state.deck.push(p);
  state.dirtyDeck = true;
  renderDeck();
}

/* ----------------------------------------------------------- file helpers */

function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('Copied to clipboard');
  }
}

function puzzlesFileText(deck = state.deck) {
  return JSON.stringify({
    version: 1,
    meta: {
      generated: new Date().toISOString(),
      generator: 'blood-bowl-puzzles editor',
      count: deck.length,
    },
    puzzles: deck,
  }, null, 2) + '\n';
}

/* ----------------------------------------------------------- wiring */

function wire() {
  // Delegated listeners: legend rows are created and destroyed all the time,
  // so wiring each input individually would go stale.
  $('#form-card').addEventListener('input', refresh);
  $('#form-card').addEventListener('change', refresh);

  $('#btn-add-legend').addEventListener('click', () => {
    $('#legend-rows').insertAdjacentHTML('beforeend', legendRowHtml({}));
    refresh();
  });

  // Paint the chosen colour straight onto the select, so the row reads as a swatch.
  $('#legend-rows').addEventListener('change', (e) => {
    const sel = e.target.closest('.lg-color');
    if (!sel) return;
    const hex = legendColor(sel.value);
    sel.style.borderLeft = hex ? `4px solid ${hex}` : '';
  });

  $('#legend-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-legend');
    if (!btn) return;
    const rows = $$('#legend-rows .row');
    if (rows.length <= 1) rows[0].querySelectorAll('input').forEach(i => { i.value = ''; });
    else btn.closest('.row').remove();
    refresh();
  });

  $('#btn-new').addEventListener('click', () => {
    writeForm(blankPuzzle());
    toast('Blank form');
  });

  $('#btn-copy').addEventListener('click', () => copyText($('#json-out').textContent));

  $('#btn-download-one').addEventListener('click', () => {
    const p = readForm();
    const { err } = splitIssues(validate(p));
    if (err.length) { toast('Fix the errors first'); return; }
    download(`${(p.id || 'puzzle')}.json`, JSON.stringify(p, null, 2) + '\n');
  });

  $('#btn-add-deck').addEventListener('click', () => {
    const p = readForm();
    const { err } = splitIssues(validate(p));
    if (err.length) { toast('Fix the errors first'); return; }
    addToDeck(p);
    toast('Added to the export');
  });

  $('#btn-load-file').addEventListener('click', async () => {
    try {
      const res = await fetch('puzzles.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const list = normalizeCollection(JSON.parse(text));
      state.deck = list;
      state.deckSource = 'puzzles.json';
      state.dirtyDeck = false;
      state.loadedFromFile = true;
      renderDeck();
      toast(`Loaded ${list.length} puzzle(s) from puzzles.json`);
    } catch (e) {
      toast('Could not load puzzles.json: ' + e.message, 4000);
    }
  });

  $('#btn-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      let list;
      try { list = normalizeCollection(parsed); } catch { list = [normalizePuzzle(parsed, 0)]; }
      if (Array.isArray(parsed) || Array.isArray(parsed?.puzzles)) {
        state.deck = list; state.dirtyDeck = true; renderDeck();
        toast(`Replaced the deck with ${list.length} puzzle(s)`);
      } else {
        list.forEach(addToDeck);
        writeForm(list[0]);
        toast('Added 1 puzzle to the export');
      }
    } catch (err2) {
      toast('That file is not valid JSON: ' + err2.message, 4000);
    }
    e.target.value = '';
  });

  $('#btn-download-deck').addEventListener('click', () => {
    if (!state.deck.length) { toast('The deck is empty'); return; }
    download('puzzles.json', puzzlesFileText());
    state.dirtyDeck = false;
    renderDeck();
  });

  $('#btn-import-paste').addEventListener('click', () => {
    const raw = $('#paste-box').value.trim();
    if (!raw) { toast('Paste some JSON first'); return; }
    try {
      const parsed = JSON.parse(raw);
      let list;
      try { list = normalizeCollection(parsed); } catch { list = [normalizePuzzle(parsed, 0)]; }
      if (Array.isArray(parsed) || Array.isArray(parsed?.puzzles)) {
        state.deck = list;
        toast(`Replaced the deck with ${list.length} puzzle(s)`);
      } else {
        list.forEach(addToDeck);
        toast('Added 1 puzzle to the export');
      }
      state.dirtyDeck = true;
      renderDeck();
      $('#paste-box').value = '';
    } catch (e) {
      toast('Invalid JSON: ' + e.message, 4000);
    }
  });
}

/* ----------------------------------------------------------- start */

function start() {
  writeForm(blankPuzzle());
  renderDeck();
  wire();
  $('#btn-load-file').click(); // try to pick up the deployed puzzles.json right away
}

start();
