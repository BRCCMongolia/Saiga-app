// Saiga survey апп: дэлгэцүүд ба хээрийн ажлын логик.
import * as db from './db.js';
import * as geo from './geo.js';
import * as gps from './gps.js';
import * as exp from './export.js';
import * as sync from './sync.js';
import { GUIDE, METHOD } from './content.js';
import {
  QUICK_SPECIES, CARCASS_OPTIONS, codeFromLatin, runKey, newRun, getRun, runEnds, lineLengthM, runStats, segments,
  fmtDate, fmtTime, fmtDur, STATUS_MN,
} from './model.js';
import { h, toast, modal, confirmBox, beep, unlockAudio, keepAwake, compressImage, ICON } from './ui.js';

const $app = document.getElementById('app');
const TILE = {
  topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};
const TILE_ATTR = 'Esri';
let actions = {};
let cleanup = [];
let DEFAULT_TRANSECTS = [];
let SPECIES = [];
let settings = { warn1: 300, warn2: 500, sim: false, simFactor: 5, layer: 'topo' };

// ---------- эхлүүлэх ----------
async function init() {
  DEFAULT_TRANSECTS = await (await fetch('data/transects-2026.json')).json();
  fetch('data/species.json').then((r) => r.json()).then((s) => { SPECIES = s; }).catch(() => {});
  Object.assign(settings, await db.getMeta('settings', {}));
  db.persist();
  $app.addEventListener('click', (e) => {
    unlockAudio();
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](el, e); }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => sync.syncAll());
  setInterval(() => sync.syncAll(), 120000);
  route();
  sync.syncAll();
}

async function saveSettings() { await db.setMeta('settings', settings); }

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

