// Геометрийн тооцоо: зай, өнцөг, шугамаас хазайлт, нар мандах/жаргах.
const R = 6371008.8;
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

export function distance(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Луужингийн өнцөг 0-360
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Ажиглагчаас зай, өнцгөөр амьтны байрлал
export function destination(lat, lon, distM, brg) {
  const d = distM / R, b = rad(brg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

// Шугамын эхлэл A -> төгсгөл B (lat,lon). Байрлалын шугам дагуух зай (along, м)
// ба хажуугийн хазайлт (cross, м; эерэг = явах чиглэлийн баруун тал).
export function lineFrame(aLat, aLon, bLat, bLon, lat, lon) {
  const lat0 = rad((aLat + bLat) / 2);
  const kx = R * Math.cos(lat0) * Math.PI / 180, ky = R * Math.PI / 180;
  const bx = (bLon - aLon) * kx, by = (bLat - aLat) * ky;
  const px = (lon - aLon) * kx, py = (lat - aLat) * ky;
  const L = Math.hypot(bx, by);
  const ux = bx / L, uy = by / L;
  const along = px * ux + py * uy;
  const cross = px * uy - py * ux; // баруун тал эерэг
  return { along, cross, length: L };
}

export function trackLength(points) {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += distance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  return s;
}

// NOAA-ийн хялбаршуулсан аргаар нар мандах, жаргах цаг (Date)
export function sunTimes(date, lat, lon) {
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (day - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl));
  const base = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const rise = 720 - 4 * (lon + deg(ha)) - eq;
  const set = 720 - 4 * (lon - deg(ha)) - eq;
  return { sunrise: new Date(base + rise * 60000), sunset: new Date(base + set * 60000) };
}
