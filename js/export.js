// Excel, KMZ, GPX, ZIP файл үүсгэх ба илгээх.
import * as db from './db.js';
import { SIGHTING_HEADERS, TRANSECT_HEADERS, sightingRow, transectRow, segments, runKey, newRun, fileBase, fmtDate, fmtTime, r5 } from './model.js';

export async function loadSurvey(survey) {
  const runs = {};
  const points = {};
  for (const t of survey.transects) {
    runs[t.id] = (await db.get('runs', runKey(survey.id, t.id))) || newRun(survey, t);
    points[t.id] = await db.byIndex('points', 'run', runKey(survey.id, t.id));
  }
  const sightings = (await db.byIndex('sightings', 'survey', survey.id)).sort((a, b) => a.t - b.t);
  return { survey, runs, points, sightings };
}

function sheet(rows, headers) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(8, Math.min(28, h.length + 2)) }));
  return ws;
}

export function buildXlsx(data, tids) {
  const { survey, runs, points } = data;
  const keep = (s) => !s.deleted && (!tids || tids.includes(s.tid));
  const sightings = data.sightings.filter(keep);
  const rowsFor = (list) => {
    const counter = {};
    return list.map((s) => {
      counter[s.tid] = (counter[s.tid] || 0) + 1;
      return sightingRow(s, runs[s.tid], survey, counter[s.tid]);
    });
  };
  const effort = sightings.filter((s) => s.effort);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rowsFor(effort), SIGHTING_HEADERS), 'Бүгд');
  const groups = [['Монгол бөхөн', 'Монгол бөхөн'], ['Хар сүүлт', 'Хар сүүлт зээр'], ['Бод мал', 'Бод мал'], ['Бог мал', 'Бог мал']];
  for (const [name, sp] of groups) XLSX.utils.book_append_sheet(wb, sheet(rowsFor(effort.filter((s) => s.species === sp)), SIGHTING_HEADERS), name);
  const ts = survey.transects.filter((t) => !tids || tids.includes(t.id));
  XLSX.utils.book_append_sheet(wb, sheet(ts.map((t) => transectRow(runs[t.id], t, points[t.id], survey)), TRANSECT_HEADERS), 'Трансект');
  XLSX.utils.book_append_sheet(wb, sheet(rowsFor(sightings.filter((s) => !s.effort)), SIGHTING_HEADERS), 'Судалгааны бус зам');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

export function buildKml(data, t) {
  const run = data.runs[t.id];
  const segs = segments(data.points[t.id]);
  const sights = data.sightings.filter((s) => s.tid === t.id && !s.deleted);
  const line = (pts) => pts.map((p) => r5(p.lon) + ',' + r5(p.lat) + ',' + (p.alt == null ? 0 : Math.round(p.alt))).join(' ');
  let k = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + esc(t.id) + '</name>';
  k += '<Style id="plan"><LineStyle><color>ff3a4a2f</color><width>2</width></LineStyle></Style>';
  k += '<Style id="eff"><LineStyle><color>ff0c41c2</color><width>4</width></LineStyle></Style>';
  k += '<Style id="off"><LineStyle><color>ff009ad9</color><width>3</width></LineStyle></Style>';
  k += '<Placemark><name>' + esc(t.id) + ' төлөвлөсөн</name><styleUrl>#plan</styleUrl><LineString><coordinates>' + t.a[0] + ',' + t.a[1] + ',0 ' + t.b[0] + ',' + t.b[1] + ',0</coordinates></LineString></Placemark>';
  // Нэг замналын бүх хэсгийг нэг мөрөнд (тасархайтай) нэгтгэж, нийт уртыг тайлбарт бичнэ (Трансект хүснэгттэй ижил тоо)
  const row = transectRow(run, t, data.points[t.id], data.survey);
  const pauses = run.events.filter((e) => e.type === 'pause').length;
  const desc = 'Судалгааны зам: ' + row['Явсан урт, км'].toFixed(2) + ' км · Судалгааны бус зам: ' + row['Судалгааны бус зам, км'].toFixed(2) + ' км · Төлөвлөсөн: ' + t.km + ' км · Түр зогсолт: ' + pauses;
  for (const eff of [true, false]) {
    const parts = segs.filter((s) => s.effort === eff && s.points.length >= 2);
    if (!parts.length) continue;
    const name = eff ? t.id : t.id + ' судалгааны бус зам';
    k += '<Placemark><name>' + esc(name) + '</name><description>' + esc(desc) + '</description><styleUrl>#' + (eff ? 'eff' : 'off') + '</styleUrl><MultiGeometry>'
      + parts.map((s) => '<LineString><tessellate>1</tessellate><coordinates>' + line(s.points) + '</coordinates></LineString>').join('') + '</MultiGeometry></Placemark>';
  }
  for (const e of run.events) {
    const nm = { start: 'эхэлсэн', pause: 'түр зогссон', resume: 'дахин эхэлсэн', end: 'дууссан' }[e.type];
    k += '<Placemark><name>' + esc(t.id + ' ' + nm + ' ' + fmtTime(e.t)) + '</name><Point><coordinates>' + r5(e.lon) + ',' + r5(e.lat) + '</coordinates></Point></Placemark>';
  }
  for (const s of sights) {
    const desc = s.species + ', ' + (s.total ?? '') + ' бодгаль, ' + (s.dist ?? '') + ' м, ' + (s.angle ?? '') + '°, ' + fmtDate(s.t) + ' ' + fmtTime(s.t) + (s.note ? ', ' + s.note : '');
    const lat = s.animLat ?? s.obsLat, lon = s.animLon ?? s.obsLon;
    k += '<Placemark><name>' + esc(s.gpsName) + '</name><description>' + esc(desc) + '</description><Point><coordinates>' + r5(lon) + ',' + r5(lat) + '</coordinates></Point></Placemark>';
  }
  return k + '</Document></kml>';
}