async function route() {
  cleanup.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  cleanup = [];
  actions = {};
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  try {
    switch (parts[0]) {
      case 'guide': return page('Удирдамж', GUIDE);
      case 'method': return page('Арга зүй', METHOD);
      case 'settings': return settingsView();
      case 'new': return newSurveyView(parts[1]);
      case 's': return surveyView(parts[1]);
      case 't': return detailView(parts[1], parts[2]);
      case 'run': return runView(parts[1], parts[2]);
      default: return homeView();
    }
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="pad"><p class="err">Алдаа: ${h(e.message)}</p><a class="btn" href="#/">Нүүр</a></div>`;
  }
}

const topbar = (title, back = '#/', extra = '') => `<header class="top"><a class="iconbtn" href="${back}" aria-label="Буцах">${ICON.back}</a><h1>${h(title)}</h1>${extra}</header>`;

// ---------- нүүр ----------
async function homeView() {
  const surveys = (await db.all('surveys')).sort((a, b) => b.createdAt - a.createdAt);
  const runs = await db.all('runs');
  const active = runs.find((r) => r.status === 'active' || r.status === 'returning');
  const rows = surveys.map((s) => {
    const rs = runs.filter((r) => r.surveyId === s.id);
    const done = rs.filter((r) => r.status === 'done' || r.status === 'incomplete').length;
    const finished = done === s.transects.length && s.transects.length > 0;
    return `<a class="card survey" href="#/s/${encodeURIComponent(s.id)}">
      <div class="row between"><b>${h(s.name)}</b><span class="pill ${finished ? 'green' : 'yellow'}">${finished ? 'Дууссан' : (rs.some((r) => r.status !== 'new') ? 'Явж байна' : 'Эхлээгүй')}</span></div>
      <span class="muted small">${s.startDate ? fmtDate(s.startDate) + ' – ' + (s.endDate ? fmtDate(s.endDate) : '') : 'Эхлээгүй'} · Ахлагч: ${h(s.leader || '-')}</span>
      <span class="muted small">Судлаач: ${h((s.researchers || []).join(', ') || '-')}</span>
      <span class="muted small">${done} / ${s.transects.length} трансект дууссан</span>
    </a>`;
  }).join('');
  $app.innerHTML = `
  <div class="home">
    <div class="hero">
      <div class="logos">
        <div class="logo"><img src="img/wwf.png" alt="WWF" class="wwf"><span>Дэлхийн байгаль хамгаалах сан (WWF)-гийн Монгол дахь хөтөлбөрийн газар</span></div>
        <div class="logo"><img src="img/brcc.png" alt="BRCC" class="brcc"><span class="green">Биологийн Нөөцийг Хамгаалах Төв ТББ</span></div>
      </div>
      <div class="brand"><img src="img/icon-192.png" alt="" class="appicon"><div><h1>Saiga survey</h1><p>Бөхөн тооллого · шугаман трансект</p></div></div>
    </div>
    <div class="pad col">
      ${active ? `<a class="banner yellow" href="#/run/${encodeURIComponent(active.surveyId)}/${encodeURIComponent(active.tid)}"><b>${h(active.tid)} ${active.status === 'active' ? 'замнал явж байна' : 'түр зогссон'}</b><span>Үргэлжлүүлэх ›</span></a>` : ''}
      <div class="grid2">
        <a class="card tile" href="#/guide">${ICON.book}<b>Удирдамж</b><span class="muted small">Зорилго, шаардлага</span></a>
        <a class="card tile" href="#/method">${ICON.angle}<b>Арга зүй</b><span class="muted small">Зай, өнцөг хэмжих</span></a>
      </div>
      <button class="btn big primary" data-act="newsurvey">${ICON.plus} Судалгаа эхлүүлэх</button>
      <p class="muted small hint">Судалгааг жилд нэг л удаа эхлүүлнэ. Эхлүүлсэн бол доорх жагсаалтаас судалгаагаа нээж үргэлжлүүлнэ үү.</p>
      <h3 class="section">Судалгаанууд</h3>
      ${rows || '<p class="muted">Одоогоор судалгаа алга.</p>'}
      <div class="row between foot">
        <a class="link" href="#/settings">${ICON.gear} Тохиргоо</a>
        <span class="muted small" id="syncst"></span>
      </div>
    </div>
  </div>`;
  syncStatusInto('syncst');
  actions.newsurvey = async () => {
    const y = new Date().getFullYear();
    const cur = surveys.find((s) => new Date(s.createdAt).getFullYear() === y);
    if (cur) {
      const r = await modal({
        title: `${y} онд судалгаа эхэлсэн байна`,
        body: `<p><b>${h(cur.name)}</b></p><p>Судалгааг жилд нэг л удаа эхлүүлнэ. Өмнө эхлүүлсэн судалгаагаа үргэлжлүүлнэ үү.</p>`,
        buttons: [{ label: 'Шинээр эхлүүлэх', value: 'new' }, { label: 'Үргэлжлүүлэх', value: 'open', cls: 'primary' }],
      });
      if (r === 'open') return go('#/s/' + encodeURIComponent(cur.id));
      if (r !== 'new') return;
      if (!(await confirmBox('Үнэхээр шинэ судалгаа эхлүүлэх үү?', 'Шинэ судалгаа тусдаа жагсаалт болж үүснэ. Өмнөх судалгааны өгөгдөл хэвээр үлдэнэ.', 'Шинээр эхлүүлэх', 'Болих'))) return;
    }
    go('#/new');
  };
}

function syncStatusInto(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const show = async (st = {}) => {
    const url = await db.getMeta('sheetUrl', '');
    const pending = st.pending ?? await sync.pendingCount();
    if (!document.getElementById(id)) return;
    if (st.syncing) el.textContent = 'Sheet рүү илгээж байна...';
    else if (!url) el.textContent = 'Sheet холбоогүй';
    else if (st.error) el.textContent = 'Sheet алдаа: ' + st.error;
    else el.textContent = pending ? pending + ' бичлэг илгээгдээгүй' + (navigator.onLine ? '' : ' (интернэтгүй)') : 'Sheet-д бүгд орсон';
  };
  show();
  cleanup.push(sync.onStatus(show));
}

function page(title, html) {
  $app.innerHTML = topbar(title) + `<div class="pad prose">${html}</div>`;
}

// ---------- тохиргоо ----------
async function settingsView() {
  const url = await db.getMeta('sheetUrl', '');
  $app.innerHTML = topbar('Тохиргоо') + `<div class="pad col">
    <div class="card col">
      <b>Google Sheet</b>
      <label class="lbl" for="surl">Apps Script вэб аппын холбоос</label>
      <input id="surl" class="inp" value="${h(url)}" placeholder="https://script.google.com/macros/s/.../exec">
      <div class="row gap"><button class="btn" data-act="testurl">Шалгах</button><button class="btn primary" data-act="saveurl">Хадгалах</button><button class="btn" data-act="syncnow">Одоо илгээх</button></div>
      <span class="muted small" id="syncst"></span>
    </div>
    <div class="card col">
      <b>Шугамаас хазайх сануулга</b>
      <div class="grid2">
        <div><label class="lbl" for="w1">Шар, м</label><input id="w1" class="inp" inputmode="numeric" value="${settings.warn1}"></div>
        <div><label class="lbl" for="w2">Улаан, м</label><input id="w2" class="inp" inputmode="numeric" value="${settings.warn2}"></div>
      </div>
      <button class="btn" data-act="savewarn">Хадгалах</button>
    </div>
    <div class="card col">
      <b>Офлайн газрын зураг</b>
      <span class="muted small">Интернэттэй (Wi-Fi) үед Шарга орчмын газрын зургийг утсанд хадгална. Трансектын дагуу нарийвчилсан. Хэдэн минут болно.</span>
      <button class="btn" data-act="tiles">Газрын зураг татах</button>
      <span class="muted small" id="tilest"></span>
    </div>
    <div class="card col">
      <b>Туршилтын горим</b>
      <label class="row gap"><input type="checkbox" id="sim" ${settings.sim ? 'checked' : ''}> Дуураймал GPS (ширээн дээрээс турших)</label>
      <label class="lbl" for="simf">Хурдасгах (1 = жинхэнэ хурд)</label>
      <input id="simf" class="inp" inputmode="numeric" value="${settings.simFactor}">
      <button class="btn" data-act="savesim">Хадгалах</button>
      <span class="muted small">Анхаар: хээрт гарахаас өмнө заавал унтраана.</span>
    </div>
    <div class="card col">
      <b>Нөөц хуулбар</b>
      <span class="muted small">Утас солих, нөөцлөхөд бүх өгөгдлийг нэг файлаар.</span>
      <div class="row gap"><button class="btn" data-act="backup">Нөөц татах</button><label class="btn">Нөөцөөс сэргээх<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
    </div>
    <p class="muted small">Хувилбар ${h(window.APP_VERSION || '')}</p>
  </div>`;
  syncStatusInto('syncst');
  actions.saveurl = async () => { await db.setMeta('sheetUrl', document.getElementById('surl').value.trim()); toast('Хадгаллаа'); sync.syncAll(); };
  actions.testurl = async () => {
    const u = document.getElementById('surl').value.trim();
    if (!u) return toast('Холбоос оруулна уу', 'warn');
    try { await sync.testUrl(u); toast('Sheet холбогдлоо', 'ok'); } catch (e) { toast('Холбогдсонгүй: ' + e.message, 'err', 5000); }
  };
  actions.syncnow = () => sync.syncAll();
  actions.savewarn = async () => {
    const w1 = +document.getElementById('w1').value, w2 = +document.getElementById('w2').value;
    if (!(w1 > 0 && w2 > w1)) return toast('Улаан нь шараас их байх ёстой', 'warn');
    settings.warn1 = w1; settings.warn2 = w2; await saveSettings(); toast('Хадгаллаа');
  };
  actions.savesim = async () => {
    settings.sim = document.getElementById('sim').checked;
    settings.simFactor = Math.max(1, Math.min(50, +document.getElementById('simf').value || 1));
    await saveSettings(); toast(settings.sim ? 'Дуураймал GPS асаалттай' : 'Жинхэнэ GPS');
  };
  actions.tiles = downloadTiles;
  actions.backup = backup;
  document.getElementById('restore').addEventListener('change', restore);
}

function tileList(bbox, zmin, zmax) {
  const out = [];
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
  for (let z = zmin; z <= zmax; z++) {
    for (let x = lon2x(bbox[0], z); x <= lon2x(bbox[2], z); x++) {
      for (let y = lat2y(bbox[3], z); y <= lat2y(bbox[1], z); y++) out.push([z, x, y]);
    }
  }
  return out;
}

async function downloadTiles() {
  const st = document.getElementById('tilest');
  if (!navigator.onLine) return toast('Интернэт хэрэгтэй', 'warn');
  const surveys = await db.all('surveys');
  const ts = surveys.length ? surveys.flatMap((s) => s.transects) : DEFAULT_TRANSECTS;
  const lons = ts.flatMap((t) => [t.a[0], t.b[0]]), lats = ts.flatMap((t) => [t.a[1], t.b[1]]);
  const bbox = [Math.min(...lons) - 0.15, Math.min(...lats) - 0.12, Math.max(...lons) + 0.15, Math.max(...lats) + 0.12];
  const list = tileList(bbox, 6, 12);
  // Трансектын дагуух 3 км зурвас, илүү нарийн (13-14) түвшинд
  const seen = new Set(list.map((x) => x.join('/')));
  for (const t of ts) {
    const n = Math.ceil(geo.distance(t.a[1], t.a[0], t.b[1], t.b[0]) / 800);
    for (let i = 0; i <= n; i++) {
      const lon = t.a[0] + (t.b[0] - t.a[0]) * i / n, lat = t.a[1] + (t.b[1] - t.a[1]) * i / n;
      for (const z of [13, 14]) for (const tl of tileList([lon - 0.04, lat - 0.027, lon + 0.04, lat + 0.027], z, z)) {
        const k = tl.join('/');
        if (!seen.has(k)) { seen.add(k); list.push(tl); }
      }
    }
  }
  const urls = [];
  for (const k of ['topo', 'sat']) for (const [z, x, y] of list) urls.push(TILE[k].replace('{z}', z).replace('{x}', x).replace('{y}', y));
  const cache = await caches.open('tiles-v1');
  let done = 0, fail = 0;
  const worker = async () => {
    while (urls.length) {
      const u = urls.shift();
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: 'cors' });
          if (r.ok) await cache.put(u, r); else fail++;
        }
      } catch (e) { fail++; }
      done++;
      if (done % 20 === 0 && st) st.textContent = done + ' / ' + (done + urls.length) + ' татлаа';
    }
  };
  const total = urls.length;
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (st) st.textContent = `Дууслаа: ${total - fail} / ${total} хэсэг хадгалагдлаа${fail ? ' (' + fail + ' амжаагүй, дахин дарна уу)' : ''}`;
}

async function backup() {
  const data = {};
  for (const s of ['surveys', 'runs', 'points', 'sightings', 'meta']) data[s] = await db.all(s);
  const photos = await db.all('photos');
  data.photos = [];
  for (const p of photos) {
    const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(p.blob); });
    data.photos.push({ ...p, blob: b64 });
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const d = new Date();
  await exp.shareFile(blob, 'Saiga_backup_' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + '.json');
}

async function restore(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (!(await confirmBox('Нөөцөөс сэргээх үү?', 'Файл доторх өгөгдөл энэ утасны өгөгдөлтэй нэгдэнэ (ижил бичлэгийг дарж бичнэ).'))) return;
  try {
    const data = JSON.parse(await f.text());
    for (const s of ['surveys', 'runs', 'sightings', 'meta']) for (const v of data[s] || []) await db.put(s, v);
    for (const p of data.points || []) { const { n, ...rest } = p; await db.put('points', { ...rest, n }); }
    for (const p of data.photos || []) { const b = await (await fetch(p.blob)).blob(); await db.put('photos', { ...p, blob: b }); }
    toast('Сэргээлээ', 'ok');
    go('#/');
  } catch (err) { toast('Алдаа: ' + err.message, 'err', 5000); }
}

// ---------- судалгаа эхлүүлэх / засах ----------
async function newSurveyView(editId) {
  const now = new Date();
  const existing = editId ? await db.get('surveys', editId) : null;
  const s = existing || {
    name: `Шарга, баг 4, ${now.getFullYear()} оны ${now.getMonth() + 1}-р сар`.replace('Шарга, баг 4', 'Баг-4, Шарга'),
    leader: '', researchers: ['', '', ''], driver: '', recorder: '', transects: DEFAULT_TRANSECTS,
  };
  let transects = s.transects;
  let researchers = s.researchers.length ? [...s.researchers] : ['', '', ''];
  const render = () => {
    const names = [document.getElementById('leader')?.value ?? s.leader, ...researchers].filter((x) => x && x.trim());
    $app.innerHTML = topbar(existing ? 'Судалгаа засах' : 'Судалгаа эхлүүлэх', existing ? '#/s/' + encodeURIComponent(existing.id) : '#/') + `<div class="pad col">
      <div class="col gap4"><label class="lbl" for="sname">Судалгааны нэр</label><input id="sname" class="inp" value="${h(s.name)}"></div>
      <div class="note">Огноо автомат: эхний трансект эхлэхэд эхлэх өдөр, бүгд дуусахад дуусах өдөр бөглөгдөнө.</div>
      <div class="col gap4"><label class="lbl" for="leader">Багийн ахлагч</label><input id="leader" class="inp" value="${h(s.leader)}" data-names></div>
      <div class="col gap4"><span class="lbl">Судлаачид</span>
        ${researchers.map((r, i) => `<input class="inp" aria-label="Судлаач ${i + 1}" data-r="${i}" value="${h(r)}" placeholder="Судлаач ${i + 1}" data-names>`).join('')}
        <button class="btn dashed" data-act="addr">+ Судлаач нэмэх</button>
      </div>
      <div class="col gap4"><label class="lbl" for="driver">Жолооч</label><input id="driver" class="inp" value="${h(s.driver)}"></div>
      <div class="col gap4"><span class="lbl">Энэ утсаар хэн бүртгэх вэ?</span>
        <div class="chips" id="recchips">${names.map((n) => `<button class="chip ${n === s.recorder ? 'on' : ''}" data-act="rec" data-n="${h(n)}">${h(n)}</button>`).join('') || '<span class="muted small">Дээр нэрсээ бичнэ үү</span>'}</div>
      </div>
      <div class="col gap4"><span class="lbl">Трансектууд</span>
        <div class="card row between"><div class="col"><b>${transects === DEFAULT_TRANSECTS ? '2026 оны гэрээний трансект' : 'Оруулсан трансект'}</b><span class="muted small">${transects.length} трансект · ${transects.reduce((a, t) => a + t.km, 0).toFixed(1)} км · ${h(transects.map((t) => t.id).join(', '))}</span></div>
        ${existing ? '' : '<label class="link">Файл<input type="file" id="tfile" accept=".gpx,.kml,.csv,.geojson,.json" hidden></label>'}</div>
      </div>
      <button class="btn big primary" data-act="save">${existing ? 'Хадгалах' : 'Эхлэх'}</button>
    </div>`;
    const tf = document.getElementById('tfile');
    if (tf) tf.addEventListener('change', async (e) => {
      try {
        const parsed = parseTransects(await e.target.files[0].text(), e.target.files[0].name);
        if (!parsed.length) throw new Error('Трансект олдсонгүй');
        transects = parsed; keep(); render(); toast(parsed.length + ' трансект орлоо', 'ok');
      } catch (err) { toast('Файл уншиж чадсангүй: ' + err.message, 'err', 5000); }
    });
    document.querySelectorAll('[data-names]').forEach((inp) => inp.addEventListener('change', () => { keep(); render(); }));
  };
  const keep = () => {
    s.name = document.getElementById('sname').value;
    s.leader = document.getElementById('leader').value;
    s.driver = document.getElementById('driver').value;
    researchers = [...document.querySelectorAll('[data-r]')].map((i) => i.value);
  };
  actions.addr = () => { keep(); researchers.push(''); render(); };
  actions.rec = (el) => { keep(); s.recorder = el.dataset.n; render(); };
  actions.save = async () => {
    keep();
    if (!s.name.trim()) return toast('Судалгааны нэр бичнэ үү', 'warn');
    if (!s.recorder) return toast('Энэ утсаар хэн бүртгэхийг сонгоно уу', 'warn');
    const rec = {
      ...(existing || { id: db.uid(), createdAt: Date.now(), startDate: null, endDate: null }),
      name: s.name.trim(), leader: s.leader.trim(), researchers: researchers.map((r) => r.trim()).filter(Boolean),
      driver: s.driver.trim(), recorder: s.recorder, transects,
    };
    await db.put('surveys', rec);
    if (existing) {
      // Нэр өөрчлөгдсөн бол Sheet-д дахин илгээнэ
      for (const x of await db.byIndex('sightings', 'survey', rec.id)) { x.synced = false; x.rev = Date.now(); x.recorder = x.recorder || rec.recorder; await db.put('sightings', x); }
      for (const t of rec.transects) { const r = await db.get('runs', runKey(rec.id, t.id)); if (r) { r.synced = false; r.rev = Date.now(); await db.put('runs', r); } }
    }
    go('#/s/' + encodeURIComponent(rec.id));
  };
  render();
}

function parseTransects(text, name) {
  const out = [];
  const add = (id, a, b) => {
    id = String(id).replace(/^Transect/i, '').trim().toUpperCase();
    const km = Math.round(geo.distance(a[1], a[0], b[1], b[0]) / 100) / 10;
    out.push({ id, km, a, b });
  };
  if (/\.csv$/i.test(name)) {
    const lines = text.trim().split(/\r?\n/);
    const head = lines.shift().split(',').map((x) => x.trim().toLowerCase());
    const ix = (k) => head.indexOf(k);
    for (const l of lines) {
      const c = l.split(',');
      add(c[ix('name')], [+c[ix('start_lon')], +c[ix('start_lat')]], [+c[ix('end_lon')], +c[ix('end_lat')]]);
    }
    return out;
  }
  if (/\.(geo)?json$/i.test(name)) {
    const j = JSON.parse(text);
    for (const f of j.features || []) {
      const c = f.geometry.coordinates;
      add(f.properties.name, c[0], c[c.length - 1]);
    }
    return out;
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (/\.gpx$/i.test(name)) {
    for (const r of doc.getElementsByTagName('rte')) {
      const pts = r.getElementsByTagName('rtept');
      const nm = r.getElementsByTagName('name')[0]?.textContent || 'T' + (out.length + 1);
      if (pts.length >= 2) add(nm, [+pts[0].getAttribute('lon'), +pts[0].getAttribute('lat')], [+pts[pts.length - 1].getAttribute('lon'), +pts[pts.length - 1].getAttribute('lat')]);
    }
    if (!out.length) {
      // Цэгүүд "15b1", "15b2" хэлбэртэй бол хос болгоно
      const w = {};
      for (const p of doc.getElementsByTagName('wpt')) {
        const nm = p.getElementsByTagName('name')[0]?.textContent || '';
        const m = nm.match(/^(.*?)([12])$/);
        if (m) (w[m[1]] = w[m[1]] || {})[m[2]] = [+p.getAttribute('lon'), +p.getAttribute('lat')];
      }
      for (const k of Object.keys(w)) if (w[k][1] && w[k][2]) add(k, w[k][1], w[k][2]);
    }
    return out;
  }
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const ls = pm.getElementsByTagName('LineString')[0];
    if (!ls) continue;
    const c = ls.getElementsByTagName('coordinates')[0].textContent.trim().split(/\s+/).map((x) => x.split(',').map(Number));
    add(pm.getElementsByTagName('name')[0]?.textContent || 'T' + (out.length + 1), c[0], c[c.length - 1]);
  }
  return out;
}

// ---------- судалгаа: трансектын жагсаалт ----------
async function surveyView(sid) {
  const survey = await db.get('surveys', sid);
  if (!survey) return go('#/');
  const runs = {}, pts = {};
  for (const t of survey.transects) {
    runs[t.id] = (await db.get('runs', runKey(sid, t.id))) || newRun(survey, t);
    pts[t.id] = await db.byIndex('points', 'run', runKey(sid, t.id));
  }
  const closed = (await db.getMeta('closed-' + sid, null)) || {};
  const stats = {};
  let doneN = 0, drivenKm = 0, remainKm = 0;
  for (const t of survey.transects) {
    stats[t.id] = runStats(runs[t.id], t, pts[t.id]);
    const r = runs[t.id];
    if (r.status === 'done' || r.status === 'incomplete') doneN++;
    drivenKm += stats[t.id].effortKm;
    remainKm += r.status === 'done' ? 0 : (r.status === 'new' ? t.km : stats[t.id].remainingKm);
  }
  const groups = {};
  const order = [];
  const addTo = (k, t) => { if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(t); };
  for (const t of survey.transects) {
    const r = runs[t.id];
    if (r.status === 'active') addTo('Явж байна', t);
    else if (r.status === 'paused' || r.status === 'returning' || r.status === 'incomplete') addTo('Дутуу', t);
    else if (r.status === 'done') addTo(fmtDate(stats[t.id].first ? stats[t.id].first.t : Date.now()), t);
  }
  const dates = order.filter((k) => /^\d{4}\./.test(k)).sort().reverse();
  const keys = ['Явж байна', 'Дутуу', ...dates].filter((k) => groups[k]);
  const sightsAll = (await db.byIndex('sightings', 'survey', sid)).filter((x) => !x.deleted);
  const notStarted = survey.transects.filter((t) => runs[t.id].status === 'new');
  if (notStarted.length) { groups['Эхлээгүй'] = notStarted; keys.push('Эхлээгүй'); }
  const row = (t) => {
    const r = runs[t.id], st = stats[t.id];
    let act = '';
    if (r.status === 'new') act = `<a class="mini dark" href="#/run/${encodeURIComponent(sid)}/${encodeURIComponent(t.id)}">Эхлэх</a>`;
    else if (r.status === 'done') act = '<span class="pill green">Дууссан</span>';
    else if (r.status === 'active') act = `<a class="mini orange" href="#/run/${encodeURIComponent(sid)}/${encodeURIComponent(t.id)}">Нээх</a>`;
    else act = `<a class="mini yellow" href="#/run/${encodeURIComponent(sid)}/${encodeURIComponent(t.id)}">Үргэлжлүүлэх</a>`;
    const extra = r.status === 'incomplete' ? `<span class="tiny warn">дутуу ${st.remainingKm.toFixed(1)}</span>` : '';
    return `<div class="trow ${r.status === 'incomplete' || r.status === 'paused' || r.status === 'returning' ? 'yel' : ''}">
      <a href="#/t/${encodeURIComponent(sid)}/${encodeURIComponent(t.id)}" class="tid">${h(t.id)}</a>
      <span>${t.km.toFixed(1)}</span><span class="b">${r.status === 'new' ? '–' : st.effortKm.toFixed(1)} ${extra}</span>${act}</div>`;
  };
  $app.innerHTML = `<div class="screen">
    ${topbar(survey.name, '#/', `<a class="iconbtn" href="#/new/${encodeURIComponent(sid)}" aria-label="Засах">${ICON.edit}</a>`)}
    <div class="subhead">${survey.startDate ? fmtDate(survey.startDate) + ' – ' + (survey.endDate ? fmtDate(survey.endDate) : '') : 'Эхлээгүй'} · Ахлагч: ${h(survey.leader || '-')} · Судлаач: ${h(survey.researchers.join(', ') || '-')} · Бүртгэгч: ${h(survey.recorder)}</div>
    <div class="scroll pad col">
      <img src="img/transect-map.jpg" alt="Трансектын зураг" class="mapimg" data-act="zoomimg">
      <div class="grid3">
        <div class="stat"><span>Дууссан</span><b class="green">${doneN} / ${survey.transects.length}</b></div>
        <div class="stat"><span>Явсан</span><b>${drivenKm.toFixed(1)} км</b></div>
        <div class="stat"><span>Үлдсэн</span><b class="orange">${remainKm.toFixed(1)} км</b></div>
      </div>
      <div id="report">${reportHtml(survey, sightsAll, stats, !!closed.__repOpen)}</div>
      ${keys.map((k) => {
        const open = !closed[k];
        return `<div class="group">
          <button class="ghead ${k === 'Дутуу' ? 'yel' : (k === 'Эхлээгүй' ? 'grey' : '')}" data-act="tog" data-k="${h(k)}"><b>${h(k)}</b><span class="muted small">${groups[k].length} трансект ${open ? '▲' : '▼'}</span></button>
          ${open ? `<div class="thead"><span>Трансект</span><span>Төлөв. км</span><span>Явсан км</span><span></span></div>${groups[k].map(row).join('')}` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="footbar">
      <button class="btn grow" data-act="sendall">Бүх өгөгдлийг имэйлээр</button>
      <button class="btn" data-act="syncnow">${ICON.cloud}</button>
    </div>
    <div class="muted small center" id="syncst" style="padding:0 12px 10px"></div>
  </div>`;
  syncStatusInto('syncst');
  const redrawReport = () => { const r = document.getElementById('report'); if (r) r.innerHTML = reportHtml(survey, sightsAll, stats, !!closed.__repOpen); };
  actions.rep = (el) => { reportSel = el.dataset.t; redrawReport(); };
  actions.togrep = async () => { closed.__repOpen = !closed.__repOpen; await db.setMeta('closed-' + sid, closed); redrawReport(); };
  actions.tog = async (el) => { closed[el.dataset.k] = !closed[el.dataset.k]; await db.setMeta('closed-' + sid, closed); surveyView(sid); };
  actions.syncnow = () => { if (!navigator.onLine) toast('Интернэт алга. Холбогдмогц өөрөө илгээнэ.', 'warn'); sync.syncAll(); };
  actions.sendall = async () => {
    toast('Файл бэлдэж байна...');
    try { const z = await exp.zipAll(survey); await exp.shareFile(z.blob, z.name, survey.name); } catch (e) { console.error(e); toast('Алдаа: ' + e.message, 'err', 5000); }
  };
  actions.zoomimg = () => {
    const o = document.createElement('div');
    o.className = 'overlay imgzoom';
    o.innerHTML = '<button class="btn closebtn">Хаах</button><div class="zoomwrap"><img src="img/transect-map.jpg" alt="Трансектын зураг"></div>';
    o.querySelector('.closebtn').onclick = () => o.remove();
    document.body.appendChild(o);
  };
}

// ---------- товч тайлан ----------
let reportSel = '';
function reportHtml(survey, sights, stats, open) {
  const tids = survey.transects.map((t) => t.id).filter((id) => sights.some((x) => x.tid === id) || stats[id].effortKm > 0);
  if (reportSel && !tids.includes(reportSel)) reportSel = '';
  const sel = reportSel;
  const eff = sights.filter((x) => x.effort && (!sel || x.tid === sel));
  const off = sights.filter((x) => !x.effort && (!sel || x.tid === sel));
  const km = sel ? stats[sel].effortKm : survey.transects.reduce((a, t) => a + stats[t.id].effortKm, 0);
  const rows = (list) => {
    const by = {};
    for (const x of list) (by[x.species] = by[x.species] || []).push(+x.total || 0);
    const order = QUICK_SPECIES.map((q) => q.mn);
    return Object.entries(by).sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    }).map(([sp, v]) => {
      const sum = v.reduce((a, b) => a + b, 0);
      return `<tr><td>${h(sp)}</td><td>${v.length}</td><td><b>${sum}</b></td><td>${(sum / v.length).toFixed(1)}</td><td>${Math.min(...v)}</td><td>${Math.max(...v)}</td></tr>`;
    }).join('');
  };
  const table = (list) => (list.length ? `<div class="rtable"><table><thead><tr><th>Зүйл</th><th>Сүрэг</th><th>Нийт</th><th>Дундаж</th><th>Мин</th><th>Макс</th></tr></thead><tbody>${rows(list)}</tbody></table></div>` : '<p class="muted small">Бүртгэл алга</p>');
  return `<div class="group">
    <button class="ghead" data-act="togrep"><b>Товч тайлан</b><span class="muted small">${open ? '▲' : '▼'}</span></button>
    ${open ? `<div class="pad col">
      <div class="chips"><button class="chip ${sel ? '' : 'on'}" data-act="rep" data-t="">Бүх трансект</button>${tids.map((id) => `<button class="chip ${sel === id ? 'on' : ''}" data-act="rep" data-t="${h(id)}">${h(id)}</button>`).join('')}</div>
      <span class="small">Судалгааны зам: <b>${km.toFixed(1)} км</b> · бүртгэл: <b>${eff.length}</b></span>
      ${table(eff)}
      ${off.length ? `<span class="small b">Судалгааны бус зам (тооллогод орохгүй)</span>${table(off)}` : ''}
    </div>` : ''}
  </div>`;
}

// ---------- трансектын дэлгэрэнгүй ----------
async function detailView(sid, tid) {
  const survey = await db.get('surveys', sid);
  if (!survey) return go('#/');
  const t = survey.transects.find((x) => x.id === tid);
  const run = await getRun(survey, t);
  const points = await db.byIndex('points', 'run', run.key);
  const sights = (await db.byIndex('sightings', 'survey', sid)).filter((s) => s.tid === tid).sort((a, b) => a.t - b.t);
  const st = runStats(run, t, points);
  const evName = { start: 'Эхэлсэн', pause: 'Түр зогссон', resume: 'Дахин эхэлсэн', end: 'Дууссан' };
  const species = {};
  sights.filter((s) => !s.deleted && s.effort).forEach((s) => { species[s.species] = (species[s.species] || 0) + (+s.total || 0); });
  $app.innerHTML = `<div class="screen">
    ${topbar(tid, '#/s/' + encodeURIComponent(sid), `<span class="pill ${run.status === 'done' ? 'green' : 'yellow'}">${STATUS_MN[run.status]}${run.status === 'incomplete' ? ' ' + st.remainingKm.toFixed(1) + ' км' : ''}</span>`)}
    <div id="dmap" class="dmap"></div>
    <div class="scroll pad col">
      <div class="grid3">
        <div class="stat"><span>Судалгааны зам</span><b>${st.effortKm.toFixed(2)} км</b></div>
        <div class="stat"><span>Хугацаа</span><b>${fmtDur(st.effortMs)}</b></div>
        <div class="stat"><span>Бүртгэл</span><b>${sights.filter((s) => !s.deleted).length}</b></div>
      </div>
      ${st.offKm > 0 ? `<div class="note">Судалгааны бус зам: ${st.offKm.toFixed(2)} км</div>` : ''}
      ${Object.keys(species).length ? `<div class="card small">${Object.entries(species).map(([k, v]) => `${h(k)}: <b>${v}</b>`).join(' · ')}</div>` : ''}
      <div class="card col small"><b>Цэгүүд</b>
        ${run.events.map((e) => `<div class="ev"><b>${evName[e.type]}</b> ${fmtDate(e.t)} ${fmtTime(e.t)}${e.reason ? ' · ' + h(e.reason) : ''}<br><span class="muted">${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}${e.alt != null ? ' · ' + Math.round(e.alt) + ' м' : ''}</span></div>`).join('') || '<span class="muted">Эхлээгүй</span>'}
        ${run.incompleteReason ? `<div class="warn">Дутуу шалтгаан: ${h(run.incompleteReason)}</div>` : ''}
      </div>
      <div class="card col"><b>Ажиглалтууд</b>
        ${sights.map((s) => `<button class="srow ${s.deleted ? 'del' : ''}" data-act="edit" data-id="${s.id}">
          <span><b>${h(s.gpsName)}</b> · ${h(s.species)}${s.effort ? '' : ' <span class="tiny warn">судалгааны бус</span>'}${s.deleted ? ' <span class="tiny">устгасан</span>' : ''}</span>
          <span>${s.total ?? ''}</span><span>${s.dist ?? '–'} м</span><span>${s.angle ?? '–'}°</span></button>`).join('') || '<span class="muted small">Бүртгэл алга</span>'}
      </div>
      ${run.status !== 'new' ? `<a class="btn" href="#/run/${encodeURIComponent(sid)}/${encodeURIComponent(tid)}">Газрын зургаар нээх</a>` : ''}
      <button class="btn" data-act="zipt">Энэ трансектын өгөгдөл илгээх (ZIP)</button>
    </div>
  </div>`;
  const map = L.map('dmap', { zoomControl: false, attributionControl: false });
  cleanup.push(() => map.remove());
  baseLayer(map);
  const [A, B] = [[t.a[1], t.a[0]], [t.b[1], t.b[0]]];
  L.polyline([A, B], { color: '#2F4A3A', weight: 3, dashArray: '8 6' }).addTo(map);
  for (const s of segments(points)) {
    if (s.points.length > 1) L.polyline(s.points.map((p) => [p.lat, p.lon]), s.effort ? { color: '#C2410C', weight: 4 } : { color: '#D99A00', weight: 4, dashArray: '2 7' }).addTo(map);
  }
  sights.filter((s) => !s.deleted).forEach((s) => sightMarker(s).addTo(map));
  map.fitBounds(L.latLngBounds([A, B]).pad(0.15));
  actions.edit = async (el) => {
    const s = await db.get('sightings', el.dataset.id);
    if (s && !s.deleted) openRecord({ survey, t, sighting: s, onDone: () => detailView(sid, tid) });
  };
  actions.zipt = async () => {
    toast('Файл бэлдэж байна...');
    try { const z = await exp.zipTransect(survey, tid); await exp.shareFile(z.blob, z.name, survey.name + ' ' + tid); } catch (e) { console.error(e); toast('Алдаа: ' + e.message, 'err', 5000); }
  };
}

function baseLayer(map) {
  const layer = L.tileLayer(TILE[settings.layer] || TILE.topo, { maxZoom: 17, maxNativeZoom: 16, attribution: TILE_ATTR, crossOrigin: true });
  layer.addTo(map);
  return layer;
}

function sightMarker(s) {
  const color = s.species === 'Монгол бөхөн' ? '#1D4ED8' : (s.species === 'Хар сүүлт зээр' ? '#7C3AED' : '#6B7280');
  const lat = s.animLat ?? s.obsLat, lon = s.animLon ?? s.obsLon;
  return L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(s.gpsName);
}

// ---------- замнал явах (навигац) ----------
async function runView(sid, tid) {
  const survey = await db.get('surveys', sid);
  if (!survey) return go('#/');
  const t = survey.transects.find((x) => x.id === tid);
  const run = await getRun(survey, t);
  const allPts = await db.byIndex('points', 'run', run.key);
  const L_M = lineLengthM(t);
  const R = {
    fix: null, follow: true, locked: false, lastPt: allPts[allPts.length - 1] || null,
    effortM: runStats(run, t, allPts).effortKm * 1000, fast: 0, alertLevel: 0, nearNotified: false, endNotified: false,
    startNotified: false, lastAlertBeep: 0, pendingSave: Promise.resolve(),
  };
  $app.innerHTML = `<div class="runscreen">
    <div id="rmap" class="rmap"></div>
    <div class="rtop">
      <div class="row between"><b class="big">${h(tid)}</b><span class="small" id="rstate"></span></div>
      <div class="grid3 rstats">
        <div><span>Явсан</span><b id="sdone">0.0 км</b></div>
        <div><span>Үлдсэн</span><b id="sleft">${(L_M / 1000).toFixed(1)} км</b></div>
        <div><span>Хугацаа</span><b id="stime">0:00</b></div>
      </div>
      <div class="prog"><div id="sprog"></div></div>
    </div>
    <div id="ralert" class="ralert hidden"></div>
    <div class="rside">
      <button class="fab" data-act="center" aria-label="Төвлөрүүлэх" id="bcenter">${ICON.center}</button>
      <button class="fab" data-act="lock" aria-label="Газрын зургийг түгжих" id="block">${ICON.unlock}</button>
      <button class="fab" data-act="layer" aria-label="Газрын зургийн давхарга">${ICON.layers}</button>
      <button class="fab" data-act="list" aria-label="Бүртгэсэн амьтад">${ICON.list}<span class="badge" id="scount"></span></button>
    </div>
    <a class="rback iconbtn light" href="#/s/${encodeURIComponent(sid)}" aria-label="Буцах" data-act="leave">${ICON.back}</a>
    <div class="rbottom" id="rbottom"></div>
  </div>`;

  // Газрын зураг
  const map = L.map('rmap', { zoomControl: false, attributionControl: false });
  cleanup.push(() => map.remove());
  let tiles = baseLayer(map);
  const ends = () => runEnds(run, t);
  survey.transects.forEach((x) => {
    if (x.id !== tid) L.polyline([[x.a[1], x.a[0]], [x.b[1], x.b[0]]], { color: '#6B7A70', weight: 2, dashArray: '4 6', opacity: 0.8 }).bindTooltip(x.id + ' · ' + x.km + ' км').addTo(map);
  });
  const plan = L.polyline([[t.a[1], t.a[0]], [t.b[1], t.b[0]]], { color: '#2F4A3A', weight: 5, dashArray: '12 8' }).bindTooltip(t.id + ' · ' + t.km + ' км').addTo(map);
  plan.on('click', () => toast(t.id + ' · ' + t.km + ' км'));
  const startMk = L.circleMarker(ends()[0], { radius: 8, color: '#2F4A3A', fillColor: '#2F4A3A', fillOpacity: 1 }).addTo(map);
  const endMk = L.circleMarker(ends()[1], { radius: 8, color: '#2F4A3A', weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  let curLine = null, curKey = null;
  for (const s of segments(allPts)) {
    if (s.points.length) curLine = L.polyline(s.points.map((p) => [p.lat, p.lon]), lineStyle(s.effort)).addTo(map);
    curKey = s.seg + '|' + s.effort;
  }
  const sightLayer = L.layerGroup().addTo(map);
  // Энэ трансектын бүртгэлүүд: газрын зураг дээрх цэг ба жагсаалт
  const drawSights = async () => {
    sightLayer.clearLayers();
    const list = (await db.byIndex('sightings', 'survey', sid)).filter((s) => s.tid === tid && !s.deleted).sort((a, b) => a.t - b.t);
    list.forEach((s) => sightMarker(s).on('click', () => editSight(s.id)).addTo(sightLayer));
    const c = document.getElementById('scount');
    if (c) c.textContent = list.length || '';
    return list;
  };
  const editSight = async (id) => {
    const s = await db.get('sightings', id);
    if (s && !s.deleted) openRecord({ survey, t, sighting: s, onDone: () => drawSights() });
  };
  await drawSights();
  const arrow = L.marker(ends()[0], { icon: arrowIcon(0), interactive: false, zIndexOffset: 1000 });
  const accCircle = L.circle(ends()[0], { radius: 10, color: '#1D4ED8', weight: 1, fillOpacity: 0.12, interactive: false });
  const guide = L.polyline([], { color: '#B5562A', weight: 3, dashArray: '4 6', interactive: false }).addTo(map);
  map.fitBounds(L.latLngBounds([[t.a[1], t.a[0]], [t.b[1], t.b[0]]]).pad(0.1));
  let autoTimer = null;
  map.on('dragstart zoomstart', (e) => {
    if (!e.originalEvent && e.type === 'zoomstart') return;
    R.follow = false;
    document.getElementById('bcenter')?.classList.add('attn');
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { R.follow = true; document.getElementById('bcenter')?.classList.remove('attn'); if (R.fix) map.panTo([R.fix.lat, R.fix.lon]); }, 10000);
  });
  cleanup.push(() => clearTimeout(autoTimer));

  actions.center = () => { R.follow = true; document.getElementById('bcenter').classList.remove('attn'); if (R.fix) map.setView([R.fix.lat, R.fix.lon], Math.max(map.getZoom(), 14)); };
  actions.lock = () => {
    R.locked = !R.locked;
    const f = R.locked ? 'disable' : 'enable';
    ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom'].forEach((k) => map[k] && map[k][f]());
    const b = document.getElementById('block');
    b.innerHTML = R.locked ? ICON.lock : ICON.unlock;
    b.classList.toggle('on', R.locked);
    toast(R.locked ? 'Газрын зураг түгжигдлээ' : 'Түгжээ тайллаа');
  };
  actions.layer = async () => {
    settings.layer = settings.layer === 'sat' ? 'topo' : 'sat';
    await saveSettings();
    map.removeLayer(tiles); tiles = baseLayer(map); tiles.bringToBack();
    toast(settings.layer === 'sat' ? 'Хиймэл дагуулын зураг' : 'Байр зүйн зураг');
  };
  actions.list = async () => {
    const list = await drawSights();
    const o = document.createElement('div');
    o.className = 'overlay sheetwrap';
    o.innerHTML = `<div class="sheet">
      <div class="sheethead"><h2>${h(tid)}: бүртгэсэн амьтад (${list.length})</h2><span class="muted small">Засах бол дээр нь дарна уу</span></div>
      <div class="sheetbody">${list.map((s) => `<button class="srow" data-id="${s.id}">
        <span><b>${h(s.gpsName)}</b> · ${h(s.species)}<br><span class="muted small">${fmtTime(s.t)}${s.effort ? '' : ' · судалгааны бус'}${s.note ? ' · ' + h(s.note) : ''}</span></span>
        <span>${s.total ?? ''}</span><span>${s.dist ?? '–'} м</span><span>${s.angle ?? '–'}°</span></button>`).join('') || '<p class="muted">Одоогоор бүртгэл алга.</p>'}
        ${list.length ? `<div class="card small">${Object.entries(list.filter((s) => s.effort).reduce((a, s) => { a[s.species] = (a[s.species] || 0) + (+s.total || 0); return a; }, {})).map(([k, v]) => `${h(k)}: <b>${v}</b>`).join(' · ')}</div>` : ''}
      </div>
      <div class="sheetfoot"><button class="btn big grow" data-x="1">Хаах</button></div></div>`;
    document.body.appendChild(o);
    o.querySelector('[data-x]').onclick = () => o.remove();
    o.querySelectorAll('.srow').forEach((b) => b.onclick = () => { o.remove(); editSight(b.dataset.id); });
  };
  actions.leave = async () => {
    if (run.status === 'active' && !(await confirmBox('Замналаас гарах уу?', 'Гарвал GPS бичлэг зогсоно. Дараа нь "Нээх" дарж үргэлжлүүлж болно.', 'Гарах', 'Үлдэх'))) return;
    go('#/s/' + encodeURIComponent(sid));
  };

  // Доод товчнууд
  const bottom = () => {
    const el = document.getElementById('rbottom');
    if (!el) return;
    const rec = `<button class="btn rec" data-act="record">${ICON.plus} Бүртгэл</button>`;
    if (run.status === 'new') el.innerHTML = `${rec}<div class="row gap"><button class="btn big grow primary" data-act="start">Эхлэх</button></div>`;
    else if (run.status === 'active') el.innerHTML = `${rec}<div class="row gap"><button class="btn grow" data-act="pause">Түр зогсоох</button><button class="btn grow dark" data-act="finish">Дуусгах</button></div>`;
    else if (run.status === 'paused' || run.status === 'returning' || run.status === 'incomplete') el.innerHTML = `${rec}<div class="row gap"><button class="btn grow yellowbtn" data-act="resume">Эхлэх (үргэлжлүүлэх)</button><button class="btn grow dark" data-act="finish">Дуусгах</button></div>`;
    else el.innerHTML = `<div class="banner green">Энэ трансект дууссан</div><div class="row gap"><a class="btn grow" href="#/t/${encodeURIComponent(sid)}/${encodeURIComponent(tid)}">Дэлгэрэнгүй</a><button class="btn grow" data-act="reopen">Дахин нээх</button></div>`;
    const stEl = document.getElementById('rstate');
    if (stEl) stEl.textContent = { new: 'Эхлээгүй', active: 'Судалгаа явж байна', paused: 'Түр зогссон', returning: 'Түр зогссон · шугам руу', done: 'Дууссан', incomplete: 'Дутуу' }[run.status];
  };

  const saveRun = async () => { run.synced = false; run.rev = Date.now(); await db.put('runs', run); };
  const event = (type, extra = {}) => {
    const f = R.fix;
    run.events.push({ type, t: Date.now(), lat: f.lat, lon: f.lon, alt: f.alt ?? null, ...extra });
  };
  const needFix = () => { if (!R.fix) { toast('GPS байрлал хүлээж байна...', 'warn'); return false; } return true; };

  actions.start = async () => {
    if (t.id === '23B' && run.status === 'new' && !(await confirmBox('23B трансект', '23B нь гэрээний газрын зураг дээр байхгүй тул хасагдсан байх магадлалтай. Багийн ахлагчаас лавлаад эхлүүлнэ үү. Эхлүүлэх үү?', 'Эхлүүлэх', 'Болих'))) return;
    if (!needFix()) return;
    const f = R.fix;
    const dA = geo.distance(f.lat, f.lon, t.a[1], t.a[0]), dB = geo.distance(f.lat, f.lon, t.b[1], t.b[0]);
    const near = Math.min(dA, dB);
    if (near > 200 && !(await confirmBox('Эхлэх цэгээс хол байна', `Хамгийн ойр төгсгөл ${fmtKm(near)} зайтай байна. Энд эхлэх үү?`, 'Эхлэх', 'Болих'))) return;
    const sun = geo.sunTimes(new Date(), f.lat, f.lon);
    const now = Date.now();
    if ((now < sun.sunrise.getTime() || now > sun.sunset.getTime()) && !(await confirmBox('Нар мандаагүй / жаргасан байна', `Нар ${fmtTime(sun.sunrise)}-д мандаж, ${fmtTime(sun.sunset)}-д жаргана. Удирдамжаар харанхуйд замнал явахгүй. Эхлэх үү?`, 'Эхлэх', 'Болих'))) return;
    run.dir = dA <= dB ? 'ab' : 'ba';
    startMk.setLatLng(ends()[0]); endMk.setLatLng(ends()[1]);
    run.seg = (run.seg || 0) + 1;
    event('start');
    run.status = 'active';
    await saveRun();
    if (!survey.startDate) { survey.startDate = now; await db.put('surveys', survey); }
    banner(`${tid} замнал эхэллээ`, 'green', 4000);
    beep(1, 660);
    bottom();
    onFix(R.fix);
  };

  actions.pause = async () => {
    if (!needFix()) return;
    const res = await pauseDialog(tid);
    if (!res) return;
    event('pause', { reason: res });
    run.status = 'returning';
    run.seg += 1;
    R.nearNotified = false;
    await saveRun();
    bottom();
    banner(`Түр зогслоо. Энэ хооронд явсан зам "${tid} судалгааны бус зам" гэж бичигдэнэ.`, 'yellow', 5000);
  };

  actions.resume = async () => {
    if (!needFix()) return;
    const [S, E] = ends();
    const fr = geo.lineFrame(S[0], S[1], E[0], E[1], R.fix.lat, R.fix.lon);
    if (Math.abs(fr.cross) > 100 && !(await confirmBox('Шугамаас хол байна', `Шугамаас ${Math.round(Math.abs(fr.cross))} м зайтай байна. Энд эхлэх үү?`, 'Эхлэх', 'Болих'))) return;
    run.seg = (run.seg || 0) + 1;
    event('resume');
    run.status = 'active';
    run.incompleteReason = '';
    await saveRun();
    bottom();
    banner(`${tid} үргэлжиллээ`, 'green', 3000);
    beep(1, 660);
  };

  actions.reopen = async () => {
    if (!(await confirmBox('Дахин нээх үү?', 'Трансект "түр зогссон" төлөвт орж, үргэлжлүүлэн бичиж болно.'))) return;
    run.status = 'returning';
    run.seg = (run.seg || 0) + 1;
    survey.endDate = null; await db.put('surveys', survey);
    await saveRun(); bottom();
  };

  actions.finish = async () => {
    if (!needFix()) return;
    const remaining = Math.max(0, L_M - (run.maxAlong || 0));
    let reason = '';
    if (remaining > 200) {
      const r = await modal({
        title: `${tid}: ${fmtKm(remaining)} дутуу байна`,
        body: '<p>Шугамын төгсгөлд хүрээгүй байна. Дуусгах уу?</p><label class="lbl" for="ireason">Дутуу дуусгах шалтгаан</label><input id="ireason" class="inp" placeholder="Жишээ нь: зам байхгүй, уул">',
        buttons: [
          { label: 'Үргэлжлүүлэх', value: 'cont', cls: 'dark' },
          { label: 'Түр зогсоох', value: 'pause', cls: 'yellowbtn' },
          { label: 'Дутуугаар дуусгах', value: (w) => 'inc:' + w.querySelector('#ireason').value.trim(), cls: 'danger', validate: (w) => { if (!w.querySelector('#ireason').value.trim()) { toast('Шалтгаан бичнэ үү', 'warn'); return false; } return true; } },
        ],
      });
      if (!r || r === 'cont') return;
      if (r === 'pause') { if (run.status === 'active') return actions.pause(); return; }
      reason = r.slice(4);
    } else if (!(await confirmBox(`${tid} дуусгах уу?`, '', 'Дуусгах', 'Болих'))) return;
    if (run.status === 'active') event('end'); else event('end', { offEffort: true });
    run.status = reason ? 'incomplete' : 'done';
    run.incompleteReason = reason;
    await saveRun();
    // Бүх трансект дууссан бол дуусах огноо
    const rs = await Promise.all(survey.transects.map((x) => db.get('runs', runKey(sid, x.id))));
    if (rs.every((r) => r && (r.status === 'done' || r.status === 'incomplete'))) { survey.endDate = Date.now(); await db.put('surveys', survey); }
    sync.syncAll();
    toast(`${tid} ${reason ? 'дутуугаар ' : ''}дууслаа`, 'ok');
    go('#/s/' + encodeURIComponent(sid));
  };

  actions.record = () => {
    if (!needFix()) return;
    const f = R.fix;
    openRecord({
      survey, t, map,
      obs: { t: Date.now(), lat: f.lat, lon: f.lon, alt: f.alt ?? null, effort: run.status === 'active' },
      onDone: () => drawSights(),
    });
  };

  // GPS бүрт
  const onFix = (f) => {
    if (!f || f.error) { if (f && f.error) banner(f.error, 'red', 5000); return; }
    const first = !R.fix;
    R.fix = f;
    const ll = [f.lat, f.lon];
    if (first) { arrow.addTo(map); accCircle.addTo(map); map.setView(ll, 14); }
    arrow.setLatLng(ll);
    arrow.setIcon(arrowIcon(f.heading || 0));
    accCircle.setLatLng(ll); accCircle.setRadius(f.acc || 10);
    if (R.follow && !first) map.panTo(ll, { animate: true, duration: 0.5 });
    const [S, E] = ends();
    const fr = geo.lineFrame(S[0], S[1], E[0], E[1], f.lat, f.lon);
    const along = Math.max(0, Math.min(L_M, fr.along));
    // Бичлэг
    const recording = run.status === 'active' || run.status === 'returning';
    if (recording && (f.acc == null || f.acc <= 50)) {
      const effort = run.status === 'active';
      const lp = R.lastPt;
      const moved = !lp || lp.seg !== run.seg ? Infinity : geo.distance(lp.lat, lp.lon, f.lat, f.lon);
      if (moved >= 5 || (lp && f.t - lp.t > 15000 && moved >= 1)) {
        const p = { runKey: run.key, seg: run.seg, effort, t: f.t, lat: f.lat, lon: f.lon, alt: f.alt ?? null, acc: f.acc ?? null };
        if (lp && lp.seg === run.seg && effort && moved !== Infinity) R.effortM += moved;
        R.lastPt = p;
        R.pendingSave = R.pendingSave.then(() => db.put('points', p)).catch((e) => console.error(e));
        const key = p.seg + '|' + p.effort;
        if (key !== curKey) { curLine = L.polyline([], lineStyle(effort)).addTo(map); curKey = key; }
        curLine.addLatLng(ll);
      }
      if (effort && along > (run.maxAlong || 0)) { run.maxAlong = along; R.dirty = true; }
    }
    // Мэдээлэл
    const st = runStats(run, t, []);
    document.getElementById('sdone').textContent = (R.effortM / 1000).toFixed(1) + ' км';
    document.getElementById('sleft').textContent = ((L_M - (run.maxAlong || 0)) / 1000).toFixed(1) + ' км';
    document.getElementById('stime').textContent = fmtDur(st.effortMs);
    document.getElementById('sprog').style.width = Math.min(100, (run.maxAlong || 0) / L_M * 100) + '%';
    const kmh = f.speed != null ? f.speed * 3.6 : null;
    const stEl = document.getElementById('rstate');
    if (stEl && run.status === 'active') stEl.textContent = 'Судалгаа явж байна' + (kmh != null ? ' · ' + Math.round(kmh) + ' км/ц' : '');
    // Хурд
    if (run.status === 'active' && kmh != null) {
      // 40 км/ц-аас хэтэрвэл 3 дараалсан цэгийн дараа сануулж, хэтэрсэн хэвээр бол 30 секунд тутам давтана
      R.fast = kmh > 40 ? R.fast + 1 : 0;
      if (R.fast >= 3 && Date.now() - (R.lastFastWarn || 0) > 30000) {
        R.lastFastWarn = Date.now();
        banner(`Хурд ${Math.round(kmh)} км/ц. 40 км/ц-аас бүү хэтрүүл (30-40 км/ц).`, 'red', 5000);
        beep(2, 520);
      }
      if (R.fast === 0) R.lastFastWarn = 0;
    }
    // Чиглүүлэг
    if (run.status === 'new') {
      const dA = geo.distance(f.lat, f.lon, t.a[1], t.a[0]), dB = geo.distance(f.lat, f.lon, t.b[1], t.b[0]);
      const target = dA <= dB ? [t.a[1], t.a[0]] : [t.b[1], t.b[0]];
      const d = Math.min(dA, dB);
      guide.setLatLngs([ll, target]);
      if (d < 50) { alertBox(`Эхлэх цэгт хүрлээ. "Эхлэх" дарна уу.`, 'green'); if (!R.startNotified) { beep(2, 880); R.startNotified = true; } }
      else alertBox(`Эхлэх цэг хүртэл ${fmtKm(d)} · ${relDir(f, target)}`, 'info');
      return;
    }
    if (run.status === 'returning') {
      const back = geo.destination(S[0], S[1], Math.max(0, Math.min(L_M, fr.along)), geo.bearing(S[0], S[1], E[0], E[1]));
      guide.setLatLngs([ll, back]);
      if (Math.abs(fr.cross) < 50 && fr.along > -50 && fr.along < L_M + 50) {
        alertBox('Шугамд хүрлээ. "Эхлэх" дарж үргэлжлүүлнэ үү.', 'green');
        if (!R.nearNotified) { beep(2, 880); R.nearNotified = true; }
      } else {
        R.nearNotified = false;
        alertBox(`Шугам хүртэл ${fmtKm(Math.abs(fr.cross))} · ${relDir(f, back)}`, 'info');
      }
      return;
    }
    guide.setLatLngs([]);
    if (run.status !== 'active') { alertBox('', ''); return; }
    if (fr.along >= L_M - 30 && !R.endNotified) { R.endNotified = true; beep(3, 990); banner('Төгсгөлд хүрлээ. "Дуусгах" дарна уу.', 'green', 8000); }
    const x = Math.abs(fr.cross);
    const dirTxt = fr.cross > 0 ? 'Зүүн' : 'Баруун';
    if (x >= settings.warn2) {
      alertBox(`${dirTxt} тийш ${Math.round(x)} м`, 'red', fr.cross > 0 ? 'L' : 'R', `Шугамаас хэт хазайлаа (${settings.warn2} м-ээс их)`);
      if (Date.now() - R.lastAlertBeep > 8000) { beep(3, 1000); R.lastAlertBeep = Date.now(); }
    } else if (x >= settings.warn1) {
      alertBox(`${dirTxt} тийш ${Math.round(x)} м`, 'yellow', fr.cross > 0 ? 'L' : 'R', `Шугамаас хазайлаа (${settings.warn2} м-ээс улаан дохио)`);
      if (R.alertLevel < 1) beep(1, 760);
    } else alertBox('', '');
    R.alertLevel = x >= settings.warn2 ? 2 : (x >= settings.warn1 ? 1 : 0);
  };
  const alertBox = (text, kind, dir, sub) => {
    const el = document.getElementById('ralert');
    if (!el) return;
    if (!text) { el.className = 'ralert hidden'; return; }
    el.className = 'ralert ' + kind;
    el.innerHTML = (dir ? (dir === 'L' ? ICON.arrowL : ICON.arrowR) : '') + `<div class="col"><b>${h(text)}</b>${sub ? `<span class="small">${h(sub)}</span>` : ''}</div>`;
  };

  // maxAlong-г үе үе хадгална
  const saver = setInterval(() => { if (R.dirty) { R.dirty = false; run.rev = Date.now(); db.put('runs', run); } }, 5000);
  cleanup.push(() => { clearInterval(saver); if (R.dirty) { run.rev = Date.now(); db.put('runs', run); } });

  bottom();
  cleanup.push(gps.onFix(onFix));
  if (settings.sim) {
    const [S, E] = ends();
    let from = null;
    if (run.status !== 'new') from = Math.max(0, (run.maxAlong || 0) - 100);
    gps.start({ startLL: S, endLL: E, factor: settings.simFactor, from });
    banner('ТУРШИЛТЫН ГОРИМ: дуураймал GPS', 'yellow', 4000);
  } else gps.start();
  cleanup.push(() => gps.stop());
  keepAwake(true);
  cleanup.push(() => keepAwake(false));
  if (run.status === 'active') banner('Бичлэг үргэлжилж байна', 'green', 3000);
}

// Зорилтот цэг рүү машины явж буй чиглэлтэй харьцуулсан заавар
function relDir(f, target) {
  const brg = Math.round(geo.bearing(f.lat, f.lon, target[0], target[1])) % 360;
  if (f.heading == null || !(f.speed > 1)) return brg + '°';
  const rel = (brg - f.heading + 360) % 360;
  const word = rel < 30 || rel > 330 ? 'урагшаа' : rel <= 150 ? 'баруун тийш' : rel < 210 ? 'буцаад' : 'зүүн тийш';
  return word + ' (' + brg + '°)';
}

const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + ' км' : Math.round(m) + ' м');
const lineStyle = (effort) => (effort ? { color: '#C2410C', weight: 5, interactive: false } : { color: '#D99A00', weight: 5, dashArray: '2 8', interactive: false });
function arrowIcon(deg) {
  return L.divIcon({ className: 'arrowicon', iconSize: [36, 36], iconAnchor: [18, 18], html: `<svg width="36" height="36" viewBox="0 0 36 36" style="transform:rotate(${deg}deg)"><path d="M18 3 L30 32 L18 25 L6 32 Z" fill="#1D4ED8" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>` });
}

function banner(text, kind = 'green', ms = 3000) {
  const el = document.createElement('div');
  el.className = 'rbanner ' + kind;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function pauseDialog(tid) {
  return modal({
    title: 'Түр зогсоох',
    body: `<p class="small">Шалтгаан:</p><div class="chips" id="preasons">
      <button class="chip on" data-r="Саад тойрох">Саад тойрох</button><button class="chip" data-r="Оройтсон">Оройтсон</button><button class="chip" data-r="Бусад">Бусад</button></div>
      <input id="pnote" class="inp" placeholder="Тайлбар (заавал биш)" style="margin-top:8px">
      <p class="small muted">Энэ хооронд явсан зам "${h(tid)} судалгааны бус зам" нэрээр хадгалагдана.</p>`,
    buttons: [{ label: 'Болих', value: null }, { label: 'Түр зогсоох', cls: 'yellowbtn', value: (w) => { const r = w.querySelector('#preasons .on').dataset.r; const n = w.querySelector('#pnote').value.trim(); return n ? r + ': ' + n : r; } }],
    onMount: (w) => w.querySelectorAll('#preasons .chip').forEach((c) => c.addEventListener('click', () => { w.querySelectorAll('#preasons .chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); })),
  });
}

// ---------- + Бүртгэл маягт ----------
function openRecord({ survey, t, obs, sighting, onDone }) {
  const editing = !!sighting;
  const s = sighting ? { ...sighting } : {
    id: db.uid(), surveyId: survey.id, tid: t.id, t: obs.t, obsLat: obs.lat, obsLon: obs.lon, obsAlt: obs.alt, effort: obs.effort,
    species: '', latin: '', code: '', total: null, male: null, female: null, young: null, unknown: null,
    dist: null, angle: null, snow: null, forbH: null, forbC: null, grassH: null, grassC: null, shrubH: null, shrubC: null,
    note: '', photos: [], recorder: survey.recorder, deleted: false, synced: false,
  };
  const newPhotos = []; // {id, blob, caption}
  let existingPhotos = [];
  let open = null; // аль тоо сонгогч нээлттэй
  let warnedMissing = false;
  let vegOpen = true;
  let warnedVeg = false;
  const quick = () => QUICK_SPECIES.find((q) => q.mn === s.species) || null;
  const isQuick = (q) => (q.other ? (s.species && !QUICK_SPECIES.some((x) => x.mn === s.species) && !/ сэг$/.test(s.species)) : q.carcass ? / сэг$/.test(s.species) : s.species === q.mn);
  const needSex = () => { const q = quick(); return q && q.sex; };
  const keypadOnly = () => { const q = quick(); return q && q.keypad; };

  const o = document.createElement('div');
  o.className = 'overlay sheetwrap';
  document.body.appendChild(o);
  const close = () => o.remove();

  const numBtns = (key) => {
    const cur = s[key];
    let html = '';
    for (let i = 1; i <= 19; i++) html += `<button class="nb ${cur === i ? 'on' : ''}" data-k="${key}" data-v="${i}">${i}</button>`;
    return html + `<button class="nb" data-k="${key}" data-v="20+">20+</button>`;
  };
  const numField = (key, label, cls = '') => `<button class="nf ${cls} ${open === key ? 'open' : ''}" data-open="${key}"><span>${label}</span><b>${s[key] ?? '–'}</b></button>`;

  const render = () => {
    const sum = ['male', 'female', 'young', 'unknown'].reduce((a, k) => a + (+s[k] || 0), 0);
    const hasParts = ['male', 'female', 'young', 'unknown'].some((k) => s[k] != null);
    const mismatch = s.total != null && hasParts && sum !== s.total;
    const sx = needSex();
    const kp = keypadOnly();
    const prevScroll = o.querySelector('.sheetbody')?.scrollTop || 0;
    o.innerHTML = `<div class="sheet">
      <div class="sheethead">
        <div class="row between"><h2>${editing ? 'Бүртгэл засах' : 'Бүртгэл'} · ${h(t.id)}</h2><span class="tag">${h(gpsNamePreview())}</span></div>
        <span class="muted small">${fmtDate(s.t)} ${fmtTime(s.t)} · ${s.obsLat.toFixed(5)}, ${s.obsLon.toFixed(5)}${s.obsAlt != null ? ' · ' + Math.round(s.obsAlt) + ' м' : ''} · ${h(s.recorder || '')}${s.effort ? '' : ' · <b class="warn">судалгааны бус</b>'}</span>
      </div>
      <div class="sheetbody">
        <span class="lbl">Зүйл</span>
        <div class="spgrid">${QUICK_SPECIES.map((q, i) => `<button class="sp ${isQuick(q) ? 'on' : ''}" data-q="${i}">${h(q.mn === 'Хар сүүлт зээр' ? 'Хар сүүлт зээр' : q.mn)}</button>`).join('')}</div>
        ${s.species && (!quick() || quick().carcass || quick().other) ? `<div class="chosen">Сонгосон: <b>${h(s.species)}</b>${s.latin ? ' <i>' + h(s.latin) + '</i>' : ''}</div>` : ''}
        ${kp ? `<div class="col gap4"><label class="lbl" for="ktotal">Тоо</label><input id="ktotal" class="inp big" type="number" inputmode="numeric" min="1" value="${s.total ?? ''}"></div>` : `
        <div class="col gap4">
          ${numField('total', 'Бодгалийн тоо', 'wide')}
          <div class="sexrow">${numField('male', 'Эр')}${numField('female', 'Эм')}${numField('young', 'Төл')}${numField('unknown', 'Тодорхойгүй')}</div>
          ${open ? `<div class="picker"><span class="small b">${{ total: 'Бодгалийн тоо', male: 'Эр', female: 'Эм', young: 'Төл', unknown: 'Тодорхойгүй' }[open]}: тоо сонгоно уу</span><div class="nbgrid">${numBtns(open)}</div>
            ${open !== 'total' ? '<button class="link small" data-clear="1">Арилгах</button>' : ''}${open !== 'total' && s.total != null ? ` <button class="link small" data-rest="1">Үлдсэнийг энд (${Math.max(0, s.total - (sum - (+s[open] || 0)))})</button>` : ''}</div>` : ''}
          ${mismatch ? `<div class="errbox">Эр, эм, төл, тодорхойгүйн нийлбэр ${sum}. Нийт ${s.total} байх ёстой.</div>` : ''}
          ${sx && !hasParts && s.total != null ? '<div class="note">Бөхөн, хар сүүлтэд эр, эм, төл, тодорхойгүйг заавал бөглөнө.</div>' : ''}
        </div>`}
        <div class="grid2">
          <div class="col gap4"><label class="lbl" for="fdist">Зай, м</label><input id="fdist" class="inp big" type="number" inputmode="numeric" min="0" value="${s.dist ?? ''}"></div>
          <div class="col gap4"><label class="lbl" for="fang">Өнцөг, 0–360°</label><input id="fang" class="inp big" type="number" inputmode="numeric" min="0" max="360" value="${s.angle ?? ''}"></div>
        </div>
        <button class="btn blue" data-act2="pick">${ICON.pin} Газрын зургаас оруулах</button>
        <details class="card veg" ${vegOpen ? 'open' : ''}>
          <summary><b>Цас, ургамал</b> <span class="muted small">(бөглөнө, байхгүй бол 0)</span></summary>
          <div class="row between"><span></span><button class="btn small" data-act2="same">Өмнөхтэй адил</button></div>
          <div class="veggrid">
            <span>Цас, мм</span><input class="inp" type="number" inputmode="decimal" data-f="snow" aria-label="Цас, мм" value="${s.snow ?? ''}"><span></span>
            <span></span><span class="tiny muted">Өндөр, см</span><span class="tiny muted">Бүрхэц, %</span>
            <span>Алаг өвс</span><input class="inp" type="number" inputmode="decimal" data-f="forbH" aria-label="Алаг өвс өндөр" value="${s.forbH ?? ''}"><input class="inp" type="number" inputmode="decimal" data-f="forbC" aria-label="Алаг өвс бүрхэц" value="${s.forbC ?? ''}">
            <span>Үетэн</span><input class="inp" type="number" inputmode="decimal" data-f="grassH" aria-label="Үетэн өндөр" value="${s.grassH ?? ''}"><input class="inp" type="number" inputmode="decimal" data-f="grassC" aria-label="Үетэн бүрхэц" value="${s.grassC ?? ''}">
            <span>Бут</span><input class="inp" type="number" inputmode="decimal" data-f="shrubH" aria-label="Бут өндөр" value="${s.shrubH ?? ''}"><input class="inp" type="number" inputmode="decimal" data-f="shrubC" aria-label="Бут бүрхэц" value="${s.shrubC ?? ''}">
          </div>
        </details>
        <div class="col gap4"><label class="lbl" for="fnote">Тэмдэглэл</label><textarea id="fnote" class="inp" rows="2" placeholder="ШИНЭ, үхсэн шалтгаан гэх мэт">${h(s.note)}</textarea></div>
        <span class="lbl">Зураг</span>
        <textarea id="fphnote" class="inp" rows="2" placeholder="Зургийн тайлбар: юуны зураг, нөхцөл байдал">${h(s.photoNote || '')}</textarea>
        <span class="muted small">Зураг тус бүрийн доор нэмэлт тайлбар бичиж болно.</span>
        <div class="photos">${[...existingPhotos, ...newPhotos].map((p) => `<div class="ph"><img src="${p.url}" alt=""><input class="inp small" data-cap="${p.id}" placeholder="Зургийн тайлбар бичих" value="${h(p.caption || '')}"><button class="link small danger" data-rmph="${p.id}">Хасах</button></div>`).join('')}</div>
        <div class="row gap"><label class="btn grow">Камер<input type="file" accept="image/*" capture="environment" id="pcam" hidden></label><label class="btn grow">Галерей<input type="file" accept="image/*" id="pgal" multiple hidden></label></div>
        ${editing ? '<button class="btn danger" data-act2="delete">Бүртгэл устгах</button>' : ''}
      </div>
      <div class="sheetfoot"><button class="btn" data-act2="cancel">Болих</button><button class="btn big primary grow" data-act2="save">Хадгалах</button></div>
    </div>`;
    o.querySelector('.sheetbody').scrollTop = prevScroll;
    bindInputs();
  };

  const readInputs = () => {
    const num = (id) => { const el = o.querySelector(id); if (!el) return undefined; const v = el.value.trim(); return v === '' ? null : +v; };
    const kt = num('#ktotal'); if (kt !== undefined) s.total = kt;
    const d = num('#fdist'); if (d !== undefined) s.dist = d;
    const a = num('#fang'); if (a !== undefined) s.angle = a;
    o.querySelectorAll('[data-f]').forEach((el) => { s[el.dataset.f] = el.value.trim() === '' ? null : +el.value; });
    const n = o.querySelector('#fnote'); if (n) s.note = n.value;
    const pn = o.querySelector('#fphnote'); if (pn) s.photoNote = pn.value;
    o.querySelectorAll('[data-cap]').forEach((el) => {
      const p = [...existingPhotos, ...newPhotos].find((x) => x.id === el.dataset.cap);
      if (p) p.caption = el.value;
    });
  };

  const gpsNamePreview = () => (s.species ? `${t.id}-${s.code || 'XX'}-${s.total ?? 0}` : `${t.id}-…`);

  const setSpecies = (mn, latin, code) => {
    s.species = mn; s.latin = latin || ''; s.code = code || codeFromLatin(latin);
    if (keypadOnly()) { s.male = s.female = s.young = s.unknown = null; open = null; }
  };

  const bindInputs = () => {
    o.querySelectorAll('[data-q]').forEach((b) => b.onclick = async () => {
      readInputs();
      const q = QUICK_SPECIES[+b.dataset.q];
      if (q.other) { const r = await speciesSearch(); if (r) setSpecies(r.mn, r.latin, r.code); }
      else if (q.carcass) {
        const r = await modal({ title: 'Ямар амьтны сэг вэ?', body: `<div class="chips">${CARCASS_OPTIONS.map((c) => `<button class="chip" data-c="${h(c)}">${h(c)}</button>`).join('')}</div><input id="ccustom" class="inp" placeholder="Бусад (бичих)" style="margin-top:8px">`, buttons: [{ label: 'Болих', value: null }, { label: 'Сонгох', cls: 'primary', value: (w) => w.querySelector('#ccustom').value.trim() || null }], onMount: (w, cl) => w.querySelectorAll('[data-c]').forEach((c) => c.onclick = () => cl(c.dataset.c)) });
        if (r) setSpecies(r + ' сэг', '', 'SG');
      } else setSpecies(q.mn, q.latin, q.code);
      render();
    });
    o.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { readInputs(); open = open === b.dataset.open ? null : b.dataset.open; render(); });
    o.querySelectorAll('.nb').forEach((b) => b.onclick = async () => {
      readInputs();
      const k = b.dataset.k;
      if (b.dataset.v === '20+') {
        const v = await modal({ title: { total: 'Бодгалийн тоо', male: 'Эр', female: 'Эм', young: 'Төл', unknown: 'Тодорхойгүй' }[k], body: `<input id="bigno" class="inp big" type="number" inputmode="numeric" min="1" value="${s[k] >= 20 ? s[k] : ''}" autofocus>`, buttons: [{ label: 'Болих', value: null }, { label: 'За', cls: 'primary', value: (w) => w.querySelector('#bigno').value }], onMount: (w) => setTimeout(() => w.querySelector('#bigno').focus(), 50) });
        if (v == null || v === '' || !(+v >= 0)) return;
        s[k] = Math.round(+v);
      } else s[k] = +b.dataset.v;
      open = null; render();
    });
    const clr = o.querySelector('[data-clear]'); if (clr) clr.onclick = () => { readInputs(); s[open] = null; open = null; render(); };
    const rest = o.querySelector('[data-rest]'); if (rest) rest.onclick = () => {
      readInputs();
      const others = ['male', 'female', 'young', 'unknown'].filter((k) => k !== open).reduce((a, k) => a + (+s[k] || 0), 0);
      s[open] = Math.max(0, s.total - others); open = null; render();
    };
    o.querySelectorAll('[data-rmph]').forEach((b) => b.onclick = () => {
      readInputs();
      const id = b.dataset.rmph;
      const i = newPhotos.findIndex((p) => p.id === id); if (i >= 0) newPhotos.splice(i, 1);
      const j = existingPhotos.findIndex((p) => p.id === id); if (j >= 0) existingPhotos.splice(j, 1);
      render();
    });
    const addFiles = async (files) => {
      readInputs();
      for (const f of files) { const blob = await compressImage(f); newPhotos.push({ id: db.uid(), blob, caption: '', url: URL.createObjectURL(blob) }); }
      render();
    };
    o.querySelector('#pcam').onchange = (e) => addFiles(e.target.files);
    o.querySelector('#pgal').onchange = (e) => addFiles(e.target.files);
    o.querySelectorAll('[data-act2]').forEach((b) => b.onclick = () => act2[b.dataset.act2]());
    const veg = o.querySelector('.veg');
    if (veg) veg.addEventListener('toggle', () => { vegOpen = veg.open; });
    const ang = o.querySelector('#fang');
    if (ang) ang.oninput = () => { if (+ang.value > 360) ang.value = 360; };
  };

  const act2 = {
    cancel: () => { close(); },
    pick: async () => {
      readInputs();
      const r = await mapPick(s.obsLat, s.obsLon, survey, t);
      if (r) { s.dist = r.dist; s.angle = r.angle; }
      render();
    },
    same: async () => {
      readInputs();
      const prev = (await db.byIndex('sightings', 'survey', survey.id)).filter((x) => x.id !== s.id && !x.deleted && [x.snow, x.forbH, x.forbC, x.grassH, x.grassC, x.shrubH, x.shrubC].some((v) => v != null)).sort((a, b) => b.t - a.t)[0];
      if (!prev) return toast('Өмнөх утга алга', 'warn');
      ['snow', 'forbH', 'forbC', 'grassH', 'grassC', 'shrubH', 'shrubC'].forEach((k) => { s[k] = prev[k]; });
      render();
    },
    delete: async () => {
      if (!(await confirmBox('Бүртгэл устгах уу?', `${s.gpsName} · ${s.species}`, 'Устгах', 'Болих', 'danger'))) return;
      if (!(await confirmBox('Үнэхээр устгах уу?', 'Google Sheet-д "устгасан" гэж тэмдэглэгдэнэ.', 'Тийм, устгах', 'Болих', 'danger'))) return;
      s.deleted = true; s.synced = false; s.rev = Date.now();
      await db.put('sightings', s);
      close(); toast('Устгалаа'); sync.syncAll();
      onDone && onDone(s);
    },
    save: async () => {
      readInputs();
      const err = (m, ms = 3500) => { toast(m, 'warn', ms); return false; };
      if (!s.species) return err('Зүйл сонгоно уу');
      if (s.total == null || !(s.total >= 1)) return err('Бодгалийн тоо оруулна уу');
      const sum = ['male', 'female', 'young', 'unknown'].reduce((a, k) => a + (+s[k] || 0), 0);
      const hasParts = ['male', 'female', 'young', 'unknown'].some((k) => s[k] != null);
      if (needSex() && !hasParts) return err('Бөхөн, хар сүүлтэд эр, эм, төл, тодорхойгүйг бөглөнө үү');
      if (hasParts && sum !== s.total) return err(`Нийлбэр ${sum}. Нийт ${s.total} байх ёстой.`);
      if (s.angle != null && (s.angle < 0 || s.angle > 360)) return err('Өнцөг 0-360 байна');
      const VEG = ['snow', 'forbH', 'forbC', 'grassH', 'grassC', 'shrubH', 'shrubC'];
      if (VEG.some((k) => s[k] == null || isNaN(s[k])) && !warnedVeg) {
        warnedVeg = true; vegOpen = true; render();
        return err('Цас, ургамлын өндөр, бүрхэц дутуу байна. Бөглөх эсвэл "Өмнөхтэй адил" дарна уу. Бичихгүй хадгалах бол дахин "Хадгалах" дарна.', 5000);
      }
      if (VEG.some((k) => s[k] < 0) || ['forbC', 'grassC', 'shrubC'].some((k) => s[k] > 100)) return err('Цас, ургамлын утга буруу байна (бүрхэц 0-100%)');
      if (s.dist != null && s.dist < 0) return err('Зай буруу байна');
      if ((s.dist == null || s.angle == null) && !keypadOnly() && !warnedMissing) {
        warnedMissing = true;
        return err('Зай, өнцөг бөглөөгүй байна. Тэгсээр хадгалах бол дахин "Хадгалах" дарна уу.');
      }
      if (s.dist != null && s.angle != null) { const p = geo.destination(s.obsLat, s.obsLon, s.dist, s.angle); s.animLat = p[0]; s.animLon = p[1]; } else { s.animLat = null; s.animLon = null; }
      // GPS нэр (давхцвал -2, -3)
      const base = `${t.id}-${s.code || 'XX'}-${s.total}`;
      if (!editing || !s.gpsName || !s.gpsName.startsWith(base)) {
        const others = (await db.byIndex('sightings', 'survey', survey.id)).filter((x) => x.id !== s.id).map((x) => x.gpsName);
        let name = base, n = 2;
        while (others.includes(name)) name = base + '-' + n++;
        s.gpsName = name;
      }
      // Зураг
      const keepIds = existingPhotos.map((p) => p.id);
      for (const pid of s.photos || []) if (!keepIds.includes(pid)) await db.del('photos', pid);
      for (const p of existingPhotos) { const rec = await db.get('photos', p.id); if (rec && rec.caption !== p.caption) { rec.caption = p.caption; rec.link = rec.link; await db.put('photos', rec); } }
      for (const p of newPhotos) await db.put('photos', { id: p.id, sightingId: s.id, blob: p.blob, caption: p.caption || '' });
      s.photos = [...keepIds, ...newPhotos.map((p) => p.id)];
      s.synced = false;
      s.rev = Date.now();
      await db.put('sightings', s);
      close();
      toast(`Хадгаллаа: ${s.gpsName}`, 'ok');
      sync.syncAll();
      onDone && onDone(s);
    },
  };

  (async () => {
    if (editing && s.photos && s.photos.length) {
      for (const pid of s.photos) { const p = await db.get('photos', pid); if (p) existingPhotos.push({ id: p.id, caption: p.caption, url: URL.createObjectURL(p.blob) }); }
    }
    render();
  })();
}

async function speciesSearch() {
  return modal({
    title: 'Зүйл сонгох',
    body: `<input id="sq" class="inp" placeholder="Монгол, англи, латин нэрээр хайх" autocomplete="off">
      <div id="sres" class="sres"></div>
      <label class="lbl" for="sfree" style="margin-top:8px">Жагсаалтад байхгүй бол гараар бичих</label><input id="sfree" class="inp">`,
    buttons: [{ label: 'Болих', value: null }, { label: 'Бичсэнийг сонгох', cls: 'primary', value: (w) => { const v = w.querySelector('#sfree').value.trim(); return v ? { mn: v, latin: '', code: 'XX' } : null; } }],
    onMount: (w, cl) => {
      const q = w.querySelector('#sq'), res = w.querySelector('#sres');
      const show = () => {
        const term = q.value.trim().toLowerCase();
        const list = (term ? SPECIES.filter((x) => (x.mn + ' ' + x.en + ' ' + x.latin).toLowerCase().includes(term)) : SPECIES.filter((x) => x.group === 'Хөхтөн')).slice(0, 40);
        res.innerHTML = list.map((x, i) => `<button class="sitem" data-i="${i}"><b>${h(x.mn)}</b> <span class="muted small">${h(x.group)} · <i>${h(x.latin)}</i></span></button>`).join('') || '<span class="muted small">Олдсонгүй</span>';
        res.querySelectorAll('.sitem').forEach((b) => b.onclick = () => { const x = list[+b.dataset.i]; cl({ mn: x.mn, latin: x.latin, code: codeFromLatin(x.latin) }); });
      };
      q.addEventListener('input', show);
      show();
      setTimeout(() => q.focus(), 50);
    },
  });
}

// ---------- газрын зургаас зай, өнцөг ----------
function mapPick(lat, lon, survey, t) {
  return new Promise((resolve) => {
    const o = document.createElement('div');
    o.className = 'overlay pickwrap';
    o.innerHTML = `<div id="pmap" class="pmap"></div>
      <div class="ptop"><b>Сүргийн төвийг газрын зураг дээр дарна уу</b><span class="small">Машины байрлал: амьтан анх харсан агшин</span></div>
      <div class="pbottom"><div class="grid2"><div class="stat"><span>Зай</span><b id="pd">–</b></div><div class="stat"><span>Өнцөг</span><b id="pa">–</b></div></div>
      <div class="row gap"><button class="btn grow" id="pclear">Арилгах</button><button class="btn grow" id="pcancel">Болих</button><button class="btn grow primary" id="pok">Болсон</button></div></div>`;
    document.body.appendChild(o);
    const map = L.map('pmap', { zoomControl: false, attributionControl: false }).setView([lat, lon], 14);
    baseLayer(map);
    L.polyline([[t.a[1], t.a[0]], [t.b[1], t.b[0]]], { color: '#2F4A3A', weight: 4, dashArray: '10 8' }).addTo(map);
    L.marker([lat, lon], { icon: arrowIcon(gps.lastFix()?.heading || 0), interactive: false }).addTo(map);
    let target = null, line = null, mk = null, val = null;
    map.on('click', (e) => {
      target = e.latlng;
      const d = Math.round(geo.distance(lat, lon, target.lat, target.lng));
      const a = Math.round(geo.bearing(lat, lon, target.lat, target.lng)) % 360;
      val = { dist: d, angle: a };
      if (line) line.remove(); if (mk) mk.remove();
      line = L.polyline([[lat, lon], target], { color: '#B5562A', weight: 3 }).addTo(map);
      mk = L.circleMarker(target, { radius: 9, color: '#fff', weight: 3, fillColor: '#B5562A', fillOpacity: 1 }).bindTooltip(`${a}°, ${d} м`, { permanent: true, direction: 'top', className: 'ptip' }).addTo(map);
      o.querySelector('#pd').textContent = d + ' м';
      o.querySelector('#pa').textContent = a + '°';
    });
    const done = (v) => { map.remove(); o.remove(); resolve(v); };
    o.querySelector('#pclear').onclick = () => { if (line) line.remove(); if (mk) mk.remove(); val = null; o.querySelector('#pd').textContent = '–'; o.querySelector('#pa').textContent = '–'; };
    o.querySelector('#pcancel').onclick = () => done(null);
    o.querySelector('#pok').onclick = () => { if (!val) return toast('Газрын зураг дээр цэг дарна уу', 'warn'); done(val); };
  });
}

init();
