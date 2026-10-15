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
  const rows = p.legend.map(e => `<tr>
      <td><b>${esc(e.name)}</b>${e.note ? `<div class="muted small mono">${esc(e.note)}</div>` : ''}</td>
      <td>${e.skills.length ? e.skills.map(s => `<span class="skill">${esc(s)}</span>`).join('') : '<span class="muted">—</span>'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="legend">
      <thead><tr><th>Player</th><th>Skills in this puzzle</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

export function toast(message, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
