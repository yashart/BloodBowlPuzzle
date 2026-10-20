/* ============================================================
   engine.js — shared logic: text rendering, statistics, puzzle
   loading/normalisation and small HTML builders.
   Used by both the quiz (app.js) and the puzzle editor (editor.js).
   ============================================================ */

/* ----------------------------------------------------------- text */

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Tiny markdown subset -> HTML.
 * Supports: blank line = new paragraph, single newline = <br>,
 * "**bold**", "*italic*", "`code`", "- " bullet lists.
 * Everything is HTML-escaped first, so puzzle JSON cannot inject markup.
 */
export function md(src) {
  if (!src) return '';
  const blocks = String(src).replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  const out = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    let list = [];
    let para = [];

    const flushPara = () => {
      if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; }
    };
    const flushList = () => {
      if (list.length) { out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`); list = []; }
    };

    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) { flushPara(); list.push(bullet[1]); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
  }
  return out.join('\n');
}

/* ----------------------------------------------------------- numbers */

/** 74.074 -> "74.07", 75 -> "75", 100 -> "100" (never eat significant zeros) */
export function fmtNum(x, digits = 2) {
  if (!isFinite(x)) return '—';
  let s = Number(x).toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function fmtPct(x, digits = 2, withSign = false) {
  const v = fmtNum(x, digits);
  return (withSign && x > 0 ? '+' : '') + v + '%';
}

export function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

/* ----------------------------------------------------------- statistics */

/** Two-sided t quantiles for a 90% confidence interval, indexed by df (1..30). */
const T90 = [0, 6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812,
  1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725,
  1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697];

export function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
}

export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/**
 * Mean ± t * SE, 90% two-sided confidence interval.
 * Returns null when there is not enough data.
 */
export function tInterval90(values) {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  const s = sd(values);
  const se = s / Math.sqrt(n);
  const t = T90[Math.min(n - 1, 30)];
  return { n, mean: m, sd: s, se, t, lo: m - t * se, hi: m + t * se };
}

/** Wilson score interval (90%) for a proportion k / n. */
export function wilson(k, n, z = 1.6448536269514722) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (c - w) / d), hi: Math.min(1, (c + w) / d) };
}

/* ----------------------------------------------------------- legend colours */

/**
 * Fixed palette for legend entries. A legend row may carry `color: <id>`;
 * the id is what lands in puzzles.json (stable, human readable), the hex is
 * what gets painted. Anything unknown falls back to "" = neutral.
 */
export const LEGEND_COLORS = [
  { id: 'blue',    label: 'Blue',    hex: '#4f9bff' },
  { id: 'red',     label: 'Red',     hex: '#e5534b' },
  { id: 'green',   label: 'Green',   hex: '#3fb950' },
  { id: 'yellow',  label: 'Yellow',  hex: '#e3b341' },
  { id: 'purple',  label: 'Purple',  hex: '#a371f7' },
  { id: 'white',   label: 'White',   hex: '#e7eef5' },
];

export function legendColor(id) {
  return LEGEND_COLORS.find(c => c.id === String(id ?? '').trim().toLowerCase())?.hex || '';
}

export function legendColorOptions(selected = '') {
  const cur = String(selected ?? '').trim().toLowerCase();
  return [
    `<option value=""${cur ? '' : ' selected'}>—</option>`,
    ...LEGEND_COLORS.map(c =>
      `<option value="${c.id}"${c.id === cur ? ' selected' : ''}>${c.label}</option>`),
  ].join('');
}

/* ----------------------------------------------------------- puzzle files */

const REQUIRED_NUM = ['answer'];

/** Accepts either a raw array or {version, puzzles:[...]}, returns a normalised array. */
export function normalizeCollection(raw) {
  let list;
  if (Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.puzzles)) list = raw.puzzles;
  else throw new Error('Unrecognised puzzles file: expected an array or an object with a "puzzles" array.');
  if (!list.length) throw new Error('The puzzles file contains no puzzles.');
  return list.map((p, i) => normalizePuzzle(p, i));
}

export function normalizePuzzle(p, i = 0) {
  if (!p || typeof p !== 'object') throw new Error(`Puzzle #${i + 1} is not an object.`);
  const id = String(p.id ?? `puzzle-${i + 1}`).trim();
  for (const key of REQUIRED_NUM) {
    if (!isFinite(Number(p[key]))) throw new Error(`Puzzle "${id}": field "${key}" must be a number.`);
  }
  const answer = Number(p.answer);
  if (answer < 0 || answer > 100) throw new Error(`Puzzle "${id}": "answer" must be between 0 and 100.`);
  if (!p.task && !p.image) throw new Error(`Puzzle "${id}": needs at least a "task" text or an "image".`);

  let legend = Array.isArray(p.legend) ? p.legend : [];
  legend = legend
    .filter(e => e && (e.name || e.skills))
    .map(e => ({
      name: String(e.name ?? ''),
      skills: Array.isArray(e.skills) ? e.skills.map(String).filter(Boolean)
        : String(e.skills ?? '').split(',').map(s => s.trim()).filter(Boolean),
      note: String(e.note ?? ''),
      color: LEGEND_COLORS.some(c => c.id === String(e.color ?? '').trim().toLowerCase())
        ? String(e.color).trim().toLowerCase() : '',
    }));

  return {
    id,
    title: String(p.title ?? id),
    difficulty: ['easy', 'medium', 'hard'].includes(p.difficulty) ? p.difficulty : 'medium',
    tags: Array.isArray(p.tags) ? p.tags.map(String).filter(Boolean) : [],
    image: String(p.image ?? ''),
    imageAlt: String(p.imageAlt ?? p.title ?? id),
    task: String(p.task ?? ''),
    question: String(p.question ?? 'What are the odds? (%)'),
    legend,
    answer,
    exact: String(p.exact ?? ''),
    solution: String(p.solution ?? ''),
    author: String(p.author ?? ''),
    tolerance: isFinite(Number(p.tolerance)) ? Number(p.tolerance) : 5,
    calc: String(p.calc ?? '').trim(),
  };
}

export async function loadPuzzles(url = 'puzzles.json') {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`Could not fetch ${url}. If you opened the file directly (file://), your browser blocks local JSON reads — run a tiny local server instead (see README) or use the online version.`);
  }
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
  const raw = await res.json();
  return normalizeCollection(raw);
}

