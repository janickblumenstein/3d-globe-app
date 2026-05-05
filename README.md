# 3D Globe — Interactive Data Visualization

Refactor des Globus-Prototyps zu einer modularen Vite-Anwendung mit historischer Daten-Visualisierung (1990–2030) auf Länder- und Subnational-Ebene.

## Quickstart

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview  # statische Vorschau
```

## Ordnerstruktur

```
3d-globe-app/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── data/
│       ├── popDensity.json
│       ├── gdp_nominal.json
│       ├── gdp_ppp.json
│       └── gdp_ppp_per_capita.json
└── src/
    ├── main.js              ← Initialisierung, App-State, externe APIs
    ├── style.css
    ├── globeRenderer.js     ← globe.gl/three.js, Shader, Guides, Basemaps
    ├── dataManager.js       ← GeoJSON + Statistik-Loader, Year-Lookup, Color-Scale
    ├── uiController.js      ← UI-Events, Readout-Panel
    └── utils/
        ├── geo.js           ← haversine, destination, wrapLon, …
        └── astronomy.js     ← Sub-solar/-lunar, Solar-Altitude
```

## Architektur

Drei Schichten + ein Bus:

| Modul | Aufgabe |
|---|---|
| `globeRenderer.js` | Alles, was direkt mit three.js / globe.gl spricht. Klasse `GlobeRenderer` mit Setter-API (`setPolygons`, `setPoints`, `setArcs`, `setBasemap`, `setDayNight`, …). Kein Zugriff auf DOM-Inputs. |
| `dataManager.js` | Async-Loader für GeoJSON & Statistik-Datasets, `lookupValue()` mit linearer Interpolation, `applyHeatToFeatures()` als zentrale Pipeline. Kein Zugriff auf den Globe. |
| `uiController.js` | Liest UI-Werte, feuert benannte Events (`yearChange`, `heatChange`, …), aktualisiert das Readout-Panel. Kein Daten- oder Render-Wissen. |
| `main.js` | Verdrahtet alles und hält den App-State (Center, ISS, Wetter, Distanzmessung). |

## Heatmap-Pipeline

```
Year-Slider input
  → ui.fire('yearChange')
    → main.refreshPolygons()
      → loadCountries() / loadStates()           [dataManager]
      → applyHeatToFeatures(features, key, year) [dataManager]
        → loadDataset(key)
        → lookupValue(dataset, isoCode, year)    ← lineare Interpolation
        → colorScale(value, vmin, vmax)          ← log-Skala, viridis-like
      → renderer.setPolygons(features)           [globeRenderer]
```

## Datenformat

```json
{
  "CHE":   { "1990": 245, "2000": 260, "2010": 600, "2020": 752, "2030": 950 },
  "CH-ZH": { "1990":  60, "2000":  80, "2010": 130, "2020": 175, "2030": 230 }
}
```

- Länder: ISO 3166-1 alpha-3 (`CHE`, `DEU`, `USA`)
- Subnational: ISO 3166-2 (`CH-ZH`, `DE-BY`, `US-CA`)
- Stützjahre 1990/2000/2010/2020/2030 — Zwischenjahre werden linear interpoliert (Slider step=10 trifft aber immer eine Stützstelle)

### Eigene Datasets ergänzen

1. JSON-Datei in `public/data/` ablegen
2. URL in `dataManager.js` → `DATASET_URLS` registrieren
3. Eintrag in `HEATMAP_CONFIG` hinzufügen (`vmin`/`vmax` definieren die Log-Skala)
4. `<option>` in `index.html` → `#heatSel` ergänzen

## Erhaltene Features

- Tag/Nacht-Terminator (GLSL-Shader auf Sphere ums Globe)
- ISS-Tracker (`api.wheretheiss.at`, 5 s Polling, Trail aus letzten 60 Punkten)
- Open-Meteo Wetter-Integration
- Click-to-Center, Distanzmessung (Haversine), Distanzringe 500/1000/2500/5000 km
- Nominatim-Suche
- Antipodenpunkt
- Sub-solar / Sub-lunar Punkte
- 3 Basemaps inkl. Höhenkarten-Compositing im Canvas
- URL-Hash-State für Teilbarkeit
- Z-Fighting-Fix: `polygonAltitude` Staaten 0.006 vs Länder 0.004

## Bekannte Einschränkungen

- 50m-Admin-1-Datensatz hat ~4 600 Polygone — Build/initial render etwas schwerer als bei 110m. Bei Performance-Problemen kann man `polygonsTransitionDuration(0)` setzen oder die Staaten erst on-demand laden.
- Nicht alle Natural-Earth-Features haben einen sauberen `iso_3166_2`-Code. Der Loader probiert `iso_3166_2` → `code_hasc` → `iso_a2 + postal` als Fallback.
