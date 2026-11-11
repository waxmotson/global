// Builds data/admin1.js from Natural Earth's 10m admin-1 layer.
//
// Natural Earth ships second-level units for a handful of countries (French
// departments, Italian provinces, UK districts, ...). Those are dissolved up to
// their real first-level units here so the game is admin-1 everywhere.
//
//   npm install && npm run build:data

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geoCentroid, geoContains, geoDistance } from "d3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, ".cache");
const SRC = join(cache, "ne_10m_admin_1_states_provinces.geojson");
const URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";

mkdirSync(cache, { recursive: true });
if (!existsSync(SRC)) {
  console.log("Downloading Natural Earth admin-1…");
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  writeFileSync(SRC, Buffer.from(await res.arrayBuffer()));
}

// --- configuration ---------------------------------------------------------

// Territories that are not administrative subdivisions of anything.
const DROP = new Set(["ATA", "USG", "KAS", "CSI", "ATC", "CLP", "PGA", "HMD"]);

// Countries whose Natural Earth units are below first level: dissolve by `field`.
const DISSOLVE = {
  FRA: { field: "region", type: "Region" },
  ITA: { field: "region", type: "Region" },
  ESP: { field: "region", type: "Autonomous Community" },
  PHL: { field: "region", type: "Region" },
  GBR: { field: "geonunit", type: "Country" },
  BEL: { field: "geonunit", type: "Region" },
  BIH: { field: "geonunit", type: "Entity" },
  SVN: { field: "region", type: "Statistical Region" },
  LVA: { field: "region", type: "Planning Region" },
  MKD: { field: "region", type: "Statistical Region" },
  UGA: { field: "region", type: "Region" },
  BFA: { field: "region", type: "Region" },
  MLT: { field: "region", type: "Region" },
  KOS: { field: "region", type: "District" },
  GIN: { field: "region", type: "Region" },
  MWI: { field: "region", type: "Region" },
};

// Merge source group names that are really the same unit.
const GROUP_FIX = { MKD: { "Greater Skopje": "Skopje" } };

// Display name (first) and extra accepted spellings for dissolved units.
const NAMES = {
  FRA: {
    "Guyane française": ["French Guiana", "Guyane"],
    Bretagne: ["Brittany"],
    Normandie: ["Normandy"],
    Corse: ["Corsica"],
    Occitanie: ["Occitania"],
    "Bourgogne-Franche-Comté": ["Bourgogne-Franche-Comté", "Burgundy-Franche-Comté"],
    "Provence-Alpes-Côte-d'Azur": ["Provence-Alpes-Côte d'Azur", "PACA"],
    "Île-de-France": ["Île-de-France", "Paris Region"],
  },
  ITA: {
    "Valle d'Aosta": ["Aosta Valley"],
    Piemonte: ["Piedmont"],
    Lombardia: ["Lombardy"],
    "Trentino-Alto Adige": ["Trentino-South Tyrol", "Trentino-Alto Adige/Südtirol"],
    Toscana: ["Tuscany"],
    Sardegna: ["Sardinia"],
    Apulia: ["Apulia", "Puglia"],
    Sicily: ["Sicily", "Sicilia"],
    Lazio: ["Lazio", "Latium"],
  },
  ESP: {
    "Foral de Navarra": ["Navarre", "Navarra"],
    "País Vasco": ["Basque Country", "Euskadi"],
    Aragón: ["Aragon"],
    Cataluña: ["Catalonia", "Catalunya"],
    Andalucía: ["Andalusia"],
    "Castilla y León": ["Castile and León"],
    "Castilla-La Mancha": ["Castilla-La Mancha", "Castile-La Mancha"],
    Valenciana: ["Valencian Community", "Valencia", "Comunidad Valenciana"],
    Murcia: ["Region of Murcia", "Murcia"],
    Asturias: ["Asturias", "Principality of Asturias"],
    "Canary Is.": ["Canary Islands", "Canarias"],
    "Islas Baleares": ["Balearic Islands", "Illes Balears"],
    Madrid: ["Community of Madrid", "Madrid"],
  },
  PHL: {
    "Autonomous Region in Muslim Mindanao (ARMM)": ["Bangsamoro", "BARMM", "ARMM", "Autonomous Region in Muslim Mindanao"],
    "Davao (Region XI)": ["Davao Region"],
    "Zamboanga Peninsula (Region IX)": ["Zamboanga Peninsula"],
    "MIMAROPA (Region IV-B)": ["Mimaropa"],
    "Dinagat Islands (Region XIII)": ["Caraga"],
    "Northern Mindanao (Region X)": ["Northern Mindanao"],
    "SOCCSKSARGEN (Region XII)": ["Soccsksargen"],
    "Eastern Visayas (Region VIII)": ["Eastern Visayas"],
    "Central Luzon (Region III)": ["Central Luzon"],
    "CALABARZON (Region IV-A)": ["Calabarzon"],
    "Bicol (Region V)": ["Bicol Region", "Bicol"],
    "National Capital Region": ["Metro Manila", "National Capital Region", "NCR"],
    "Ilocos (Region I)": ["Ilocos Region", "Ilocos"],
    "Cagayan Valley (Region II)": ["Cagayan Valley"],
    "Central Visayas (Region VII)": ["Central Visayas"],
    "Western Visayas (Region VI)": ["Western Visayas"],
    "Cordillera Administrative Region (CAR)": ["Cordillera Administrative Region", "CAR", "Cordillera"],
  },
  BEL: {
    "Flemish Region": ["Flanders", "Flemish Region", "Vlaanderen"],
    "Walloon Region": ["Wallonia", "Walloon Region", "Wallonie"],
    "Brussels Capital Region": ["Brussels", "Brussels-Capital Region"],
  },
  BIH: {
    "Bosnia and Herzegovina": ["Federation of Bosnia and Herzegovina", "FBiH"],
    "Republic Srpska": ["Republika Srpska", "Republic of Srpska"],
  },
  MLT: {
    "Malta Xlokk": ["South Eastern Malta", "Malta Xlokk"],
    "Malta Majjistral": ["North Western Malta", "Malta Majjistral"],
  },
  UGA: {
    Western: ["Western Region"],
    Central: ["Central Region"],
    Eastern: ["Eastern Region"],
    Northern: ["Northern Region"],
  },
  MWI: {
    Northern: ["Northern Region"],
    Central: ["Central Region"],
    Southern: ["Southern Region"],
  },
};

