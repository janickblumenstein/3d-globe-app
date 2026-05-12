// globeRenderer.js — Kapselt alles rund um globe.gl & three.js
//
// Verantwortlichkeiten:
//   • Globe-Initialisierung & Konfiguration
//   • Polygone, Punkte, Bögen rendern (Setter-API)
//   • Custom-Layer für Lat/Lon-Guides + Distanzringe
//   • Tag/Nacht-Terminator als Shader-Sphere
//   • Basemap-Wechsel inkl. Höhenkarten-Blending im Canvas
//   • Klick-Handling, Spin, Reset

import * as THREE from 'three';
import Globe from 'globe.gl';
import { wrapLon, destination } from './utils/geo.js';
import { getSubSolarPoint } from './utils/astronomy.js';

// CDN-Texturen wie im Original
const TEX = {
  earthDark: 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-dark.jpg',
  earthBlue: 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg',
  topo:      'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png'
};

const MAX_DPR = 1.75;

export class GlobeRenderer {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.basemapJob = 0;
    this.terminatorMesh = null;
    this.showRings = true;

    this.globe = new Globe(containerEl)
      .backgroundColor('#0a0a0a')
      .showAtmosphere(true)
      .atmosphereColor('#88ccff')
      .atmosphereAltitude(0.2)
      .globeImageUrl(TEX.earthDark)
      .bumpImageUrl(TEX.topo)
      // Polygone (Länder + Staaten)
      .polygonsData([])
      .polygonCapColor(d => d.__fillColor || 'rgba(0,0,0,0)')
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(d => d.__kind === 'state'
        ? 'rgba(255,255,255,0.5)'
        : 'rgba(255,255,255,0.35)')
      // Z-Fighting-Fix: Staaten liegen MINIMAL über den Ländern
      .polygonAltitude(d => d.__kind === 'state' ? 0.006 : 0.004)
      .polygonLabel(d => d.__label || '')
      // Punkte
      .pointsData([])
      .pointAltitude(d => d.__alt ?? 0.02)
      .pointColor(d => d.__color || '#00e5ff')
      .pointRadius(d => d.__radius ?? 0.6)
      .pointLabel(d => d.__label || '')
      // Bögen
      .arcsData([])
      .arcColor(a => a.__color || '#7cff7c')
      .arcStroke(0.4)
      .arcAltitudeAutoScale(0.4)
      .arcLabel(a => a.__label || '')
      // Custom-Layer: Lat/Lon-Guides + Distanzringe rund um Center
      .customLayerData([])
      .customThreeObject(d => this._buildGuidesGroup(d.lat, d.lon))
      .customThreeObjectUpdate((obj, d) => {
        obj.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
        obj.clear();
        this._addGuidesToGroup(obj, d.lat, d.lon);
      });

    this.globe.width(window.innerWidth);
    this.globe.height(window.innerHeight);

    this.renderer = this.globe.renderer();
    this.camera = this.globe.camera();
    this.controls = this.globe.controls();
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = false;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 800;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

    window.addEventListener('resize', this._onResize.bind(this), { passive: true });