/* ----------------------------------------------------------- builders */

export function setId(puzzles) {
  const str = puzzles.map(p => `${p.id}:${p.answer}`).join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'set' + (h >>> 0).toString(36);
}

export function puzzleMediaHtml(p) {
  if (p.image) {
    return `<figure class="figure">
      <img src="${esc(p.image)}" alt="${esc(p.imageAlt)}" loading="lazy">
    </figure>`;
  }
  return `<figure class="figure"><div class="muted center" style="padding:2rem 1rem">No image for this puzzle.</div></figure>`;
}

export function legendHtml(p) {
  if (!p.legend.length) {
    return `<p class="muted small">No skills or players to declare in this puzzle — everything you need is in the text.</p>`;
  }
  const rows = p.legend.map(e => {
    const hex = legendColor(e.color);
    const style = hex ? ` style="--c:${hex}"` : '';
    return `<li class="legend-row"${style}>
      <div class="legend-name">
        <i class="lg-dot"${hex ? ` style="background:${hex}"` : ''} aria-hidden="true"></i>
        <b>${esc(e.name)}</b>
        ${e.note ? `<span class="legend-note mono">${esc(e.note)}</span>` : ''}
      </div>
      <div class="legend-skills">${e.skills.length
        ? e.skills.map(s => `<span class="skill">${esc(s)}</span>`).join('')
        : '<span class="muted">—</span>'}</div>
    </li>`;
  }).join('');
  return `<ul class="legend">${rows}</ul>`;
}

/* ----------------------------------------------------------- Dave's calculator

   Every puzzle page carries a small box for Dave's Advanced Action Calculator
   (https://www.bloodbowldave.com/advanced). That page accepts a "calculation
   string" in its text field and also via the ?c= URL parameter, so a line typed
   here can be opened there with one click. The notation below is documented in
   the calculator's own repository (BloodBowlDave/BloodBowlActionCalculator):
   actions per player separated by ",", players separated by ";", skills as a
   prefix before ":", blocks as <dice>D<good faces>[!<safe faces>].
*/

export const CALC_BASE_URL = 'https://www.bloodbowldave.com/advanced';

