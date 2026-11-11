// Builds data/grid-facts.js — the per-subdivision facts behind the grid game's
// categories (continent, coastline, area, capital, …). It reads the already
// built data/admin1.js, so run `npm run build:data` first if that is missing.
//
//   npm run build:grid

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoBounds, geoDistance } from "d3";
import { feature, neighbors as topoNeighbors } from "topojson-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, ".cache");
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const EARTH_KM = 6371;

async function load(name) {
  mkdirSync(cache, { recursive: true });
  const file = join(cache, name);
  if (!existsSync(file)) {
    console.log(`Downloading ${name}…`);
    const res = await fetch(NE + name);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${name}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

const countries = await load("ne_50m_admin_0_countries.geojson");
const places = await load("ne_10m_populated_places_simple.geojson");
const source = await load("ne_10m_admin_1_states_provinces.geojson");

const topo = JSON.parse(
  readFileSync(join(root, "data", "admin1.js"), "utf8").replace(/^window\.ADMIN1_TOPOLOGY=/, "").replace(/;\s*$/, "")
);
const layer = topo.objects.admin1;
const geoms = layer.geometries;

// --- country facts ---------------------------------------------------------

// Same renames as build-data.mjs, so names line up with data/admin1.js.
const COUNTRY = {
  "United States of America": "United States",
  "United Republic of Tanzania": "Tanzania",
  Macedonia: "North Macedonia",
  Swaziland: "Eswatini",
  "Republic of Serbia": "Serbia",
  "The Bahamas": "Bahamas",
  "East Timor": "Timor-Leste",
  "Czech Republic": "Czechia",
  "Republic of Congo": "Republic of the Congo",
};

const a3Of = new Map(); // display country -> adm0_a3
for (const f of source.features) {
  const p = f.properties;
  if (p.admin) a3Of.set(COUNTRY[p.admin] || p.admin, p.adm0_a3);
}

const CONTINENTS = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"];
// Territories missing from (or filed under "Seven seas" in) the 50m country layer.
const CONTINENT_FIX = {
  "French Southern and Antarctic Lands": "Africa",
  "British Indian Ocean Territory": "Asia",
  "Indian Ocean Territories": "Asia",
  "South Georgia and the Islands": "South America",
  "Saint Helena": "Africa",
  Seychelles: "Africa",
  Mauritius: "Africa",
  Maldives: "Asia",
  "United States Minor Outlying Islands": "Oceania",
  "Caribbean Netherlands": "North America",
  "Dhekelia Sovereign Base Area": "Asia",
  "Akrotiri Sovereign Base Area": "Asia",
  "Northern Cyprus": "Asia",
  "Gaza Strip": "Asia",
  "West Bank": "Asia",
  Somaliland: "Africa",
  Kosovo: "Europe",
  Gibraltar: "Europe",
  Tuvalu: "Oceania",
  "Clipperton Island": "North America",
};

const adm0 = new Map(countries.features.map((f) => [f.properties.ADM0_A3, f.properties]));
const countryNames = [...new Set(geoms.map((g) => g.properties.c))].sort();
const countryFacts = {};
for (const name of countryNames) {
  const p = adm0.get(a3Of.get(name));
  const continent = CONTINENT_FIX[name] || p?.CONTINENT;
  if (!CONTINENTS.includes(continent)) throw new Error(`No continent for ${name} (${continent})`);
  countryFacts[name] = { k: CONTINENTS.indexOf(continent), p: Math.round(p?.POP_EST || 0) };
}

// --- geometry facts --------------------------------------------------------

// Decode the quantised, delta-encoded arcs once.
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
});

const arcIds = (g) => {
  const out = [];
  const walk = (a) => (Array.isArray(a) ? a.forEach(walk) : out.push(a < 0 ? ~a : a));
  walk(g.arcs || []);
  return out;
};

const uses = new Int32Array(arcs.length);
const owned = geoms.map(arcIds);
for (const ids of owned) for (const id of new Set(ids)) uses[id]++;

// The Caspian is a lake: its shore is not a sea coast.
const inCaspian = ([lon, lat]) => lon > 46.4 && lon < 54.9 && lat > 36.4 && lat < 47.3;
const arcKm = (arc) => {
  let d = 0;
  for (let i = 1; i < arc.length; i++) d += geoDistance(arc[i - 1], arc[i]);
  return d * EARTH_KM;
};

const adjacency = topoNeighbors(geoms);
const features = geoms.map((g) => feature(topo, g));

