import { clamp } from './utils/geo.js';

const GEO_URLS = {
  countries: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
  // NEU: Die 10m-Auflösung enthält nun ALLE Kantone und Bundesstaaten weltweit (Europa, Asien, etc.)
  states: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
};

// Hier verbinden wir die Keys mit deinen echten JSON-Dateien im public-Ordner
const DATASET_URLS = {
  popDensity: '/data/popDensity.json',
  gdpNominal: '/data/gdp_nominal.json',
  gdpPpp: '/data/gdp_ppp.json',
  gdpPppPerCapita: '/data/gdp_ppp_per_capita.json'
};

export const HEATMAP_CONFIG = {
  none:            { label: '–',                  unit: '',       vmin: 0,   vmax: 1,      dataset: null, aggregate: 'sum' },
  popDensity:      { label: 'Bevölkerungsdichte', unit: 'p/km²',  vmin: 1,   vmax: 25000,  dataset: 'popDensity', aggregate: 'average' },
  gdpNominal:      { label: 'BIP (nominal)',      unit: 'Mrd USD',vmin: 1,   vmax: 30000,  dataset: 'gdpNominal', aggregate: 'sum' },
  gdpPpp:          { label: 'BIP (PPP)',          unit: 'Mrd USD',vmin: 1,   vmax: 45000,  dataset: 'gdpPpp',     aggregate: 'sum' },
  gdpPppPerCapita: { label: 'BIP PPP pro Kopf',   unit: 'USD',    vmin: 100, vmax: 150000, dataset: 'gdpPppPerCapita', aggregate: 'average' }
};

const cache = {
  countries: null,
  states: null,
  regions: null,
  datasets: {}
};

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed (${r.status}): ${url}`);
  return r.json();
}

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

export async function loadStates() {
  if (cache.states) return cache.states;
  try {
    // WICHTIG: Wir laden jetzt deine lokale, optimierte Datei!
    // Kein ständiger Download mehr und keine 14MB mehr.
    const g = await fetchJson('/data/states_optimized.geojson'); 

    cache.states = (g.features || []).map(f => {
      const p = f.properties || {};
      const isoExplicit = p.iso_3166_2 || p.ISO_3166_2 || '';
      const hasc = (p.code_hasc || p.CODE_HASC || '').replace('.', '-');
      const parent = (p.iso_a2 || p.ISO_A2 || p.adm0_a2 || '').toUpperCase();
      const postal = (p.postal || p.POSTAL || p.code || '').toUpperCase();
      const fallback = (parent && postal) ? `${parent}-${postal}` : '';
      const iso = (isoExplicit || hasc || fallback).toUpperCase();
      const countryIso3 = (p.adm0_a3 || p.ADM0_A3 || '').toUpperCase();

      return {
        ...f,
        __kind: 'state',
        __name: p.name || p.NAME || '',
        __admin: p.admin || p.ADMIN || '',
        __iso31662: iso,
        __countryIso3: countryIso3
      };
    });
  } catch (e) {
    console.warn('[dataManager] States load failed', e);
    cache.states = [];
  }
  return cache.states;
}

export async function loadRegions() {
  if (cache.regions) return cache.regions;
  try {
    cache.regions = await fetchJson('/data/regions.json');
  } catch (e) {
    cache.regions = {};
  }
  return cache.regions;
}

// DIE WICHTIGE FUNKTION, DIE GEFEHLT HAT
export async function loadDataset(datasetKey) {
  if (!datasetKey || !DATASET_URLS[datasetKey]) return null;
  if (cache.datasets[datasetKey]) return cache.datasets[datasetKey];
  try {
    const data = await fetchJson(DATASET_URLS[datasetKey]);
    cache.datasets[datasetKey] = data;
    return data;
  } catch (e) {
    console.error(`[dataManager] Dataset load failed: ${datasetKey}`, e);
    return null;
  }
}

// Helper für die main.js, damit sie den Namen der Metrik findet
export function getMetricMeta(key) {
  const cfg = HEATMAP_CONFIG[key];
  return cfg ? { name: cfg.label, unit: cfg.unit } : null;
}

export function lookupValue(dataset, datasetId, year) {
    if (!dataset || !dataset[datasetId]) return null;

    const series = dataset[datasetId];
    const y = Number(year);
    if (series[y] != null) return series[y];

    // Ignoriere _meta bei der Jahressuche
    const years = Object.keys(series).filter(k => k !== '_meta').map(Number).sort((a, b) => a - b);
    if (years.length === 0) return null;
    
    if (y <= years[0]) return series[years[0]];
    if (y >= years[years.length - 1]) return series[years[years.length - 1]];

    let lo = years[0], hi = years[years.length - 1];
    for (let i = 0; i < years.length - 1; i++) {
        if (years[i] <= y && years[i + 1] >= y) { lo = years[i]; hi = years[i + 1]; break; }
    }
    
    const valLo = series[lo];
    const valHi = series[hi];
    
    if(valLo == null || valHi == null) return null;

    const t = (y - lo) / (hi - lo);
    return valLo + (valHi - valLo) * t;
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
  
  // FALL 1: Heatmap ist "Aus" -> Zeige nur das leuchtende Netz der Grenzen!
  if (!cfg || heatKey === 'none' || !cfg.dataset) {
    features.forEach(f => {
      // NEU: Ein feines, transparentes Weiss, damit die Grenzen auf der dunklen Erde aufblitzen
      f.__fillColor = f.__kind === 'state' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)';
      f.__label = `<b>${f.__name}</b>${f.__admin ? `<br><small>${f.__admin}</small>` : ''}`;
    });
    return;
  }
  
  const dataset = await loadDataset(cfg.dataset);
  if (!dataset) return; 
  
  let codeToGroup = {};
  let groupValueCache = {};
  
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
                
                // NEU: Milichiges Weiss, falls die Region im JSON existiert, aber (noch) leer ist
                f.__fillColor = v != null ? colorScale(v, cfg.vmin, cfg.vmax) : 'rgba(255, 255, 255, 0.25)';
            } else {
                // NEU: Alle nicht-ausgewählten Kantone extrem dezent im Hintergrund halten
                f.__fillColor = 'rgba(255, 255, 255, 0.02)'; 
                f.__label = `<b>${f.__name}</b><br><small>Keine Zuordnung</small>`;
                return;
            }
        } else {
            f.__fillColor = 'rgba(255, 255, 255, 0.02)'; 
            f.__label = `<b>${f.__name}</b>`;
            return;
        }
    } else {
        v = lookupValue(dataset, code, year);
        
        // Vererbung vom Land
        if (v == null && f.__kind === 'state' && f.__countryIso3) {
            v = lookupValue(dataset, f.__countryIso3, year);
        }

        f.__fillColor = colorScale(v, cfg.vmin, cfg.vmax);
        
        // NEU: Leuchtend weisses Gitternetz für Staaten, die absolut keine Daten haben
        if (v == null) {
            f.__fillColor = 'rgba(255, 255, 255, 0.08)';
        }
    }

    const valTxt = v != null ? Math.round(v).toLocaleString('de-CH') + ' ' + cfg.unit : 'k. A.';
    f.__label = `<b>${title}</b>` + (showAdmin ? ` <small>(${f.__admin})</small>` : '') + `<br>${cfg.label} ${year}: ${valTxt}`;
  });
}