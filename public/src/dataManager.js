// dataManager.js — Lädt GeoJSON, statistische Zeitreihen, und liefert Farbwerte
//
// Die Statistik-Datasets folgen dem Schema:
//   {
//     "<ISO-Code>": { "1990": <num>, "2000": <num>, ..., "2030": <num> },
//     ...
//   }
// ISO-Code = ISO 3166-1 alpha-3 für Länder (z. B. "CHE")
//          = ISO 3166-2 für Subnational-Einheiten (z. B. "CH-ZH", "DE-BY")
//
// `lookupValue` interpoliert linear zwischen den vorhandenen Stützstellen,
// damit auch Zwischenjahre flüssig auf dem Slider funktionieren.

import { clamp } from './utils/geo.js';

// ------------------------- URLs ----------------------------------
const GEO_URLS = {
  countries: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
  // 50m Auflösung → granular genug für Kantone/Bundesstaaten weltweit
  states: 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_1_states_provinces_shp.geojson'
};

const DATASET_URLS = {
  popDensity: '/data/popDensity.json',
  gdpNominal: '/data/gdp_nominal.json',
  gdpPpp: '/data/gdp_ppp.json',
  gdpPppPerCapita: '/data/gdp_ppp_per_capita.json'
};

// ------------------------- Cache ---------------------------------
const cache = {
  countries: null,
  states: null,
  datasets: {} // key → JSON-Objekt
};

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed (${r.status}): ${url}`);
  return r.json();
}

// --------------------- Country GeoJSON ---------------------------
export async function loadCountries() {
  if (cache.countries) return cache.countries;
  const g = await fetchJson(GEO_URLS.countries);
  cache.countries = (g.features || []).map(f => ({
    ...f,
    __kind: 'country',
    __name: f.properties?.name || f.properties?.NAME || '',
    __iso3: String(f.id || f.properties?.iso_a3 || f.properties?.ISO_A3 || '').toUpperCase()
  }));
  return cache.countries;
}

// ------------------ States/Provinces GeoJSON ---------------------
export async function loadStates() {
  if (cache.states) return cache.states;
  try {
    const g = await fetchJson(GEO_URLS.states);
    cache.states = (g.features || []).map(f => {
      const p = f.properties || {};
      // Natural Earth liefert je nach Datensatz unterschiedliche Felder.
      // Wir versuchen mehrere Quellen, um einen ISO-3166-2-Code zu bauen.
      const isoExplicit = p.iso_3166_2 || p.ISO_3166_2 || '';
      const hasc = (p.code_hasc || p.CODE_HASC || '').replace('.', '-');
      const parent = (p.iso_a2 || p.ISO_A2 || p.adm0_a2 || '').toUpperCase();
      const postal = (p.postal || p.POSTAL || p.code || '').toUpperCase();
      const fallback = (parent && postal) ? `${parent}-${postal}` : '';
      const iso = (isoExplicit || hasc || fallback).toUpperCase();

      return {
        ...f,
        __kind: 'state',
        __name: p.name || p.NAME || '',
        __admin: p.admin || p.ADMIN || '',
        __iso31662: iso
      };
    });
  } catch (e) {
    console.warn('[dataManager] States load failed', e);
    cache.states = [];
  }
  return cache.states;
}

// --------------------- Statistik-Datasets ------------------------
export async function loadDataset(key) {
  if (cache.datasets[key] !== undefined) return cache.datasets[key];
  const url = DATASET_URLS[key];
  if (!url) {
    console.warn(`[dataManager] Unknown dataset key: ${key}`);
    cache.datasets[key] = {};
    return cache.datasets[key];
  }
  try {
    cache.datasets[key] = await fetchJson(url);
  } catch (e) {
    console.warn(`[dataManager] Dataset "${key}" load failed`, e);
    cache.datasets[key] = {};
  }
  return cache.datasets[key];
}

/**
 * Holt den Wert für ein Land/eine Region in einem Jahr.
 * - Exakte Treffer werden direkt zurückgegeben.
 * - Zwischen vorhandenen Stützjahren wird linear interpoliert.
 * - Außerhalb des Bereichs wird mit dem Randwert geclamped (kein Extrapolieren).
 */
export function lookupValue(dataset, code, year) {
  if (!dataset || !code) return null;
  const series = dataset[code];
  if (!series) return null;

  const y = Number(year);
  if (series[y] != null) return series[y];

  const years = Object.keys(series).map(Number).sort((a, b) => a - b);
  if (years.length === 0) return null;
  if (y <= years[0]) return series[years[0]];
  if (y >= years[years.length - 1]) return series[years[years.length - 1]];

  let lo = years[0], hi = years[years.length - 1];
  for (let i = 0; i < years.length - 1; i++) {
    if (years[i] <= y && years[i + 1] >= y) { lo = years[i]; hi = years[i + 1]; break; }
  }
  const t = (y - lo) / (hi - lo);
  return series[lo] + (series[hi] - series[lo]) * t;
}

// ------------------- Heatmap-Konfiguration -----------------------
// `dataset`: Schlüssel in DATASET_URLS · `vmin/vmax`: Skalengrenzen für log-scale
export const HEATMAP_CONFIG = {
  none:            { label: '–',                  unit: '',       vmin: 0,   vmax: 1,      dataset: null },
  popDensity:      { label: 'Bevölkerungsdichte', unit: 'p/km²',  vmin: 1,   vmax: 25000,  dataset: 'popDensity' },
  gdpNominal:      { label: 'BIP (nominal)',      unit: 'Mrd USD',vmin: 1,   vmax: 30000,  dataset: 'gdpNominal' },
  gdpPpp:          { label: 'BIP (PPP)',          unit: 'Mrd USD',vmin: 1,   vmax: 45000,  dataset: 'gdpPpp' },
  gdpPppPerCapita: { label: 'BIP PPP pro Kopf',   unit: 'USD',    vmin: 100, vmax: 150000, dataset: 'gdpPppPerCapita' }
};

/** Viridis-ähnliche log-Skala → CSS-Farbstring; null wenn kein Wert. */
export function colorScale(v, vmin, vmax) {
  if (v == null || isNaN(v)) return null;
  const safeV = Math.max(v, 1);
  const safeMin = Math.max(vmin, 1);
  const t = clamp(
    (Math.log10(safeV) - Math.log10(safeMin)) /
    (Math.log10(vmax) - Math.log10(safeMin)),
    0, 1
  );
  const stops = [
    [0.00, [ 68,   1,  84]],
    [0.25, [ 59,  82, 139]],
    [0.50, [ 33, 145, 140]],
    [0.75, [ 94, 201,  98]],
    [1.00, [253, 231,  37]]
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) { lo = stops[i - 1]; hi = stops[i]; break; }
  }
  const f = (t - lo[0]) / Math.max(1e-6, hi[0] - lo[0]);
  const c = lo[1].map((x, i) => Math.round(x + (hi[1][i] - x) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},0.78)`;
}

/**
 * Wendet die aktuelle Heatmap auf eine Liste von GeoJSON-Features an.
 * Mutation in-place: setzt __fillColor und __label pro Feature.
 */
export async function applyHeatToFeatures(features, heatKey, year) {
  const cfg = HEATMAP_CONFIG[heatKey];
  if (!cfg || heatKey === 'none' || !cfg.dataset) {
    features.forEach(f => {
      f.__fillColor = null;
      f.__label = `<b>${f.__name}</b>${f.__admin ? `<br><small>${f.__admin}</small>` : ''}`;
    });
    return;
  }
  const dataset = await loadDataset(cfg.dataset);
  features.forEach(f => {
    const code = f.__kind === 'country' ? f.__iso3 : f.__iso31662;
    const v = lookupValue(dataset, code, year);
    f.__fillColor = colorScale(v, cfg.vmin, cfg.vmax);
    const valTxt = v != null ? Math.round(v).toLocaleString('de-CH') + ' ' + cfg.unit : 'k. A.';
    f.__label =
      `<b>${f.__name}</b>` +
      (f.__admin ? ` <small>(${f.__admin})</small>` : '') +
      `<br>${cfg.label} ${year}: ${valTxt}`;
  });
}
