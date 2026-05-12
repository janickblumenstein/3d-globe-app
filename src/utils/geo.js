// utils/geo.js — Reine Geometrie-Helfer (DOM-frei, testbar)

export const deg2rad = d => d * Math.PI / 180;
export const rad2deg = r => r * 180 / Math.PI;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrapLon = lon => ((lon + 540) % 360) - 180;
export const fmt = (n, k = 4) => Number(n).toFixed(k);

/** Großkreis-Distanz in km (Haversine) */
export function haversineKm(a, b) {
  const R = 6371;
  const phi1 = deg2rad(a.lat), phi2 = deg2rad(b.lat);
  const dPhi = deg2rad(b.lat - a.lat), dLam = deg2rad(b.lon - a.lon);
  const s = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Zielpunkt für Startposition + Bearing + Distanz (für Distanzringe) */
export function destination(lat, lon, bearingDeg, distKm) {
  const R = 6371;
  const delta = distKm / R;
  const theta = deg2rad(bearingDeg);
  const phi1 = deg2rad(lat), lam1 = deg2rad(lon);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lam2 = lam1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  );
  return { lat: rad2deg(phi2), lon: wrapLon(rad2deg(lam2)) };
}