// Fixes for wrong or ambiguous English names in the source.
const RENAME = {
  "USA-3556": "District of Columbia",
  "RUS-2399": "Altai Krai",
  "RUS-2364": "Moscow Oblast",
  "RUS-2365": "Moscow",
  "UKR-321": "Kyiv Oblast",
  "UKR-4826": "Kyiv",
};

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
  "Republic of the Congo": "Republic of the Congo",
};

// --- helpers ---------------------------------------------------------------

const norm = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tidy = (s) => (s || "").replace(/\s+/g, " ").replace(/[\s\-–,]+$/, "").trim();

const outerOnly = (geometry) =>
  geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: [geometry.coordinates[0]] }
    : { type: "MultiPolygon", coordinates: geometry.coordinates.map((p) => [p[0]]) };

// --- prepare features ------------------------------------------------------

const source = JSON.parse(readFileSync(SRC, "utf8"));
// Baikonur is Kazakh land leased to Russia. Natural Earth cuts it out of
// Kyzylorda Region as a separate unit; fold it back in so the map has no hole.
const kyzylorda = source.features.find((f) => f.properties.adm1_code === "KAZ-3197");
for (const f of source.features) {
  if (f.properties.adm0_a3 === "KAB" && kyzylorda) f.properties = { ...kyzylorda.properties };
}

let features = source.features.filter((f) => {
  const p = f.properties;
  return f.geometry && p.name && !DROP.has(p.adm0_a3);
});

const byCountry = new Map();
for (const f of features) {
  const a3 = f.properties.adm0_a3;
  if (!byCountry.has(a3)) byCountry.set(a3, []);
  byCountry.get(a3).push(f);
}

// Hungary: "urban counties" are cities with county rights sitting inside a
// county. Fold each into the county that surrounds it.
const absorbed = new Map(); // feature -> host feature
{
  const hun = byCountry.get("HUN") || [];
  const hosts = hun.filter((f) => f.properties.type_en === "County");
  const shells = hosts.map((h) => outerOnly(h.geometry));
  for (const f of hun) {
    if (f.properties.type_en !== "Urban county") continue;
    const c = geoCentroid(f);
    let host = hosts[shells.findIndex((s) => geoContains(s, c))];
    if (!host) host = hosts.reduce((a, b) => (geoDistance(geoCentroid(a), c) < geoDistance(geoCentroid(b), c) ? a : b));
    absorbed.set(f, host);
  }
}

