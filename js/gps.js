// GPS: жинхэнэ байрлал эсвэл туршилтын дуураймал GPS.
import { bearing, distance, destination } from './geo.js';

const listeners = new Set();
let watchId = null;
let simTimer = null;
let last = null;
let sim = null; // { path:[[lat,lon],...], pos:0, speed, wobble }

export function lastFix() { return last; }
export function onFix(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit(fix) {
  if (last && fix.heading == null && distance(last.lat, last.lon, fix.lat, fix.lon) > 3) {
    fix.heading = bearing(last.lat, last.lon, fix.lat, fix.lon);
  } else if (fix.heading == null && last) fix.heading = last.heading;
  last = fix;
  listeners.forEach((fn) => { try { fn(fix); } catch (e) { console.error(e); } });
}

export function start(simCfg) {
  stop();
  if (simCfg) return startSim(simCfg);
  if (!('geolocation' in navigator)) return false;
  watchId = navigator.geolocation.watchPosition((p) => {
    emit({
      lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude,
      acc: p.coords.accuracy, speed: p.coords.speed, heading: (p.coords.heading != null && !isNaN(p.coords.heading) && p.coords.speed > 1) ? p.coords.heading : null,
      t: p.timestamp || Date.now(),
    });
  }, (err) => {
    listeners.forEach((fn) => fn({ error: err.code === 1 ? 'GPS-ийн зөвшөөрөл өгөөгүй байна' : 'GPS олдохгүй байна' }));
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  return true;
}

export function stop() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
}

// Дуураймал: трансектын эхлэлээс 600 м зайнаас эхэлж, шугамаар явна.
// 35-40% орчимд 380 м хазайж (сануулга шалгах), 60%-д гуу тойрох мэт.
function startSim({ startLL, endLL, speedKmh = 35, factor = 5, from }) {
  const brg = bearing(startLL[0], startLL[1], endLL[0], endLL[1]);
  const L = distance(startLL[0], startLL[1], endLL[0], endLL[1]);
  const approach = destination(startLL[0], startLL[1], 600, (brg + 200) % 360);
  let along = -600;
  if (from != null) along = from;
  const v = speedKmh / 3.6 * factor;
  simTimer = setInterval(() => {
    along += v;
    let lat, lon;
    if (along < 0) {
      const k = (along + 600) / 600;
      lat = approach[0] + (startLL[0] - approach[0]) * k;
      lon = approach[1] + (startLL[1] - approach[1]) * k;
    } else {
      const a = Math.min(along, L + 300);
      const f = a / L;
      let off = 15 * Math.sin(a / 400);
      if (f > 0.35 && f < 0.40) off += 380 * Math.sin((f - 0.35) / 0.05 * Math.PI);
      const p = destination(startLL[0], startLL[1], a, brg);
      const q = destination(p[0], p[1], Math.abs(off), off >= 0 ? (brg + 90) % 360 : (brg + 270) % 360);
      lat = q[0]; lon = q[1];
    }
    emit({ lat, lon, alt: 1180 + 20 * Math.sin(along / 2000), acc: 5, speed: speedKmh / 3.6, t: Date.now(), sim: true });
  }, 1000);
  return true;
}
