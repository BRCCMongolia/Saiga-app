// Өгөгдлийн загвар ба хүснэгтийн мөр болгон хувиргах функцууд.
import * as db from './db.js';
import { trackLength, distance } from './geo.js';

export const QUICK_SPECIES = [
  { mn: 'Монгол бөхөн', latin: 'Saiga tatarica', code: 'ST', sex: true },
  { mn: 'Хар сүүлт зээр', latin: 'Gazella subgutturosa', code: 'GS', sex: true },
  { mn: 'Бод мал', code: 'BD', keypad: true },
  { mn: 'Бог мал', code: 'BG', keypad: true },
  { mn: 'Айл', code: 'AI', keypad: true },
  { mn: 'Үнэг', latin: 'Vulpes vulpes', code: 'VV' },
  { mn: 'Хярс', latin: 'Vulpes corsac', code: 'VC' },
  { mn: 'Чоно', latin: 'Canis lupus', code: 'CL' },
  { mn: 'Сэг', code: 'SG', carcass: true },
  { mn: 'Бусад', other: true },
];

export const CARCASS_OPTIONS = ['Монгол бөхөн', 'Хар сүүлт зээр', 'Тэмээ', 'Адуу', 'Үхэр', 'Хонь, ямаа'];

export function codeFromLatin(latin) {
  const w = (latin || '').trim().split(/\s+/);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  if (w[0]) return w[0].slice(0, 2).toUpperCase();
  return 'XX';
}

export const runKey = (sid, tid) => sid + '|' + tid;

export function newRun(survey, t) {
  return {
    key: runKey(survey.id, t.id), surveyId: survey.id, tid: t.id,
    status: 'new', dir: 'ab', seg: 0, maxAlong: 0,
    events: [], incompleteReason: '', synced: false,
  };
}

export async function getRun(survey, t) {
  return (await db.get('runs', runKey(survey.id, t.id))) || newRun(survey, t);
}

export function runEnds(run, t) {
  // [эхлэл, төгсгөл] — [lat, lon]
  const a = [t.a[1], t.a[0]], b = [t.b[1], t.b[0]];
  return run.dir === 'ba' ? [b, a] : [a, b];
}

export function lineLengthM(t) {
  return distance(t.a[1], t.a[0], t.b[1], t.b[0]);
}

// Цэгүүдийг сегментээр бүлэглэнэ
export function segments(points) {
  const segs = [];
  let cur = null;
  for (const p of points) {
    if (!cur || cur.seg !== p.seg || cur.effort !== p.effort) {
      cur = { seg: p.seg, effort: p.effort, points: [] };
      segs.push(cur);
    }
    cur.points.push(p);
  }
  return segs;
}

export function runStats(run, t, points) {
  let effortM = 0, offM = 0;
  for (const s of segments(points)) {
    const l = trackLength(s.points);
    if (s.effort) effortM += l; else offM += l;
  }
  const L = lineLengthM(t);
  const remainingM = Math.max(0, L - (run.maxAlong || 0));
  const starts = run.events.filter((e) => e.type === 'start' || e.type === 'resume');
  const ends = run.events.filter((e) => e.type === 'pause' || e.type === 'end');
  let effortMs = 0;
  let open = null;
  for (const e of run.events) {
    if (e.type === 'start' || e.type === 'resume') open = e.t;
    else if ((e.type === 'pause' || e.type === 'end') && open) { effortMs += e.t - open; open = null; }
  }
  if (open && run.status === 'active') effortMs += Date.now() - open;
  return { effortKm: effortM / 1000, offKm: offM / 1000, remainingKm: remainingM / 1000, lengthKm: L / 1000, effortMs, first: starts[0], last: ends[ends.length - 1] };
}

export const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (t) => { const d = new Date(t); return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()); };
export const fmtTime = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const fmtDur = (ms) => { const m = Math.round(ms / 60000); return Math.floor(m / 60) + ':' + pad(m % 60); };
export const r5 = (x) => (x == null || x === '' ? '' : Math.round(x * 1e5) / 1e5);

export const SIGHTING_HEADERS = ['Трансект дугаар', 'Огноо', 'Эхэлсэн цаг', 'Дууссан цаг', 'д/д', 'цаг', 'зүйл', 'нийт', 'эр', 'эм', 'төл', 'тодорхойгүй', 'зай, м', 'өнцөг', 'gps нэр', 'өргөрөг', 'уртраг', 'өндөр, м', 'цас', 'алаг өвс, өндөр', 'алаг өвс, бүрхэц %', 'үетэн, өндөр', 'үетэн, бүрхэц %', 'бут, өндөр', 'бут, бүрхэц %', 'тэмдэглэл', 'латин нэр', 'амьтны өргөрөг', 'амьтны уртраг', 'бүртгэгч', 'судалгаа', 'зураг', 'зургийн тайлбар', 'төлөв', 'id'];