const rings = (f) => (f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat());
// Planar even-odd test: winding-agnostic, and no capital sits on the antimeridian.
function contains(f, [x, y]) {
  let inside = false;
  for (const ring of rings(f)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const facts = geoms.map((g, i) => {
  const f = features[i];
  let sr = geoArea(f);
  if (sr > 2 * Math.PI) sr = 4 * Math.PI - sr;
  let south = 90, north = -90;
  for (const ring of rings(f)) for (const [, lat] of ring) { if (lat < south) south = lat; if (lat > north) north = lat; }
  let coast = 0;
  for (const id of new Set(owned[i])) {
    if (uses[id] !== 1) continue;
    const arc = arcs[id];
    if (arc.every(inCaspian)) continue;
    coast += arcKm(arc);
  }
  const land = adjacency[i];
  return {
    i,
    country: g.properties.c,
    area: sr * EARTH_KM * EARTH_KM,
    south,
    north,
    coast,
    neighbors: land.length,
    foreign: land.some((j) => geoms[j].properties.c !== g.properties.c),
    capital: false,
    bigCity: false,
    box: geoBounds(f),
  };
});

// Unshared border that is not sea: territories dropped from the dataset
// (Siachen, Baikonur) and tidal rivers.
const NOT_COASTAL = new Set([
  "Ladakh|India", "Gilgit-Baltistan|Pakistan", "Xinjiang|China", "Kyzylorda|Kazakhstan",
  "Pennsylvania|United States", "District of Columbia|United States",
  "Dhaka|Bangladesh", "Vatican City|Vatican",
]);
// A sliver of unshared border is a data seam, not a coastline.
for (const f of facts) {
  f.coastal = f.coast > Math.max(0.3, Math.sqrt(f.area) * 0.04) && !NOT_COASTAL.has(`${geoms[f.i].properties.n}|${f.country}`);
}

// --- cities ----------------------------------------------------------------

const byCountry = new Map();
for (const f of facts) {
  if (!byCountry.has(f.country)) byCountry.set(f.country, []);
  byCountry.get(f.country).push(f);
}

function locate(point, list) {
  const hit = list.find((f) => contains(features[f.i], point));
  if (hit) return hit;
  // Tiny coastal city-units lose detail when simplified: fall back to the nearest boundary.
  let best = null, bestD = Infinity;
  for (const f of list) {
    for (const ring of rings(features[f.i])) {
      for (const pt of ring) {
        const d = geoDistance(pt, point);
        if (d < bestD) { bestD = d; best = f; }
      }
    }
  }
  return bestD * EARTH_KM < 25 ? best : null;
}

const PLACE_COUNTRY = { "South Sudan": "S. Sudan" };
let missedCapitals = [];
for (const place of places.features) {
  const p = place.properties;
  const isCapital = p.adm0cap === 1;
  const isBig = p.pop_max >= 1e6;
  if (!isCapital && !isBig) continue;
  const list = byCountry.get(PLACE_COUNTRY[p.adm0name] || COUNTRY[p.adm0name] || p.adm0name) || byCountry.get([...a3Of].find(([, a3]) => a3 === p.adm0_a3)?.[0]);
  const hit = list && locate(place.geometry.coordinates, list);
  if (!hit) { if (isCapital) missedCapitals.push(`${p.name} (${p.adm0name})`); continue; }
  if (isCapital) hit.capital = true;
  if (isBig) hit.bigCity = true;
}

// --- output ----------------------------------------------------------------

for (const [name, list] of byCountry) countryFacts[name].l = list.some((f) => f.coastal) ? 0 : 1;

const FLAG = { coastal: 1, foreign: 2, capital: 4, bigCity: 8 };
const rows = facts.map((f) => [
  Math.max(1, Math.round(f.area)),
  (f.coastal ? FLAG.coastal : 0) | (f.foreign ? FLAG.foreign : 0) | (f.capital ? FLAG.capital : 0) | (f.bigCity ? FLAG.bigCity : 0),
  f.neighbors,
  Math.round(f.south * 10) / 10,
  Math.round(f.north * 10) / 10,
]);

const out = join(root, "data", "grid-facts.js");
writeFileSync(
  out,
  `window.ADMIN1_FACTS=${JSON.stringify({
    ids: geoms.map((g) => g.id),
    cols: ["area", "flags", "neighbors", "south", "north"],
    flags: FLAG,
    rows,
    continents: CONTINENTS,
    countries: countryFacts,
  })};\n`
);

// --- report ----------------------------------------------------------------

const name = (f) => `${geoms[f.i].properties.n} [${f.country}]`;
const count = (fn) => facts.filter(fn).length;
console.log(`${facts.length} subdivisions`);
console.log(`coastal ${count((f) => f.coastal)}, borders another country ${count((f) => f.foreign)}, capitals ${count((f) => f.capital)}, 1M+ city ${count((f) => f.bigCity)}`);
console.log(`landlocked countries: ${Object.entries(countryFacts).filter(([, c]) => c.l).map(([n]) => n).join(", ")}`);
console.log(`capitals not placed: ${missedCapitals.join(", ") || "none"}`);
if (process.env.DEBUG) {
  const noCap = countryNames.filter((c) => !byCountry.get(c).some((f) => f.capital));
  console.log(`countries without a capital unit: ${noCap.join(", ")}`);
  console.log(`marginal coasts: ${facts.filter((f) => f.coast > 0 && f.coast < 80 && f.area > 3000).map((f) => `${name(f)} ${f.coast.toFixed(1)}km${f.coastal ? "" : " (ignored)"}`).join("; ")}`);
  for (const c of (process.env.DEBUG_COUNTRIES || "").split(",").filter(Boolean)) {
    console.log(`${c} coastal: ${byCountry.get(c).filter((f) => f.coastal).map((f) => `${geoms[f.i].properties.n} ${f.coast.toFixed(0)}`).join(", ")}`);
  }
}
console.log(`${out}: ${(readFileSync(out).length / 1e3).toFixed(0)} kB`);
