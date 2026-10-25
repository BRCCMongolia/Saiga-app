// Google Sheet рүү илгээх (Apps Script вэб апп).
import * as db from './db.js';
import { SIGHTING_HEADERS, TRANSECT_HEADERS, sightingRow, transectRow, runKey } from './model.js';

let busy = false;
const statusListeners = new Set();
export function onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
function status(s) { statusListeners.forEach((fn) => fn(s)); }

async function post(url, payload) {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'Sheet алдаа');
  return j;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function pendingCount() {
  const s = await db.all('sightings');
  const r = await db.all('runs');
  return s.filter((x) => !x.synced).length + r.filter((x) => !x.synced && x.status !== 'new').length;
}

export async function syncAll() {
  const url = await db.getMeta('sheetUrl', '');
  if (!url || busy || !navigator.onLine) { status({ pending: await pendingCount(), url: !!url }); return; }
  busy = true;
  status({ syncing: true });
  try {
    const surveys = await db.all('surveys');
    for (const survey of surveys) {
      const sightings = (await db.byIndex('sightings', 'survey', survey.id)).sort((a, b) => a.t - b.t);
      const runs = {};
      for (const t of survey.transects) runs[t.id] = await db.get('runs', runKey(survey.id, t.id));
      const counter = {};
      const effortRows = [], offRows = [], done = [];
      for (const s of sightings) {
        counter[s.tid] = (counter[s.tid] || 0) + 1;
        if (s.synced) continue;
        // Зураг
        if (s.photos && s.photos.length) {
          s.photoLinks = s.photoLinks || [];
          let i = 0;
          for (const pid of s.photos) {
            i++;
            const ph = await db.get('photos', pid);
            if (!ph || ph.link) { if (ph && ph.link && !s.photoLinks.includes(ph.link)) s.photoLinks.push(ph.link); continue; }
            const j = await post(url, { action: 'photo', folder: survey.name, name: s.gpsName + '_' + i + '_' + pid.slice(-5) + '.jpg', mime: 'image/jpeg', caption: [s.photoNote, ph.caption].filter(Boolean).join(' / '), data: await blobToBase64(ph.blob) });
            const curPh = await db.get('photos', pid);
            if (curPh) { curPh.link = j.url; await db.put('photos', curPh); }
            s.photoLinks.push(j.url);
          }
        }
        const row = sightingRow(s, runs[s.tid], survey, counter[s.tid]);
        (s.effort ? effortRows : offRows).push(row);
        done.push(s);
      }
      if (effortRows.length) await post(url, { action: 'upsert', sheet: 'Бүгд', headers: SIGHTING_HEADERS, key: 'id', rows: effortRows });
      if (offRows.length) await post(url, { action: 'upsert', sheet: 'Судалгааны бус зам', headers: SIGHTING_HEADERS, key: 'id', rows: offRows });
      // Илгээх хооронд засагдсан бол дахин илгээнэ (засварыг дарж бичихгүй)
      for (const s of done) {
        const cur = await db.get('sightings', s.id);
        if (!cur) continue;
        cur.photoLinks = s.photoLinks;
        if (cur.rev === s.rev) cur.synced = true;
        await db.put('sightings', cur);
      }
      const runRows = [], runDone = [];
      for (const t of survey.transects) {
        const run = runs[t.id];
        if (!run || run.synced || run.status === 'new') continue;
        const pts = await db.byIndex('points', 'run', run.key);
        runRows.push(transectRow(run, t, pts, survey));
        runDone.push(run);
      }
      // Устгасан замнал: хуучин мөрийг "Устгасан" болгоно
      for (const d of (await db.byIndex('runs', 'survey', survey.id)).filter((x) => x.status === 'deleted' && !x.synced)) { runRows.push(d.row); runDone.push(d); }
      if (runRows.length) await post(url, { action: 'upsert', sheet: 'Трансект', headers: TRANSECT_HEADERS, key: 'id', rows: runRows });
      for (const r of runDone) {
        const cur = await db.get('runs', r.key);
        if (cur && cur.rev === r.rev && !cur.synced) { cur.synced = true; await db.put('runs', cur); }
      }
    }
    await db.setMeta('lastSync', Date.now());
    status({ ok: true, pending: await pendingCount(), url: true });
  } catch (e) {
    console.error(e);
    status({ error: e.message, pending: await pendingCount(), url: true });
  } finally {
    busy = false;
  }
}

export async function testUrl(url) {
  return post(url, { action: 'ping' });
}
