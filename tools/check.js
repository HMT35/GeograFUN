/* Verificare rapida a normalizarii client-side pe datele reale.
   Rulare: node tools/check.js
   Nu face parte din aplicatie. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/datasets.config.js'), 'utf8'), sandbox);
const CFG = sandbox.window.DatasetsConfig;

function slug(name) {
  return name.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

for (const id of CFG.ids()) {
  const cfg = CFG.datasets[id];
  const sourcePath = path.join(root, CFG.sources[cfg.source]);
  if (!fs.existsSync(sourcePath)) throw new Error(`Lipseste sursa pentru ${id}: ${sourcePath}`);
  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) throw new Error(`FeatureCollection invalid pentru ${id}`);
  for (const [i, f] of raw.features.entries()) {
    if (f && f.geometry && f.geometry.coordinates && !finiteCoordinates(f.geometry.coordinates)) throw new Error(`Coordonate invalide pentru ${id}, feature ${i}`);
  }

  const nameFields = cfg.nameField || ['name'];
  const fix = cfg.nameFix || {};
  const ex = new Set(cfg.exclude || []);
  if (cfg.associatedTerritories) {
    Object.values(cfg.associatedTerritories).flat().forEach(name => ex.add(name));
  }
  const inc = cfg.include ? new Set(cfg.include) : null;

  const names = [];
  let dropped = 0;
  const geomTypes = {};

  for (const f of raw.features) {
    if (!f || !f.geometry || !f.geometry.coordinates) { dropped++; continue; }
    const p = f.properties || {};
    let rn = null;
    for (const k of nameFields) {
      if (p[k] && String(p[k]).trim()) { rn = String(p[k]).trim(); break; }
    }
    if (!rn) { dropped++; continue; }
    if (inc && !inc.has(rn)) { dropped++; continue; }
    if (ex.has(rn)) { dropped++; continue; }
    const n = fix[rn] || rn;
    if (ex.has(n)) { dropped++; continue; }
    names.push(n);
    geomTypes[f.geometry.type] = (geomTypes[f.geometry.type] || 0) + 1;
  }

  const uniq = [...new Set(names.map(n => slug(n)))];
  if (!uniq.length) throw new Error(`Dataset gol dupa normalizare: ${id}`);
  console.log('\n=== %s ===', id);
  console.log('brute: %d | pastrate: %d | unice: %d | eliminate: %d',
    raw.features.length, names.length, uniq.length, dropped);
  console.log('geometrii:', geomTypes);
  console.log([...new Set(names)].sort((a, b) => a.localeCompare(b, 'ro')).join(', '));
}

function finiteCoordinates(value) {
  if (!Array.isArray(value)) return false;
  if (typeof value[0] === 'number') return value.length >= 2 && value.every(Number.isFinite);
  return value.length > 0 && value.every(finiteCoordinates);
}
