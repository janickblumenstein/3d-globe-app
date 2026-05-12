// --- ANFANG DER DATEI ERSETZEN ---
import { clamp } from './utils/geo.js';

const GEO_URLS = {
  countries: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
  // NEU: 10m Auflösung für maximale Schärfe auf Kantonsebene
  states: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
};

const MASTER_DATA_URL = '/data/master_data.json';
// ... [cache, fetchJson, loadCountries, loadStates, lookupValue bleiben gleich] ...

const cache = {
  countries: null,
  states: null,
  masterData: null
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

// --------------------- Master-Data & Aggregation ------------------------
export async function loadMasterData() {
  if (cache.masterData) return cache.masterData;
  try {
    cache.masterData = await fetchJson(MASTER_DATA_URL);
  } catch (e) {
    console.error(`[dataManager] Master data load failed`, e);
    cache.masterData = { metrics: {}, groups: {}, timeSeries: {} };
  }
  return cache.masterData;
}

export function getMetricMeta(key) {
    return cache.masterData && cache.masterData.metrics ? cache.masterData.metrics[key] : null;
}

export function lookupValue(datasetId, year, metricKey) {
    const data = cache.masterData;
    if (!data) return null;

    if (data.groups && data.groups[datasetId]) {
        return _aggregateGroupValue(datasetId, year, metricKey);
    }

    const series = data.timeSeries ? data.timeSeries[datasetId] : null;
    if (!series) return null;

    const y = Number(year);
    if (series[y] && series[y][metricKey] != null) return series[y][metricKey];

    const years = Object.keys(series).map(Number).sort((a, b) => a - b);
    if (years.length === 0) return null;
    
    if (y <= years[0]) return series[years[0]][metricKey];
    if (y >= years[years.length - 1]) return series[years[years.length - 1]][metricKey];

    let lo = years[0], hi = years[years.length - 1];
    for (let i = 0; i < years.length - 1; i++) {
        if (years[i] <= y && years[i + 1] >= y) { lo = years[i]; hi = years[i + 1]; break; }
    }
    
    const valLo = series[lo][metricKey];
    const valHi = series[hi][metricKey];
    
    if(valLo == null || valHi == null) return null;

    const t = (y - lo) / (hi - lo);
    return valLo + (valHi - valLo) * t;
}

function _aggregateGroupValue(groupId, year, metricKey) {
    const data = cache.masterData;
    const group = data.groups[groupId];
    const metricMeta = data.metrics[metricKey];
    
    if (!group || !metricMeta) return null;

    let totalValue = 0;
    let count = 0;

    group.members.forEach(memberId => {
        const val = lookupValue(memberId, year, metricKey);
        if (val !== undefined && val !== null) {
            totalValue += val;
            count++;
        }
    });

    if (count === 0) return null;

    if (metricMeta.type === 'average') return totalValue / count;
    return totalValue;
}

/// ------------------- Heatmap-Konfiguration -----------------------
export const HEATMAP_CONFIG = {
  none:            { label: '–',                  unit: '',       vmin: 0,   vmax: 1,      dataset: null, aggregate: 'sum' },
  // WICHTIG: Dichte ist Durchschnitt (average), BIP ist Summe (sum)
  popDensity:      { label: 'Bevölkerungsdichte', unit: 'p/km²',  vmin: 1,   vmax: 25000,  dataset: 'popDensity', aggregate: 'average' },
  gdpNominal:      { label: 'BIP (nominal)',      unit: 'Mrd USD',vmin: 1,   vmax: 30000,  dataset: 'gdpNominal', aggregate: 'sum' },
  gdpPpp:          { label: 'BIP (PPP)',          unit: 'Mrd USD',vmin: 1,   vmax: 45000,  dataset: 'gdpPpp',     aggregate: 'sum' },
  gdpPppPerCapita: { label: 'BIP PPP pro Kopf',   unit: 'USD',    vmin: 100, vmax: 150000, dataset: 'gdpPppPerCapita', aggregate: 'average' }
};

export async function loadRegions() {
  if (cache.regions) return cache.regions;
  try {
    cache.regions = await fetchJson('/data/regions.json');
  } catch (e) {
    cache.regions = {};
  }
  return cache.regions;
}

export function colorScale(v, vmin, vmax) {
  if (v == null || isNaN(v)) return null;
  const safeV = Math.max(v, 1);
  const safeMin = Math.max(vmin, 1);
  const t = clamp((Math.log10(safeV) - Math.log10(safeMin)) / (Math.log10(vmax) - Math.log10(safeMin)), 0, 1);
  const stops = [[0.00, [68,1,84]], [0.25, [59,82,139]], [0.50, [33,145,140]], [0.75, [94,201,98]], [1.00, [253,231,37]]];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) { lo = stops[i - 1]; hi = stops[i]; break; }
  }
  const f = (t - lo[0]) / Math.max(1e-6, hi[0] - lo[0]);
  const c = lo[1].map((x, i) => Math.round(x + (hi[1][i] - x) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},0.78)`;
}

export async function applyHeatToFeatures(features, heatKey, year, groupingMode = null) {
  const cfg = HEATMAP_CONFIG[heatKey];
  if (!cfg || heatKey === 'none' || !cfg.dataset) {
    features.forEach(f => {
      f.__fillColor = null;
      f.__label = `<b>${f.__name}</b>${f.__admin ? `<br><small>${f.__admin}</small>` : ''}`;
    });
    return;
  }
  
  const dataset = await loadDataset(cfg.dataset);
  let codeToGroup = {};
  let groupValueCache = {};
  
  // High-Performance Aggregation (Einmal berechnen, nicht pro Kachel)
  if (groupingMode) {
     const regions = await loadRegions();
     const groups = regions[groupingMode];
     if (groups) {
         Object.entries(groups).forEach(([groupId, g]) => {
             let total = 0, count = 0;
             g.members.forEach(m => {
                 const val = lookupValue(dataset, m, year);
                 if (val != null) { total += val; count++; }
                 codeToGroup[m] = groupId;
             });
             let finalVal = null;
             if (count > 0) {
                 finalVal = cfg.aggregate === 'average' ? (total / count) : total;
             }
             groupValueCache[groupId] = { value: finalVal, name: g.name };
         });
     }
  }

  // Zeichen-Schleife
  features.forEach(f => {
    const code = f.__kind === 'country' ? f.__iso3 : f.__iso31662;
    let v = null;
    let title = f.__name;
    let showAdmin = !!f.__admin;

    if (groupingMode) {
        if (f.__kind === 'state') {
            const groupId = codeToGroup[code];
            if (groupId) {
                v = groupValueCache[groupId].value;
                title = `${groupValueCache[groupId].name} (${f.__name})`;
                showAdmin = false;
            } else {
                f.__fillColor = 'rgba(30,30,30,0.15)'; // Ausgrauen
                f.__label = `<b>${f.__name}</b><br><small>Keine Zuordnung</small>`;
                return;
            }
        } else {
            f.__fillColor = 'rgba(10,10,10,0.2)'; // Länder im HG abdunkeln
            f.__label = `<b>${f.__name}</b>`;
            return;
        }
    } else {
        v = lookupValue(dataset, code, year);
    }

    f.__fillColor = colorScale(v, cfg.vmin, cfg.vmax);
    const valTxt = v != null ? Math.round(v).toLocaleString('de-CH') + ' ' + cfg.unit : 'k. A.';
    f.__label = `<b>${title}</b>` + (showAdmin ? ` <small>(${f.__admin})</small>` : '') + `<br>${cfg.label} ${year}: ${valTxt}`;
  });
}