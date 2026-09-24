// Small IndexedDB wrapper. Schema version + ordered migrations.
const NAME = 'setline';
export const SCHEMA_VERSION = 4;

const MIGRATIONS = {
  1(db) {
    db.createObjectStore('exercises', { keyPath: 'id' });
    db.createObjectStore('workouts', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
    db.createObjectStore('routines', { keyPath: 'id' });
    db.createObjectStore('prs', { keyPath: 'id' }).createIndex('exerciseId', 'exerciseId');
    db.createObjectStore('bodyweight', { keyPath: 'date' });
    db.createObjectStore('chat', { keyPath: 'id' });
    db.createObjectStore('ttsCache');
    db.createObjectStore('meta'); // key/value: activeWorkout, flags
  },
  // v2: cached replies from 1.1/1.2 had the style prompt spoken into them
  2(db, tx) {
    tx.objectStore('ttsCache').clear();
  },
  // v3: cardio sessions and daily nutrition
  3(db) {
    db.createObjectStore('cardio', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
    db.createObjectStore('nutrition', { keyPath: 'date' });
  },
  // v4: morning check-ins, body measurements, progress photos; replies cached before 1.6.2 could be cut off
  4(db, tx) {
    db.createObjectStore('daily', { keyPath: 'date' });
    db.createObjectStore('measures', { keyPath: 'date' });
    db.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date');
    tx.objectStore('ttsCache').clear();
  }
};

export const STORES = ['exercises', 'workouts', 'routines', 'prs', 'bodyweight', 'chat', 'ttsCache', 'meta', 'cardio', 'nutrition', 'daily', 'measures', 'photos'];

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

let dbp = null;
export function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, SCHEMA_VERSION);
    r.onupgradeneeded = e => {
      for (let v = e.oldVersion + 1; v <= SCHEMA_VERSION; v++) MIGRATIONS[v](r.result, r.transaction);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      res(db);
    };
    r.onerror = () => { dbp = null; rej(r.error); };
    r.onblocked = () => rej(new Error('db blocked'));
  });
  return dbp;
}

// Run fn(stores) inside one transaction; resolves when the transaction commits.
export async function tx(names, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(names, mode);
    const stores = Object.fromEntries([].concat(names).map(n => [n, t.objectStore(n)]));
    let out;
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('aborted'));
    try {
      Promise.resolve(fn(stores)).then(v => { out = v; }, e => { try { t.abort(); } catch {} rej(e); });
    } catch (e) { try { t.abort(); } catch {} rej(e); }
  });
}

export const get = (store, key) => tx(store, 'readonly', s => req(s[store].get(key)));
export const getAll = store => tx(store, 'readonly', s => req(s[store].getAll()));
export const put = (store, value, key) => tx(store, 'readwrite', s => { key === undefined ? s[store].put(value) : s[store].put(value, key); });
export const del = (store, key) => tx(store, 'readwrite', s => { s[store].delete(key); });
export { req };

export async function wipe() {
  await tx(STORES, 'readwrite', s => { for (const n of STORES) s[n].clear(); });
}