/** Builds the deep link for a calculation string. A pasted full URL passes through. */
export function calcUrl(str) {
  const s = String(str ?? '').trim();
  if (!s) return CALC_BASE_URL;
  if (/^https?:\/\//i.test(s)) return s;
  return CALC_BASE_URL + '?c=' + encodeURIComponent(s);
}

/** Clickable samples shown in the puzzle-page calculator box. */
export const CALC_EXAMPLES = [
  { code: 'D3,P3,C3',           text: 'dodge 3+, pass 3+, catch 3+ — one player' },
  { code: '2D2,K8,J8',          text: 'two-dice block for the knockdown, armour 8+, injury 8+' },
  { code: 'D,SF,L4:D4,D4',      text: 'loner (4+) with Dodge + Sure Feet: two 4+ dodges' },
  { code: 'P3;C:C3',            text: 'pass 3+, then (;) a second player catches 3+' },
  { code: '2D2!2{1D2}',         text: 'frenzy: a 1-die follow-up block on each push' },
  { code: 'L2,2D2|1D2',         text: 'dauntless 2+: 2-dice block if made, 1 die if missed' },
];

/** The compact notation cheat-sheet used inside the puzzle-page calculator box. */
export function calcCheatSheetHtml() {
  return `
    <p class="small"><b>The line.</b> One player's actions in order, separated by commas:
      <code>D3</code> dodge 3+, <code>R3</code> rush, <code>U3</code> pick up, <code>P3</code> pass
      (<code>P3-1</code> = with a −1 modifier), <code>C3</code> catch, <code>E3</code> leap,
      <code>G5</code> landing, <code>T2</code> stab, <code>K8</code> armour 8+, <code>J8</code> injury 8+,
      <code>F8</code> foul to break armour 8+, a bare <code>4</code> = any rerollable 4+ roll,
      <code>5/6</code> = a fixed 5-in-6 chance that cannot be rerolled.</p>
    <p class="small"><b>Blocks.</b> <code>&lt;dice&gt;D&lt;good faces&gt;</code> counts the best faces of the block die
      (defender down first, then pushes): <code>1D2</code> = one die for a knockdown,
      <code>2D2</code> = two dice for a knockdown, <code>2D3</code> = two dice for push-or-better,
      <code>3D1</code> = three dice for POW only. <code>!n</code> marks n faces as
      "safe but not a success" — <code>2D2!2{1D2}</code> is a frenzy block whose pushes trigger the
      branch in <code>{…}</code>. Modifiers: <code>^</code> Brawler, <code>*</code> Pro, <code>%</code> Hatred.</p>
    <p class="small"><b>Skills &amp; more players.</b> Skills go before a colon —
      <code>D,SF:D3</code> dodges 3+ with Dodge and Sure Feet, <code>L4:2D2</code> is a loner (4+) blocking.
      <code>;</code> switches to the next player: <code>P3;C:C3</code> = the thrower passes, the catcher catches.</p>
    <p class="small"><b>Branches.</b> <code>{…}</code> = what happens if the roll before it did not fail
      (frenzy follow-ups), <code>[…]</code> = a branch that ends the calculation (scoring on the way),
      <code>(a)(b)</code> = two alternative lines — the best one counts,
      <code>L2,2D2|1D2</code> = dauntless 2+ into a 2-dice block, or a 1-die block if it is missed.
      Suffix <code>~S2</code> switches the calculator to Season 2 rules.</p>
    <p class="small"><b>Rerolls.</b> The calculator lists the success chance for 0, 1, 2 … team rerolls —
      read the row that matches the rerolls this puzzle gives you. Skills such as Dodge, Catch, Pass or
      Pro are spent automatically where they help.</p>`;
}

/**
 * The calculator box shown under every puzzle: a text field for the calculation
 * string, an "open" link that carries it to Dave's advanced page via ?c=, the
 * cheat-sheet and clickable samples. Wiring (input → href sync, chips) is done
 * by app.js after the panel is inserted.
 */
export function calcPanelHtml(p) {
  const seed = String(p?.calc ?? '').trim();
  return `
    <details class="calc-box" id="calc-box">
      <summary>🧮 Odds calculator — type the line, check it with Dave's calculator</summary>
      <div class="calc-body">
        <p class="muted small">Write this turn as a calculation string and open it in
          <a href="${CALC_BASE_URL}" target="_blank" rel="noopener">Dave's Advanced Action Calculator</a> —
          it returns the exact chance the whole line works. The string travels in the link
          (<code>?c=…</code>), so anything you build can be shared or bookmarked.</p>
        <div class="calc-row">
          <input type="text" id="calc-input" class="mono" spellcheck="false" autocomplete="off"
            aria-label="Calculation string for Dave's advanced action calculator"
            placeholder="e.g. D3,2D2,K8,J8" value="${esc(seed)}">
          <a class="btn btn-sm" id="calc-open" href="${calcUrl(seed)}" target="_blank" rel="noopener"
            title="Open this calculation in Dave's advanced calculator">Open ↗</a>
        </div>
        <details class="help calc-help">
          <summary>Notation help &amp; samples</summary>
          ${calcCheatSheetHtml()}
          <div class="calc-chips">
            ${CALC_EXAMPLES.map(x => `
              <button type="button" class="calc-chip" data-calc="${esc(x.code)}">
                <code>${esc(x.code)}</code><span class="lbl">${esc(x.text)}</span>
              </button>`).join('')}
          </div>
          <p class="muted small">Click a sample to put it in the field, edit it, then press <b>Open ↗</b>.
          The full reference lives in <a href="guide.html#calculator">the guide</a>.</p>
        </details>
      </div>
    </details>`;
}

/** One-line "verify this in the calculator" row, used in the reveal/solution. */
export function calcLineHtml(code) {
  return `
    <p class="calc-line">
      <span class="muted small">Dave's calculator:</span>
      <code>${esc(code)}</code>
      <a class="btn btn-sm" href="${calcUrl(code)}" target="_blank" rel="noopener">Open ↗</a>
    </p>`;
}

export function toast(message, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
