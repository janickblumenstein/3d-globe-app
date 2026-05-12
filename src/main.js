// main.js — Initialisierung & Orchestrierung
//
// Zuständig für: App-Zustand, Verdrahtung der UI-Events, externe APIs
// (Nominatim, Open-Meteo, Where-The-ISS-At) und das Refresh-Pipeline:
//   year/heatmap/borders ändern → refreshPolygons() → applyHeatToFeatures() → renderer.setPolygons()

import { GlobeRenderer } from './globeRenderer.js';
import { UIController } from './uiController.js';
import {
  loadCountries,
  loadStates,
  applyHeatToFeatures,
  getMetricMeta // <-- NEU (statt HEATMAP_CONFIG)
} from './dataManager.js';
import { wrapLon, clamp, haversineKm, fmt } from './utils/geo.js';
import { getSubSolarPoint, getSubLunarPoint } from './utils/astronomy.js';

const $ = id => document.getElementById(id);

const elements = {
  lat: $('lat'), lon: $('lon'), apply: $('apply'),
  search: $('search'), searchBtn: $('searchBtn'),
  geo: $('geo'), copy: $('copy'), reset: $('reset'),
  follow: $('follow'), clickSet: $('clickset'),
  antipode: $('antipode'), rings: $('rings'),
  spinBtn: $('spinBtn'), distBtn: $('distBtn'),
  dayNight: $('dayNight'), sunMoon: $('sunMoon'),
  iss: $('issChk'), wx: $('wxChk'),
  basemap: $('basemap'), borders: $('bordersSel'), heat: $('heatSel'),
  year: $('year'), yearLabel: $('yearLabel'),
  readout: $('readout')
};

const renderer = new GlobeRenderer($('globe'));
const ui = new UIController(elements);
ui.bindEvents();

// ============================ Application State =================================
const state = {
  centerLat: 47.3769,
  centerLon: 8.5417,
  distMode: false,
  distA: null,
  distB: null,
  spinning: false,
  iss: { pos: null, trail: [], timer: null },
  wx: {
    data: null,
    codeMap: {
      0: 'Klar', 1: 'Heiter', 2: 'Teils bewölkt', 3: 'Bedeckt',
      45: 'Nebel', 48: 'Reifnebel',
      51: 'Niesel leicht', 53: 'Niesel', 55: 'Niesel stark',
      61: 'Regen leicht', 63: 'Regen', 65: 'Regen stark',
      71: 'Schnee leicht', 73: 'Schnee', 75: 'Schnee stark',
      80: 'Schauer', 81: 'Schauer stark', 82: 'Schauer heftig',
      95: 'Gewitter', 96: 'Gewitter+Hagel', 99: 'Gewitter+Hagel stark'
    }
  }
};

// ============================ Render Helpers ===================================
function rebuildPoints() {
  const pts = [];
  pts.push({
    lat: state.centerLat, lng: state.centerLon,
    __color: '#00e5ff', __radius: 0.6, __alt: 0.02,
    __label: `<b>Zentrum</b><br>${fmt(state.centerLat, 4)}, ${fmt(state.centerLon, 4)}`
  });
  if (ui.isAntipode()) {
    pts.push({
      lat: -state.centerLat, lng: wrapLon(state.centerLon + 180),
      __color: '#ff80ab', __radius: 0.45, __alt: 0.02,
      __label: `Antipode<br>${fmt(-state.centerLat, 3)}, ${fmt(wrapLon(state.centerLon + 180), 3)}`
    });
  }
  if (ui.isSunMoon()) {
    const sun = getSubSolarPoint();
    const moon = getSubLunarPoint();
    pts.push({ lat: sun.lat, lng: sun.lon, __color: '#ffd54f', __radius: 0.9, __alt: 0.025,
      __label: `☀ Sub-solar<br>${fmt(sun.lat, 2)}, ${fmt(sun.lon, 2)}` });
    pts.push({ lat: moon.lat, lng: moon.lon, __color: '#cfd8dc', __radius: 0.7, __alt: 0.025,
      __label: `☾ Sub-lunar<br>${fmt(moon.lat, 2)}, ${fmt(moon.lon, 2)}` });
  }
  if (ui.isIss() && state.iss.pos) {
    const i = state.iss.pos;
    pts.push({
      lat: i.lat, lng: i.lon, __color: '#69f0ae', __radius: 0.55, __alt: 0.06,
      __label: `<b>ISS</b><br>${fmt(i.lat, 2)}, ${fmt(i.lon, 2)}<br>alt ~${i.alt?.toFixed(0) || '?'} km`
    });
  }
  if (state.distA) pts.push({ lat: state.distA.lat, lng: state.distA.lon, __color: '#7cff7c', __radius: 0.5, __alt: 0.02,
    __label: `A: ${fmt(state.distA.lat, 3)}, ${fmt(state.distA.lon, 3)}` });
  if (state.distB) pts.push({ lat: state.distB.lat, lng: state.distB.lon, __color: '#7cff7c', __radius: 0.5, __alt: 0.02,
    __label: `B: ${fmt(state.distB.lat, 3)}, ${fmt(state.distB.lon, 3)}` });
  renderer.setPoints(pts);
}

