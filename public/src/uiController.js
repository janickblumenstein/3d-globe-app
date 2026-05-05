// uiController.js — UI-Bindings, Sidebar, Readout-Updates
//
// Eventbus-Pattern: main.js registriert Handler via .on('xxx', fn).
// Der Controller fragt UI-Werte über getter ab und aktualisiert das Readout-Panel.

import { fmt, haversineKm } from './utils/geo.js';
import { solarAltitude } from './utils/astronomy.js';

export class UIController {
  constructor(elements) {
    this.el = elements;
    this.handlers = {};
  }

  on(event, handler) { this.handlers[event] = handler; }
  fire(event, ...args) { this.handlers[event]?.(...args); }

  bindEvents() {
    const e = this.el;

    e.apply.addEventListener('click', () => this.fire('apply'));
    [e.lat, e.lon].forEach(inp => inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') this.fire('apply');
    }));

    e.geo.addEventListener('click', () => this.fire('geolocate'));
    e.copy.addEventListener('click', () => this.fire('share'));
    e.reset.addEventListener('click', () => this.fire('reset'));

    e.searchBtn.addEventListener('click', () => this.fire('search'));
    e.search.addEventListener('keydown', ev => { if (ev.key === 'Enter') this.fire('search'); });

    e.spinBtn.addEventListener('click', () => this.fire('toggleSpin'));
    e.distBtn.addEventListener('click', () => this.fire('toggleDist'));

    [e.antipode, e.sunMoon].forEach(el => el.addEventListener('change', () => this.fire('togglePoints')));
    e.rings.addEventListener('change', () => this.fire('toggleRings'));
    e.dayNight.addEventListener('change', () => this.fire('toggleDayNight'));
    e.iss.addEventListener('change', () => this.fire('toggleIss'));
    e.wx.addEventListener('change', () => this.fire('toggleWeather'));

    e.basemap.addEventListener('change', () => this.fire('basemap'));
    e.borders.addEventListener('change', () => this.fire('borders'));
    e.heat.addEventListener('change', () => this.fire('heatChange'));

    // Year-Slider — input statt change für live updates
    e.year.addEventListener('input', () => {
      e.yearLabel.textContent = e.year.value;
      this.fire('yearChange');
    });
  }

  // ----- Getter -----
  getLatLon()        { return { lat: parseFloat(this.el.lat.value), lon: parseFloat(this.el.lon.value) }; }
  getYear()          { return parseInt(this.el.year.value, 10); }
  getSearchQuery()   { return this.el.search.value.trim(); }
  isFollow()         { return this.el.follow.checked; }
  isClickSet()       { return this.el.clickSet.checked; }
  isAntipode()       { return this.el.antipode.checked; }
  isRings()          { return this.el.rings.checked; }
  isDayNight()       { return this.el.dayNight.checked; }
  isSunMoon()        { return this.el.sunMoon.checked; }
  isIss()            { return this.el.iss.checked; }
  isWeather()        { return this.el.wx.checked; }
  getBasemap()       { return this.el.basemap.value; }
  getBorders()       { return this.el.borders.value; }
  getHeat()          { return this.el.heat.value; }

  // ----- Setter -----
  setLatLon(lat, lon, decimals = 4) {
    this.el.lat.value = Number(lat).toFixed(decimals);
    this.el.lon.value = Number(lon).toFixed(decimals);
  }
  setSpinActive(on) { this.el.spinBtn.classList.toggle('active', on); }
  setDistActive(on) { this.el.distBtn.classList.toggle('active', on); }
  setCopyText(t)    { this.el.copy.textContent = t; }

  // ----- Readout -----
  updateReadout({ centerLat, centerLon, sunMoon, iss, wx, dist, year, heatLabel }) {
    const parts = [];
    parts.push(`<b>Zentrum:</b> ${fmt(centerLat, 3)}, ${fmt(centerLon, 3)}`);
    if (heatLabel) parts.push(`<b>Heatmap:</b> ${heatLabel} (${year})`);

    if (sunMoon) {
      const alt = solarAltitude(centerLat, centerLon);
      const tag = alt > 0 ? '☀ Tag' : (alt > -6 ? '🌅 Dämmerung' : '🌙 Nacht');
      parts.push(`<b>Sonne:</b> ${alt.toFixed(1)}° (${tag})`);
    }
    if (iss?.pos) {
      const d = haversineKm({ lat: centerLat, lon: centerLon }, { lat: iss.pos.lat, lon: iss.pos.lon });
      parts.push(`<b>ISS:</b> ${fmt(iss.pos.lat, 2)}, ${fmt(iss.pos.lon, 2)} • ${d.toFixed(0)} km`);
    }
    if (wx?.data) {
      const d = wx.data;
      const code = wx.codeMap[d.weather_code] || `Code ${d.weather_code}`;
      parts.push(`<b>Wetter:</b> ${d.temperature_2m}°C, ${code}<div class="wxgrid">
        <span>Feuchte</span><span>${d.relative_humidity_2m}%</span>
        <span>Wind</span><span>${d.wind_speed_10m} km/h ${d.wind_direction_10m}°</span>
        <span>Wolken</span><span>${d.cloud_cover}%</span></div>`);
    }
    if (dist) {
      if (!dist.a)       parts.push('<i>Distanz: ersten Punkt klicken</i>');
      else if (!dist.b)  parts.push('<i>Distanz: zweiten Punkt klicken</i>');
      else               parts.push(`<b>Distanz:</b> ${haversineKm(dist.a, dist.b).toFixed(1)} km`);
    }
    this.el.readout.innerHTML = parts.join('<br>');
  }
}