export function sightingRow(s, run, survey, idx) {
  const ev = run ? run.events : [];
  const st = { first: ev.find((e) => e.type === 'start'), last: ev.filter((e) => e.type === 'end' || e.type === 'pause').pop() };
  const v = (x) => (x == null ? '' : x);
  return {
    'Трансект дугаар': s.tid + (s.effort ? '' : ' судалгааны бус зам'),
    'Огноо': fmtDate(s.t),
    'Эхэлсэн цаг': st.first ? fmtTime(st.first.t) : '',
    'Дууссан цаг': st.last ? fmtTime(st.last.t) : '',
    'д/д': idx,
    'цаг': fmtTime(s.t),
    'зүйл': s.species,
    'нийт': v(s.total), 'эр': v(s.male), 'эм': v(s.female), 'төл': v(s.young),
    'зай, м': v(s.dist), 'өнцөг': v(s.angle), 'gps нэр': s.gpsName,
    'өргөрөг': r5(s.obsLat), 'уртраг': r5(s.obsLon), 'өндөр, м': s.obsAlt == null ? '' : Math.round(s.obsAlt),
    'цас': v(s.snow), 'алаг өвс, өндөр': v(s.forbH), 'алаг өвс, бүрхэц %': v(s.forbC),
    'үетэн, өндөр': v(s.grassH), 'үетэн, бүрхэц %': v(s.grassC), 'бут, өндөр': v(s.shrubH), 'бут, бүрхэц %': v(s.shrubC),
    'тэмдэглэл': s.note || '', 'тодорхойгүй': v(s.unknown), 'латин нэр': s.latin || '',
    'амьтны өргөрөг': r5(s.animLat), 'амьтны уртраг': r5(s.animLon),
    'бүртгэгч': s.recorder || '', 'судалгаа': survey ? survey.name : '',
    'зураг': (s.photoLinks || []).join(' '), 'зургийн тайлбар': s.photoNote || '', 'төлөв': s.deleted ? 'устгасан' : '', 'id': s.id,
  };
}

export const TRANSECT_HEADERS = ['Трансект', 'Төлөвлөсөн урт, км', 'Явсан урт, км', 'Судалгааны бус зам, км', 'Үлдсэн, км', 'Судалгааны хугацаа, ц:мин', 'Төлөв', 'Эхэлсэн огноо', 'Эхэлсэн цаг', 'Эхэлсэн өргөрөг', 'Эхэлсэн уртраг', 'Эхэлсэн өндөр', 'Дууссан огноо', 'Дууссан цаг', 'Дууссан өргөрөг', 'Дууссан уртраг', 'Дууссан өндөр', 'Түр зогсолт', 'Дутуу шалтгаан', 'бүртгэгч', 'судалгаа', 'id'];

export const STATUS_MN = { new: 'Эхлээгүй', active: 'Явж байна', paused: 'Түр зогссон', returning: 'Түр зогссон', done: 'Дууссан', incomplete: 'Дутуу' };

export function transectRow(run, t, points, survey) {
  const st = runStats(run, t, points);
  const f = st.first, l = run.events.filter((e) => e.type === 'end').pop();
  const pauses = run.events.filter((e) => e.type === 'pause' || e.type === 'resume')
    .map((e) => (e.type === 'pause' ? 'зогссон ' : 'эхэлсэн ') + fmtTime(e.t) + ' (' + r5(e.lat) + ', ' + r5(e.lon) + ')' + (e.reason ? ' ' + e.reason : '')).join('; ');
  return {
    'Трансект': t.id, 'Төлөвлөсөн урт, км': t.km, 'Явсан урт, км': +st.effortKm.toFixed(2),
    'Судалгааны бус зам, км': +st.offKm.toFixed(2), 'Үлдсэн, км': run.status === 'new' ? t.km : run.status === 'done' ? 0 : +st.remainingKm.toFixed(2),
    'Судалгааны хугацаа, ц:мин': run.status === 'new' ? '' : fmtDur(st.effortMs),
    'Төлөв': STATUS_MN[run.status],
    'Эхэлсэн огноо': f ? fmtDate(f.t) : '', 'Эхэлсэн цаг': f ? fmtTime(f.t) : '',
    'Эхэлсэн өргөрөг': f ? r5(f.lat) : '', 'Эхэлсэн уртраг': f ? r5(f.lon) : '', 'Эхэлсэн өндөр': f && f.alt != null ? Math.round(f.alt) : '',
    'Дууссан огноо': l ? fmtDate(l.t) : '', 'Дууссан цаг': l ? fmtTime(l.t) : '',
    'Дууссан өргөрөг': l ? r5(l.lat) : '', 'Дууссан уртраг': l ? r5(l.lon) : '', 'Дууссан өндөр': l && l.alt != null ? Math.round(l.alt) : '',
    'Түр зогсолт': pauses, 'Дутуу шалтгаан': run.incompleteReason || '',
    'бүртгэгч': survey.recorder || '', 'судалгаа': survey.name, 'id': run.sheetId || run.key,
  };
}

export function fileBase(survey) {
  const d = new Date(survey.createdAt);
  const tr = (s) => translit(s || '').replace(/[^A-Za-z0-9]+/g, '');
  return (survey.test ? 'TEST_' : '') + 'Bag4_Sharga_' + d.getFullYear() + '_' + (tr(survey.recorder) || 'X');
}

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'u', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function translit(s) {
  return s.split('').map((c) => {
    const lc = c.toLowerCase();
    if (!(lc in TR)) return c;
    const r = TR[lc];
    return c === lc ? r : r.charAt(0).toUpperCase() + r.slice(1);
  }).join('');
}
