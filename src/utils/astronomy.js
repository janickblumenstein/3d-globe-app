// utils/astronomy.js — Sub-solar/sub-lunar Punkte, Sonnenhöhe
import { deg2rad, rad2deg, wrapLon, clamp } from './geo.js';

/** Subsolarer Punkt (Längengrad, an dem die Sonne im Zenit steht) */
export function getSubSolarPoint(date = new Date()) {
  const d = (date.getTime() / 86400000) - 10957.5;
  const L = (280.460 + 0.9856474 * d) % 360;
  const g = deg2rad(((357.528 + 0.9856003 * d) % 360 + 360) % 360);
  const lambda = deg2rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const eps = deg2rad(23.439 - 0.0000004 * d);
  const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstH = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const gmstDeg = gmstH * 15;
  const HA = wrapLon(gmstDeg - rad2deg(alpha));
  return { lat: rad2deg(delta), lon: wrapLon(-HA) };
}

/** Sublunarer Punkt */
export function getSubLunarPoint(date = new Date()) {
  const d = (date.getTime() / 86400000) - 10957.5;
  const L = deg2rad((218.316 + 13.176396 * d) % 360);
  const M = deg2rad((134.963 + 13.064993 * d) % 360);
  const F = deg2rad((93.272 + 13.229350 * d) % 360);
  const lambda = L + deg2rad(6.289) * Math.sin(M);
  const beta = deg2rad(5.128) * Math.sin(F);
  const eps = deg2rad(23.439 - 0.0000004 * d);
  const alpha = Math.atan2(
    Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
    Math.cos(lambda)
  );
  const delta = Math.asin(
    Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda)
  );
  const gmstH = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const gmstDeg = gmstH * 15;
  const HA = wrapLon(gmstDeg - rad2deg(alpha));
  return { lat: rad2deg(delta), lon: wrapLon(-HA) };
}

/** Sonnenhöhe in Grad an einem Beobachtungspunkt */
export function solarAltitude(obsLat, obsLon, date = new Date()) {
  const sub = getSubSolarPoint(date);
  const phi1 = deg2rad(obsLat), phi2 = deg2rad(sub.lat);
  const dLam = deg2rad(obsLon - sub.lon);
  const cosZ = Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return rad2deg(Math.asin(clamp(cosZ, -1, 1)));
}