export async function buildKmz(data, t) {
  const z = new JSZip();
  z.file('doc.kml', buildKml(data, t));
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' });
}

export function buildGpx(data, t) {
  const segs = segments(data.points[t.id]);
  const sights = data.sightings.filter((s) => s.tid === t.id && !s.deleted);
  let g = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Saiga app BRCC" xmlns="http://www.topografix.com/GPX/1/1">';
  for (const s of sights) g += '<wpt lat="' + r5(s.animLat ?? s.obsLat) + '" lon="' + r5(s.animLon ?? s.obsLon) + '"><name>' + esc(s.gpsName) + '</name><desc>' + esc(s.species + ' ' + (s.total ?? '')) + '</desc></wpt>';
  for (const s of segs) {
    if (s.points.length < 2) continue;
    g += '<trk><name>' + esc(s.effort ? t.id : t.id + ' судалгааны бус зам') + '</name><trkseg>';
    for (const p of s.points) g += '<trkpt lat="' + r5(p.lat) + '" lon="' + r5(p.lon) + '">' + (p.alt == null ? '' : '<ele>' + Math.round(p.alt) + '</ele>') + '<time>' + new Date(p.t).toISOString() + '</time></trkpt>';
    g += '</trkseg></trk>';
  }
  return g + '</gpx>';
}

async function addPhotos(z, data, tid, folder) {
  const list = data.sightings.filter((s) => s.tid === tid && !s.deleted && s.photos && s.photos.length);
  for (const s of list) {
    let i = 0;
    for (const pid of s.photos) {
      const ph = await db.get('photos', pid);
      if (!ph) continue;
      i++;
      z.file(folder + s.gpsName + '_' + i + '.jpg', ph.blob);
      const cap = [s.photoNote, ph.caption].filter(Boolean).join('\n');
      if (cap) z.file(folder + s.gpsName + '_' + i + '.txt', cap);
    }
  }
}

export async function zipTransect(survey, tid) {
  const data = await loadSurvey(survey);
  const t = survey.transects.find((x) => x.id === tid);
  const base = tid + '_' + fileBase(survey);
  const z = new JSZip();
  z.file(base + '.xlsx', buildXlsx(data, [tid]));
  z.file(base + '.kmz', await buildKmz(data, t));
  z.file(base + '.gpx', buildGpx(data, t));
  await addPhotos(z, data, tid, 'Zurag/');
  return { blob: await z.generateAsync({ type: 'blob' }), name: base + '.zip' };
}

export async function zipAll(survey) {
  const data = await loadSurvey(survey);
  const fb = fileBase(survey);
  const base = 'Buh_transect_' + fb;
  const z = new JSZip();
  z.file('Excel/' + base + '.xlsx', buildXlsx(data));
  for (const t of survey.transects) {
    if (!data.points[t.id].length && !data.sightings.some((s) => s.tid === t.id)) continue;
    z.file('KMZ/' + t.id + '_' + fb + '.kmz', await buildKmz(data, t));
    z.file('GPX/' + t.id + '_' + fb + '.gpx', buildGpx(data, t));
    await addPhotos(z, data, t.id, 'Zurag/' + t.id + '/');
  }
  return { blob: await z.generateAsync({ type: 'blob' }), name: base + '.zip' };
}

// Утасны "Хуваалцах" цонхоор (Gmail гэх мэт) илгээнэ, болохгүй бол татаж авна.
export async function shareFile(blob, name, text) {
  const file = new File([blob], name, { type: blob.type || 'application/zip' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name, text: text || name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return 'downloaded';
}