function rebuildArcs() {
  const arcs = [];
  if (state.distA && state.distB) {
    const km = haversineKm(state.distA, state.distB);
    arcs.push({
      startLat: state.distA.lat, startLng: state.distA.lon,
      endLat: state.distB.lat, endLng: state.distB.lon,
      __color: '#7cff7c', __label: `${km.toFixed(1)} km`
    });
  }
  if (ui.isIss() && state.iss.trail.length > 1) {
    for (let i = 1; i < state.iss.trail.length; i++) {
      const a = state.iss.trail[i - 1], b = state.iss.trail[i];
      arcs.push({ startLat: a.lat, startLng: a.lon, endLat: b.lat, endLng: b.lon,
                  __color: 'rgba(105,240,174,0.45)' });
    }
  }
  renderer.setArcs(arcs);
}

function updateReadout() {
  const heatKey = ui.getHeat();
  const meta = getMetricMeta(heatKey); // <-- Holt die Daten jetzt dynamisch aus dem Master-JSON

  ui.updateReadout({
    centerLat: state.centerLat, centerLon: state.centerLon,
    sunMoon: ui.isSunMoon(),
    iss: ui.isIss() ? state.iss : null,
    wx: ui.isWeather() ? state.wx : null,
    dist: state.distMode ? { a: state.distA, b: state.distB } : null,
    year: ui.getYear(),
    // Verwende 'meta.name' (definiert im JSON) statt dem alten 'cfg.label'
    heatLabel: (heatKey !== 'none' && meta) ? meta.name : null 
  });
}

function applyCenter(lat, lon, animate = true) {
  state.centerLat = clamp(Number(lat) || 0, -90, 90);
  state.centerLon = wrapLon(Number(lon) || 0);
  ui.setLatLon(state.centerLat, state.centerLon);
  rebuildPoints();
  renderer.refreshGuides(state.centerLat, state.centerLon);
  if (ui.isFollow()) renderer.setCenter(state.centerLat, state.centerLon, animate);

  // URL-Hash für Teilbarkeit
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  p.set('lat', state.centerLat.toFixed(4));
  p.set('lon', state.centerLon.toFixed(4));
  history.replaceState(null, '', `#${p.toString()}`);

  updateReadout();
  if (ui.isWeather()) fetchWeather();
}

// ============================ Polygons + Heatmap ================================
async function refreshPolygons() {
  try {
    let feats = [];
    const borderMode = ui.getBorders();
    
    // PERFORMANCE FIX: Entweder Länder ODER Kantone laden, nicht übereinander!
    if (borderMode === 'states' || borderMode === 'economic' || borderMode === 'language') {
      feats = await loadStates();
    } else if (borderMode === 'countries') {
      const c = await loadCountries();
      feats = c.slice();
    }

    let groupingMode = null;
    if (borderMode === 'economic') groupingMode = 'economic';
    if (borderMode === 'language') groupingMode = 'language';

    await applyHeatToFeatures(feats, ui.getHeat(), ui.getYear(), groupingMode);
    renderer.setPolygons(feats);
    updateReadout();
  } catch (e) {
    console.warn('[main] refreshPolygons failed', e);
  }
}

// ============================ Click Handler ====================================
function handleMapClick(lat, lng) {
  if (state.distMode) {
    if (!state.distA)      state.distA = { lat, lon: lng };
    else if (!state.distB) state.distB = { lat, lon: lng };
    else                  { state.distA = { lat, lon: lng }; state.distB = null; }
    rebuildPoints(); rebuildArcs(); updateReadout();
    return;
  }
  if (ui.isClickSet()) applyCenter(lat, lng);
}
renderer.onGlobeClick(handleMapClick);

