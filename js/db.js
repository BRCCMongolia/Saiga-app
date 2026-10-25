// IndexedDB: бүх өгөгдөл утсанд шууд хадгалагдана.
const DB_NAME = 'saiga-app';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('surveys', { keyPath: 'id' });
      db.createObjectStore('runs', { keyPath: 'key' }).createIndex('survey', 'surveyId');
      const pts = db.createObjectStore('points', { keyPath: 'n', autoIncrement: true });
      pts.createIndex('run', 'runKey');
      db.createObjectStore('sightings', { keyPath: 'id' }).createIndex('survey', 'surveyId');
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('sighting', 'sightingId');
      db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function get(name, key) { return wrap((await store(name)).get(key)); }
export async function put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); }
export async function del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); }
export async function all(name) { return wrap((await store(name)).getAll()); }
export async function byIndex(name, index, value) {
  return wrap((await store(name)).index(index).getAll(value));
}

export async function getMeta(k, dflt) {
  const r = await get('meta', k);
  return r ? r.v : dflt;
}
export async function setMeta(k, v) { return put('meta', { k, v }); }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Хөтөч санах ойг цэвэрлэхгүй байхыг хүснэ
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ }
  return false;
}