const meta = new Map(); // key -> {n, c, t, a:Set}
for (const [a3, list] of byCountry) {
  const rule = DISSOLVE[a3];
  // Units with no group value take the group of their nearest grouped sibling.
  if (rule) {
    const grouped = list.filter((f) => f.properties[rule.field]);
    for (const f of list) {
      if (f.properties[rule.field]) continue;
      const c = geoCentroid(f);
      const near = grouped.reduce((a, b) => (geoDistance(geoCentroid(a), c) < geoDistance(geoCentroid(b), c) ? a : b));
      f.properties[rule.field] = near.properties[rule.field];
    }
  }
  for (const f of list) {
    const p = f.properties;
    const country = COUNTRY[p.admin] || p.admin;
    let key, entry;
    if (rule) {
      let group = p[rule.field];
      group = GROUP_FIX[a3]?.[group] || group;
      key = `${a3}:${group}`;
      const names = NAMES[a3]?.[group] || [group];
      const type = a3 === "ESP" && /^(Ceuta|Melilla)$/.test(group) ? "Autonomous City" : rule.type;
      entry = { n: names[0], c: country, t: type, a: new Set([...names.slice(1), group]) };
    } else {
      const host = absorbed.get(f);
      const q = (host || f).properties;
      key = q.adm1_code;
      const alts = [q.name, ...(q.name_alt || "").split("|"), q.name_local, q.gn_name, q.woe_name];
      entry = {
        n: tidy(q.name_en) || tidy(q.name),
        raw: tidy(q.name),
        a3,
        c: country,
        t: tidy((q.type_en || "").split("|")[0]).replace("Captial", "Capital"),
        a: new Set(alts.map(tidy).filter(Boolean)),
      };
    }
    if (!meta.has(key)) meta.set(key, entry);
    f.key = key;
  }
}

// Natural Earth's English names are sometimes shared by two different units of
// one country (Kyiv city / Kyiv oblast, Washington / D.C.). Fall back to the
// native name, then to the unit type, and merge whatever is still identical.
const alias = new Map(); // key -> key it merges into
{
  const clash = (get) => {
    const groups = new Map();
    for (const [key, m] of meta) {
      if (!m.raw || alias.has(key)) continue;
      const id = m.a3 + "|" + norm(get(m));
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push([key, m]);
    }
    return [...groups.values()].filter((g) => g.length > 1);
  };
  for (const [key, name] of Object.entries(RENAME)) if (meta.has(key)) meta.get(key).n = name;
  for (const group of clash((m) => m.n)) {
    const typed = new Set(group.map(([, m]) => m.t)).size === group.length;
    for (const [, m] of group) m.n = typed ? `${m.n} (${m.t})` : m.raw;
  }
  for (const group of clash((m) => m.n)) for (const [, m] of group) if (m.t) m.n = `${m.raw} (${m.t})`;
  for (const group of clash((m) => m.n)) {
    group[0][1].n = group[0][1].raw;
    for (const [key] of group.slice(1)) alias.set(key, group[0][0]);
  }
  for (const f of features) f.properties = { k: alias.get(f.key) || f.key };
  for (const key of alias.keys()) meta.delete(key);
}

for (const m of meta.values()) {
  const seen = new Set([norm(m.n)]);
  m.a = [...m.a].filter((s) => {
    const k = norm(s);
    if (k.length < 3 || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
}

// --- geometry: dissolve + simplify with mapshaper --------------------------

const tmpIn = join(cache, "prepared.geojson");
const tmpOut = join(cache, "admin1.topo.json");
writeFileSync(tmpIn, JSON.stringify({ type: "FeatureCollection", features }));

const require = createRequire(import.meta.url);
const mapshaper = require.resolve("mapshaper/bin/mapshaper");
execFileSync(
  process.execPath,
  [
    "--max-old-space-size=8000",
    mapshaper,
    tmpIn,
    "-dissolve", "k",
    "-simplify", "weighted", process.env.SIMPLIFY || "7%", "keep-shapes",
    "-clean",
    "-rename-layers", "admin1",
    "-o", "format=topojson", "quantization=100000", tmpOut,
  ],
  { stdio: "inherit" }
);

const topo = JSON.parse(readFileSync(tmpOut, "utf8"));
const geoms = topo.objects.admin1.geometries.filter((g) => g.type && meta.has(g.properties.k));
geoms.sort((a, b) => (a.properties.k < b.properties.k ? -1 : 1));
for (const g of geoms) {
  const m = meta.get(g.properties.k);
  g.id = g.properties.k;
  g.properties = { n: m.n, c: m.c };
  if (m.t) g.properties.t = m.t;
  if (m.a.length) g.properties.a = m.a;
}
topo.objects.admin1.geometries = geoms;

mkdirSync(join(root, "data"), { recursive: true });
const out = join(root, "data", "admin1.js");
writeFileSync(out, `window.ADMIN1_TOPOLOGY=${JSON.stringify(topo)};\n`);

const countries = new Set(geoms.map((g) => g.properties.c));
console.log(`\n${geoms.length} subdivisions in ${countries.size} countries/territories`);
console.log(`${out}: ${(readFileSync(out).length / 1e6).toFixed(2)} MB`);