// ============================ ISS Polling ======================================
async function tickIss() {
  try {
    const r = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    const j = await r.json();
    state.iss.pos = { lat: j.latitude, lon: j.longitude, alt: j.altitude };
    state.iss.trail.push({ lat: j.latitude, lon: j.longitude });
    if (state.iss.trail.length > 60) state.iss.trail.shift();
    rebuildPoints(); rebuildArcs(); updateReadout();
  } catch (e) { console.warn('[main] ISS fetch failed', e); }
}

// ============================ Weather ==========================================
async function fetchWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${state.centerLat}&longitude=${state.centerLon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,cloud_cover` +
      `&timezone=auto`;
    const r = await fetch(url);
    const j = await r.json();
    state.wx.data = j.current || null;
    updateReadout();
  } catch (e) { console.warn('[main] Weather fetch failed', e); }
}

// ============================ Search (Nominatim) ===============================
async function doSearch() {
  const q = ui.getSearchQuery();
  if (!q) return;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
    );
    const arr = await r.json();
    if (arr && arr[0]) applyCenter(parseFloat(arr[0].lat), parseFloat(arr[0].lon));
    else alert('Nicht gefunden.');
  } catch { alert('Suche fehlgeschlagen.'); }
}

// ============================ UI Wiring ========================================
ui.on('apply', () => { const { lat, lon } = ui.getLatLon(); applyCenter(lat, lon); });

ui.on('geolocate', () => {
  if (!navigator.geolocation) { alert('Geolocation nicht verfügbar.'); return; }
  navigator.geolocation.getCurrentPosition(
    p => applyCenter(p.coords.latitude, p.coords.longitude),
    () => alert('Konnte Standort nicht ermitteln.')
  );
});

ui.on('share', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    ui.setCopyText('✓');
    setTimeout(() => ui.setCopyText('🔗'), 800);
  } catch { alert('Kopieren fehlgeschlagen.'); }
});

ui.on('reset',     () => renderer.resetView());
ui.on('search',    doSearch);

ui.on('toggleSpin', () => {
  state.spinning = !state.spinning;
  ui.setSpinActive(state.spinning);
  renderer.setSpin(state.spinning);
});

ui.on('toggleDist', () => {
  state.distMode = !state.distMode;
  ui.setDistActive(state.distMode);
  if (!state.distMode) { state.distA = null; state.distB = null; rebuildPoints(); rebuildArcs(); }
  updateReadout();
});

ui.on('togglePoints',  () => { rebuildPoints(); rebuildArcs(); updateReadout(); });
ui.on('toggleRings',   () => { renderer.setShowRings(ui.isRings()); renderer.refreshGuides(state.centerLat, state.centerLon); });
ui.on('toggleDayNight',() => renderer.setDayNight(ui.isDayNight()));

ui.on('toggleIss', () => {
  if (ui.isIss()) {
    tickIss();
    state.iss.timer = setInterval(tickIss, 5000);
  } else {
    clearInterval(state.iss.timer);
    state.iss.timer = null;
    state.iss.pos = null;
    state.iss.trail = [];
    rebuildPoints(); rebuildArcs(); updateReadout();
  }
});

ui.on('toggleWeather', () => {
  state.wx.data = null;
  if (ui.isWeather()) fetchWeather(); else updateReadout();
});

ui.on('basemap',    () => renderer.setBasemap(ui.getBasemap()));
ui.on('borders',    refreshPolygons);
ui.on('heatChange', refreshPolygons);
ui.on('yearChange', refreshPolygons);  // <-- der Slider triggert rein das Recoloring

// ============================ Init =============================================
function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const la = parseFloat(p.get('lat'));
  const lo = parseFloat(p.get('lon'));
  return Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lon: lo } : null;
}

renderer.setBasemap(ui.getBasemap());
refreshPolygons();
const start = readHash() || ui.getLatLon();
applyCenter(start.lat, start.lon, false);

// Periodischer Refresh (Sub-solar wandert)
setInterval(() => {
  if (ui.isSunMoon()) { rebuildPoints(); updateReadout(); }
}, 30000);