    // Lightweight tick — nur für Terminator
    requestAnimationFrame(this._tick.bind(this));
  }

  // ============================ Public API =====================================

  setPolygons(features) { this.globe.polygonsData(features); }
  setPoints(points)     { this.globe.pointsData(points);    }
  setArcs(arcs)         { this.globe.arcsData(arcs);        }

  /** Setzt Kamera + Guides auf neuen Mittelpunkt */
  setCenter(lat, lon, animate = true, altitude = 2.2) {
    this.refreshGuides(lat, lon);
    this.globe.pointOfView({ lat, lng: lon, altitude }, animate ? 1200 : 0);
  }

  /** Nur Guides aktualisieren, ohne Kamera zu bewegen */
  refreshGuides(lat, lon) {
    this.globe.customLayerData([{ id: 'guides', lat, lon }]);
  }

  setShowRings(show)    { this.showRings = !!show; }
  setSpin(on)           { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 0.4; }
  resetView()           { this.globe.pointOfView({ lat: 20, lng: 0, altitude: 3 }, 800); }

  onGlobeClick(handler) {
    // Beide Wege abdecken: Klick aufs Meer UND auf ein Polygon
    this.globe.onGlobeClick(({ lat, lng }) => handler(lat, lng));
    this.globe.onPolygonClick((_poly, _e, { lat, lng }) => handler(lat, lng));
  }

  // ============================ Guides =========================================

  _llToVec(lat, lon, alt = 0.0045) {
    const v = this.globe.getCoords(lat, lon, alt);
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  _buildGuidesGroup(lat, lon) {
    const g = new THREE.Group();
    g.renderOrder = 9999;
    this._addGuidesToGroup(g, lat, lon);
    return g;
  }

  _addGuidesToGroup(group, lat, lon) {
    group.add(this._makeLatCircle(lat, 0xff5252));
    if (Math.abs(lat) > 1e-6) group.add(this._makeLatCircle(-lat, 0xff5252));
    group.add(this._makeMeridian(lon, 0xffeb3b));
    group.add(this._makeMeridian(wrapLon(lon + 180), 0xffeb3b));
    if (this.showRings) {
      [500, 1000, 2500, 5000].forEach(km => {
        group.add(this._makeDistanceRing(lat, lon, km, 0x80deea));
      });
    }
  }

  _makeLatCircle(latDeg, color) {
    const segs = 361, pts = [];
    for (let i = 0; i < segs; i++) pts.push(this._llToVec(latDeg, -180 + (360 * i) / (segs - 1)));
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, depthTest: true, depthWrite: false })
    );
    line.raycast = () => {}; // kein Klick-Block
    return line;
  }

  _makeMeridian(lonDeg, color) {
    const segs = 181, pts = [];
    for (let i = 0; i < segs; i++) pts.push(this._llToVec(-90 + (180 * i) / (segs - 1), lonDeg));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, depthTest: true, depthWrite: false })
    );
    line.raycast = () => {};
    return line;
  }

  _makeDistanceRing(latDeg, lonDeg, radiusKm, color) {
    const segs = 128, pts = [];
    for (let i = 0; i <= segs; i++) {
      const p = destination(latDeg, lonDeg, (360 * i) / segs, radiusKm);
      pts.push(this._llToVec(p.lat, p.lon, 0.005));
    }
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: true, depthWrite: false })
    );
    line.raycast = () => {};
    return line;
  }

  // ============================ Basemap ========================================

  _loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  async _buildRelief({ colorUrl, shadeUrl, blend = 'overlay', shadeAlpha = 0.55, brighten = 1.10, contrast = 1.04 }) {
    const [c, s] = await Promise.all([this._loadImage(colorUrl), this._loadImage(shadeUrl)]);
    const w = c.naturalWidth, h = c.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.filter = `brightness(${brighten}) contrast(${contrast})`;
    ctx.drawImage(c, 0, 0, w, h);
    ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = shadeAlpha;
    ctx.drawImage(s, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1; ctx.filter = 'none';
    try { return cv.toDataURL('image/jpeg', 0.85); } catch { return colorUrl; }
  }

  async setBasemap(mode) {
    const job = ++this.basemapJob;
    if (mode === 'dark')      this.globe.globeImageUrl(TEX.earthDark).bumpImageUrl(TEX.topo);
    else if (mode === 'blue') this.globe.globeImageUrl(TEX.earthBlue).bumpImageUrl(TEX.topo);
    else if (mode === 'elev') {
      const blended = await this._buildRelief({ colorUrl: TEX.earthBlue, shadeUrl: TEX.topo });
      if (job !== this.basemapJob) return; // alte Anforderung verworfen
      this.globe.globeImageUrl(blended).bumpImageUrl(TEX.topo);
    }
  }

  // ============================ Day/Night ======================================

  _ensureTerminator() {
    if (this.terminatorMesh) return this.terminatorMesh;
    const R = (this.globe.getGlobeRadius?.() || 100) * 10;
    const geom = new THREE.SphereGeometry(R, 96, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 sunDir;
        varying vec3 vNormal;
        void main() {
          float c = dot(normalize(vNormal), normalize(sunDir));
          float night = smoothstep(0.1, -0.2, c);
          gl_FragColor = vec4(0.0, 0.0, 0.0, night * 0.85);
        }`,
      transparent: true, depthWrite: false, depthTest: false,side: THREE.FrontSide
    });
    this.terminatorMesh = new THREE.Mesh(geom, mat);
    this.terminatorMesh.renderOrder = 5000;
    this.globe.scene().add(this.terminatorMesh);
    return this.terminatorMesh;
  }

  setDayNight(on) {
    if (!on) {
      if (this.terminatorMesh) this.terminatorMesh.visible = false;
      return;
    }
    const m = this._ensureTerminator();
    m.visible = true;
    this._updateTerminator();
  }

  _updateTerminator() {
    if (!this.terminatorMesh || !this.terminatorMesh.visible) return;
    const sun = getSubSolarPoint();
    const v = this.globe.getCoords(sun.lat, sun.lon, 0);
    const dir = new THREE.Vector3(v.x, v.y, v.z).normalize();
    this.terminatorMesh.material.uniforms.sunDir.value.copy(dir);
  }

  // ============================ Internal =======================================

  _onResize() {
    this.globe.width(window.innerWidth);
    this.globe.height(window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  }

  _tick() {
    this._updateTerminator();
    requestAnimationFrame(this._tick.bind(this));
  }
}
