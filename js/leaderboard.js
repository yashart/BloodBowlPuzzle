/* ============================================================
   leaderboard.js — one small API with two back-ends:

   • firebase  : shared online leaderboard (Firestore), used when
                 js/config.js exists and holds real credentials.
   • local     : everything kept in this browser (localStorage) and
                 shown with a clear "not shared" note.

   The rest of the site never has to care which one is active.
   ============================================================ */

const LOCAL_KEY = 'bbp.leaderboard.v1';
const MINE_KEY = 'bbp.myRuns.v1';

function uid() {
  return 'r' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function cleanNick(nick) {
  const s = String(nick ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return s || 'Anonymous';
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]').filter(e => e && isFinite(e.accuracy)); }
  catch { return []; }
}
function writeLocal(rows) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows.slice(0, 500))); }
  catch { /* storage full or blocked: leaderboard simply stays empty */ }
}
function myRunIds() {
  try { return new Set(JSON.parse(localStorage.getItem(MINE_KEY) || '[]')); }
  catch { return new Set(); }
}
function rememberMyRun(id) {
  try {
    const ids = [...myRunIds(), id].slice(-50);
    localStorage.setItem(MINE_KEY, JSON.stringify(ids));
  } catch { /* ignore */ }
}

/** Sort order of a finished run: accuracy desc, mean error asc, narrow CI first. */
function compareRuns(a, b) {
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  if (a.meanError !== b.meanError) return a.meanError - b.meanError;
  return (a.ciWidth ?? 999) - (b.ciWidth ?? 999);
}

async function loadFirebaseConfig() {
  // config.js is optional: it is committed as a .example only, so the import
  // may legitimately fail (or the file may exist but still hold placeholders).
  let mod;
  try { mod = await import('./config.js'); }
  catch { return { ok: false, reason: 'no-config' }; }

  const cfg = mod.FIREBASE_CONFIG;
  if (!cfg || typeof cfg !== 'object') return { ok: false, reason: 'no-config' };

  const real = ['apiKey', 'projectId', 'appId'].every(k => {
    const v = String(cfg[k] ?? '');
    return v && !/YOUR_|PASTE|PLACEHOLDER|CHANGE_ME/i.test(v);
  });
  if (!real) return { ok: false, reason: 'placeholder-config' };

  return { ok: true, cfg, collection: String(mod.LEADERBOARD_COLLECTION || 'runs') };
}

export const Leaderboard = {
  mode: 'local',
  reason: 'no-config',
  message: '',
  _db: null,
  _fs: null,
  _collection: 'runs',

  get isShared() { return this.mode === 'firebase'; },

  async init() {
    if (typeof localStorage === 'undefined') {
      this.mode = 'local';
      this.message = 'This browser blocks local storage, so a local leaderboard cannot be kept.';
      return this.mode;
    }
    const probe = await loadFirebaseConfig();
    if (!probe.ok) {
      this.mode = 'local';
      this.reason = probe.reason;
      this.message = probe.reason === 'placeholder-config'
        ? 'Showing scores stored in this browser only — add your Firebase credentials to js/config.js to switch on the shared leaderboard.'
        : 'Showing scores stored in this browser only — no leaderboard backend is configured yet (see js/config.example.js).';
      return this.mode;
    }

    try {
      const appMod = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
      const app = appMod.initializeApp(probe.cfg);
      this._db = fsMod.getFirestore(app);
      this._fs = fsMod;
      this._collection = probe.collection;
      this.mode = 'firebase';
      this.message = 'Shared leaderboard is online (Firebase Firestore).';
      return this.mode;
    } catch (err) {
      this.mode = 'local';
      this.reason = 'firebase-error';
      this.message = 'Could not reach Firebase (' + (err?.message || err) + '). Falling back to scores stored in this browser.';
      return this.mode;
    }
  },

  /** run = {nick, accuracy, meanError, ci90:[lo,hi], total, misses} */
  async submit(run) {
    const entry = {
      id: uid(),
      nick: cleanNick(run.nick),
      accuracy: Number(run.accuracy),
      meanError: Number(run.meanError),
      ciWidth: run.ci90 ? Math.abs(run.ci90[1] - run.ci90[0]) : null,
      ci90: run.ci90 || null,
      total: Number(run.total) || 0,
      misses: Number(run.misses) || 0,
      when: Date.now(),
      puzzleSet: run.puzzleSet || '',
    };

    if (this.mode === 'firebase') {
      try {
        const { collection, addDoc, serverTimestamp } = this._fs;
        const doc = await addDoc(collection(this._db, this._collection), {
          nick: entry.nick,
          accuracy: entry.accuracy,
          meanError: entry.meanError,
          ciWidth: entry.ciWidth,
          total: entry.total,
          misses: entry.misses,
          puzzleSet: entry.puzzleSet,
          createdAt: serverTimestamp(),
        });
        entry.id = doc.id;
        entry.shared = true;
        rememberMyRun(entry.id);
        return { ok: true, entry };
      } catch (err) {
        return { ok: false, error: String(err?.message || err), entry };
      }
    }

    const rows = readLocal();
    rows.push(entry);
    writeLocal(rows);
    rememberMyRun(entry.id);
    return { ok: true, entry, local: true };
  },

  async top(limit = 20) {
    if (this.mode === 'firebase') {
      try {
        const { collection, query, orderBy, limit: lim, getDocs } = this._fs;
        const q = query(collection(this._db, this._collection), orderBy('accuracy', 'desc'), lim(200));
        const snap = await getDocs(q);
        const rows = snap.docs.map(d => {
          const v = d.data();
          return {
            id: d.id,
            nick: cleanNick(v.nick),
            accuracy: Number(v.accuracy),
            meanError: Number(v.meanError),
            ciWidth: v.ciWidth ?? null,
            total: Number(v.total) || 0,
            misses: Number(v.misses) || 0,
            when: v.createdAt?.toMillis ? v.createdAt.toMillis() : null,
          };
        }).sort(compareRuns).slice(0, limit);
        return { ok: true, rows, mine: myRunIds() };
      } catch (err) {
        return { ok: false, error: String(err?.message || err), rows: [], mine: new Set() };
      }
    }

    const rows = readLocal().sort(compareRuns).slice(0, limit);
    return { ok: true, rows, mine: myRunIds() };
  },

  /** 1-based rank of a run against everything stored; null when unknown. */
  async rankOf(run) {
    const probe = {
      accuracy: Number(run.accuracy),
      meanError: Number(run.meanError),
      ciWidth: run.ci90 ? Math.abs(run.ci90[1] - run.ci90[0]) : 999,
    };

    if (this.mode === 'firebase') {
      try {
        const { collection, query, where, getCountFromServer } = this._fs;
        const better = await getCountFromServer(
          query(collection(this._db, this._collection), where('accuracy', '>', probe.accuracy))
        );
        return Number(better.data().count) + 1;
      } catch {
        return null;
      }
    }

    const rows = readLocal();
    return rows.filter(r => compareRuns(r, probe) < 0).length + 1;
  },

  totalEntries() {
    return this.mode === 'firebase' ? null : readLocal().length;
  },
};
