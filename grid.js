/* Hintergrid — a 3×3 category grid for first-level subdivisions. */
(() => {
  "use strict";

  const STORE_KEY = "hintergrid:v1";
  const GUESSES = 10;
  const MIN_ANSWERS = 3; // every square has at least this many valid answers
  const EPOCH = Date.UTC(2026, 10, 11); // daily grid #1

  // ------------------------------------------------------------------ data

  const topo = window.ADMIN1_TOPOLOGY;
  const facts = window.ADMIN1_FACTS;
  const layer = topo.objects.admin1;

  // Letters NFD does not decompose.
  const FOLD = { đ: "d", Đ: "D", ø: "o", Ø: "O", ł: "l", Ł: "L", ı: "i", ß: "ss", æ: "ae", Æ: "AE", œ: "oe", þ: "th", ð: "d", ə: "a", Ə: "A", ħ: "h", Ħ: "H" };
  const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐøØłŁıßæÆœþðəƏħĦ]/g, (c) => FOLD[c]);
  const norm = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const factRow = new Map(facts.ids.map((id, i) => [id, facts.rows[i]]));
  const unitCount = {};
  for (const g of layer.geometries) unitCount[g.properties.c] = (unitCount[g.properties.c] || 0) + 1;

  const regions = layer.geometries.map((g, i) => {
    const p = g.properties;
    const [area, flags, neighbors, south, north] = factRow.get(g.id) || [0, 0, 0, 0, 0];
    const country = facts.countries[p.c] || { k: -1, p: 0, l: 0 };
    const alts = p.a || [];
    const key = norm(p.n);
    const altKeys = alts.map(norm);
    const letters = plain(p.n).replace(/[^A-Za-z]/g, "").toUpperCase();
    return {
      i,
      id: g.id,
      name: p.n,
      country: p.c,
      type: p.t || "",
      alts,
      key,
      altKeys,
      hay: [key, ...altKeys].join(" | "),
      geom: g,
      letters,
      plainName: plain(p.n),
      area,
      neighbors,
      south,
      north,
      coastal: !!(flags & facts.flags.coastal),
      foreign: !!(flags & facts.flags.foreign),
      capital: !!(flags & facts.flags.capital),
      bigCity: !!(flags & facts.flags.bigCity),
      continent: country.k,
      countryPop: country.p,
      countryLandlocked: !!country.l,
      countryUnits: unitCount[p.c],
    };
  });
  const byId = new Map(regions.map((r) => [r.id, r]));

  // ------------------------------------------------------------ categories

  const FAMILIES = [
    { id: "country", kicker: "Country", weight: 3, max: 2 },
    { id: "continent", kicker: "Continent", weight: 1.2, max: 1 },
    { id: "type", kicker: "Type", weight: 1, max: 1 },
    { id: "name", kicker: "Name", weight: 2.4, max: 2 },
    { id: "geo", kicker: "Geography", weight: 3, max: 3 },
    { id: "city", kicker: "Cities", weight: 0.8, max: 1 },
    { id: "nation", kicker: "Its country", weight: 0.7, max: 1 },
  ];
  const familyOf = new Map(FAMILIES.map((f) => [f.id, f]));

  const cats = [];
  function add(family, id, label, desc, test, weight = 1) {
    const has = new Uint8Array(regions.length);
    let size = 0;
    for (const r of regions) if (test(r)) { has[r.i] = 1; size++; }
    if (size >= 12) cats.push({ id: `${family}:${id}`, family, kicker: familyOf.get(family).kicker, label, desc, has, size, weight });
  }

  for (const [name, c] of Object.entries(facts.countries)) {
    if (unitCount[name] < 9 || c.p < 2e6) continue;
    // Bigger countries come up more often.
    add("country", name, name, `In ${name}`, (r) => r.country === name, Math.min(3.2, 0.5 + Math.log10(c.p / 2e6)));
  }

  facts.continents.forEach((name, k) => add("continent", name, name, `In ${name}`, (r) => r.continent === k));

  for (const type of ["Province", "Region", "District", "State", "County", "Department", "Municipality", "Governorate", "Prefecture", "Parish"]) {
    add("type", type, type, `Officially a ${type.toLowerCase()}`, (r) => r.type === type);
  }

  const COMPASS = /\b((north|south)(east|west)?|east|west)(ern)?\b|\bcentral\b/i;
  for (const letter of "ABCDEGHKLMNOPRSTVW") {
    add("name", `starts-${letter}`, `Starts with ${letter}`, `Name starts with ${letter}`, (r) => r.letters[0] === letter, 0.25);
  }
  for (const letter of "AEINO") {
    add("name", `ends-${letter}`, `Ends with ${letter}`, `Name ends with ${letter}`, (r) => r.letters.at(-1) === letter, 0.4);
  }
  add("name", "short", "5 letters or fewer", "Name has 5 letters or fewer", (r) => r.letters.length <= 5);
  add("name", "long", "12+ letters", "Name has 12 or more letters", (r) => r.letters.length >= 12);
  add("name", "words", "Two or more words", "Name is two or more words", (r) => r.plainName.trim().split(/[\s-]+/).length >= 2);
  add("name", "compass", "Has a compass word", "Name includes North, South, East, West or Central", (r) => COMPASS.test(r.plainName));
  add("name", "has-z", "Contains a Z", "Name contains the letter Z", (r) => r.letters.includes("Z"), 0.6);
  add("name", "double", "Has a double letter", "Name has the same letter twice in a row", (r) => /([a-z])\1/i.test(r.plainName), 0.6);

  const km2 = (n) => n.toLocaleString("en-US");
  add("geo", "coast", "Sea coast", "Has a sea coast", (r) => r.coastal, 1.6);
  add("geo", "no-coast", "No sea coast", "Has no sea coast", (r) => !r.coastal, 1.4);
  add("geo", "foreign", "Borders another country", "Touches another country", (r) => r.foreign, 1.6);
  add("geo", "island", "No land borders", "Shares no land border with any other subdivision", (r) => r.neighbors === 0);
  add("geo", "neighbours", "7+ neighbours", "Touches 7 or more other subdivisions", (r) => r.neighbors >= 7);
  add("geo", "huge", `Over ${km2(100000)} km²`, `Larger than ${km2(100000)} km²`, (r) => r.area > 100000);
  add("geo", "large", `Over ${km2(25000)} km²`, `Larger than ${km2(25000)} km²`, (r) => r.area > 25000, 0.8);
  add("geo", "small", `Under ${km2(1000)} km²`, `Smaller than ${km2(1000)} km²`, (r) => r.area < 1000, 0.8);
  add("geo", "south", "South of the equator", "Lies entirely south of the equator", (r) => r.north < 0);
  add("geo", "equator", "On the equator", "The equator passes through it", (r) => r.south < 0 && r.north > 0, 0.7);
  add("geo", "tropics", "Within the tropics", "Lies entirely between the two tropics", (r) => r.south >= -23.44 && r.north <= 23.44);
  add("geo", "north60", "Reaches 60° N", "Extends north of 60° N", (r) => r.north > 60, 0.7);

  add("city", "capital", "National capital", "Contains its country's capital city", (r) => r.capital, 1.4);
  add("city", "million", "City of 1M+", "Contains a city of at least a million people", (r) => r.bigCity);

  add("nation", "landlocked", "Is landlocked", "In a landlocked country", (r) => r.countryLandlocked);
  add("nation", "populous", "Has 100M+ people", "In a country of over 100 million people", (r) => r.countryPop >= 1e8);
  add("nation", "many", "Has 40+ subdivisions", "In a country with 40 or more subdivisions", (r) => r.countryUnits >= 40, 0.6);

  const catById = new Map(cats.map((c) => [c.id, c]));
  const byFamily = new Map(FAMILIES.map((f) => [f.id, cats.filter((c) => c.family === f.id)]));

  function answersFor(row, col) {
    const out = [];
    for (const r of regions) if (row.has[r.i] && col.has[r.i]) out.push(r);
    return out;
  }

  // ---------------------------------------------------------- grid builder

  function hash(str) {
    let h = 2166136261;
    for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
    return h >>> 0;
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function weighted(list, rng) {
    let total = 0;
    for (const x of list) total += x.weight;
    let roll = rng() * total;
    for (const x of list) if ((roll -= x.weight) <= 0) return x;
    return list[list.length - 1];
  }

  function cellOk(row, col) {
    let n = 0;
    for (let i = 0; i < regions.length; i++) n += row.has[i] & col.has[i];
    // Enough answers, and neither rule makes the other one redundant.
    return n >= MIN_ANSWERS && n <= 0.9 * Math.min(row.size, col.size);
  }

  function shuffle(list, rng) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /**
   * Six categories — three rows, three columns — where every square is fair.
   * Countries are the hardest rules to pair up, so they are chosen first and
   * kept on one axis while the other five or four rules are searched for.
   */
  function generate(seed) {
    const rng = mulberry(hash(seed));
    const others = FAMILIES.filter((f) => f.id !== "country");
    for (let attempt = 0; attempt < 400; attempt++) {
      const roll = rng();
      const countries = [];
      for (let n = roll < 0.2 ? 0 : roll < 0.65 ? 1 : 2; n > 0; n--) {
        countries.push(weighted(byFamily.get("country").filter((c) => !countries.includes(c)), rng));
      }
      for (let inner = 0; inner < 300; inner++) {
        const picked = [];
        const used = {};
        while (picked.length < 6 - countries.length) {
          const family = weighted(others.filter((f) => (used[f.id] || 0) < f.max), rng);
          picked.push(weighted(byFamily.get(family.id).filter((c) => !picked.includes(c)), rng));
          used[family.id] = (used[family.id] || 0) + 1;
        }
        shuffle(picked, rng);
        let rows = shuffle([...countries, ...picked.slice(0, 3 - countries.length)], rng);
        let cols = picked.slice(3 - countries.length);
        if (!rows.every((r) => cols.every((c) => cellOk(r, c)))) continue;
        if (rng() < 0.5) [rows, cols] = [cols, rows];
        return { rows: rows.map((c) => c.id), cols: cols.map((c) => c.id) };
      }
    }
    throw new Error("Could not build a grid");
  }

  // The rules engine, exposed for the data sanity checks (which run without a DOM).
  window.HINTERGRID = { regions, cats, catById, generate, answersFor };
  if (typeof document === "undefined") return;

  // ------------------------------------------------------------- persistence

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { /* storage unavailable */ }
  const persist = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
  };
  saved.stats = saved.stats || { played: 0, total: 0, perfect: 0, streak: 0, last: null };
  saved.rooms = saved.rooms || {}; // challenge code -> my game on that board
  saved.pid = saved.pid || (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = dateKey();
  const dayNumber = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 864e5) + 1;
  };

  // The challenge-room Worker. `?server=` overrides grid-config.js, for local testing.
  const SERVER = (new URLSearchParams(location.search).get("server") || window.HINTERGRID_SERVER || "").replace(/\/+$/, "");
  const pageUrl = () => location.href.split("#")[0];

  // ------------------------------------------------------------- game state

  let mode = saved.mode === "practice" ? "practice" : saved.mode === "room" && saved.room ? "room" : "daily";
  let game = null;

  function freshBoard(board, seed, extra = {}) {
    return { seed, rows: [...board.rows], cols: [...board.cols], cells: Array(9).fill(null), wrong: Array.from({ length: 9 }, () => []), left: GUESSES, over: false, counted: false, ...extra };
  }
  const fresh = (seed) => freshBoard(generate(seed), seed);

  function validBoard(b) {
    return b && Array.isArray(b.rows) && Array.isArray(b.cols) && b.rows.length === 3 && b.cols.length === 3 &&
      [...b.rows, ...b.cols].every((id) => catById.has(id)) && new Set([...b.rows, ...b.cols]).size === 6;
  }
  function valid(g) {
    return validBoard(g) &&
      Array.isArray(g.cells) && g.cells.length === 9 && g.cells.every((id) => id === null || byId.has(id)) &&
      Array.isArray(g.wrong) && g.wrong.length === 9;
  }
  const sameBoard = (a, b) => a && b && a.rows.join("|") === b.rows.join("|") && a.cols.join("|") === b.cols.join("|");

  function loadMode() {
    if (mode === "room" && !valid(saved.rooms[saved.room])) mode = "practice";
    if (mode === "daily") {
      const seed = `hintergrid/${today}`;
      game = saved.daily && saved.daily.seed === seed && valid(saved.daily) ? saved.daily : fresh(seed);
      saved.daily = game;
    } else if (mode === "room") {
      game = saved.rooms[saved.room];
    } else {
      game = valid(saved.practice) ? saved.practice : fresh(`practice/${Date.now()}/${Math.random()}`);
      saved.practice = game;
    }
    saved.mode = mode;
    persist();
  }

  const rowCat = (k) => catById.get(game.rows[Math.floor(k / 3)]);
  const colCat = (k) => catById.get(game.cols[k % 3]);
  const score = () => game.cells.filter(Boolean).length;
  const placed = () => new Set(game.cells.filter(Boolean));

  function guess(k, region) {
    if (game.over || game.cells[k] || placed().has(region.id) || game.wrong[k].includes(region.id)) return;
    const row = rowCat(k), col = colCat(k);
    const missed = [row, col].filter((c) => !c.has[region.i]);
    game.left--;
    const who = `<b>${esc(region.name)}</b> (${esc(region.country)})`;
    if (!missed.length) {
      game.cells[k] = region.id;
      say(`${who} fits.`, "good");
    } else {
      game.wrong[k].push(region.id);
      say(`${who} misses: ${missed.map((c) => `<b>${esc(c.desc.toLowerCase())}</b>`).join(" and ")}.`, "bad");
    }
    if (score() === 9 || game.left === 0) finish();
    persist();
    if (mode === "room") sendState();
    render();
    animate(k, missed.length ? "shake" : "pop");
  }

  function finish() {
    game.over = true;
    if (mode === "daily" && !game.counted) {
      game.counted = true;
      const s = saved.stats;
      const yesterday = dateKey(new Date(Date.now() - 864e5));
      s.played++;
      s.total += score();
      if (score() === 9) s.perfect++;
      s.streak = s.last === yesterday || s.last === today ? s.streak + (s.last === today ? 0 : 1) : 1;
      s.last = today;
    }
  }

  // ---------------------------------------------------------------- render

  const board = $("board"), statusEl = $("status"), resultEl = $("result");

  function say(html, tone = "") {
    statusEl.innerHTML = html;
    statusEl.className = `status ${tone}`;
  }

  async function copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      say(done);
      return true;
    } catch {
      window.prompt("Copy this:", text);
      return false;
    }
  }

  const shapeCache = new Map();
  function shape(r) {
    if (shapeCache.has(r.id)) return shapeCache.get(r.id);
    let svg = "";
    try {
      const f = topojson.feature(topo, r.geom);
      const [lon, lat] = d3.geoCentroid(f);
      const projection = d3.geoAzimuthalEqualArea().rotate([-lon, -lat]).fitExtent([[4, 4], [96, 96]], f);
      const d = d3.geoPath(projection).digits(1)(f);
      if (d) svg = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;
    } catch { /* no outline — the name is enough */ }
    shapeCache.set(r.id, svg);
    return svg;
  }

  const headHtml = (c, axis) =>
    `<div class="head ${axis}" title="${esc(c.desc)}"><span class="kicker">${esc(c.kicker)}</span><span class="label">${esc(c.label)}</span></div>`;

  function render() {
    const rows = game.rows.map((id) => catById.get(id)), cols = game.cols.map((id) => catById.get(id));
    let html = `<div class="corner${!game.over && game.left <= 2 ? " low" : ""}">
      <b>${game.over ? `${score()}/9` : game.left}</b><span>${game.over ? "score" : game.left === 1 ? "guess left" : "guesses left"}</span></div>`;
    html += cols.map((c) => headHtml(c, "col")).join("");
    for (let y = 0; y < 3; y++) {
      html += headHtml(rows[y], "row");
      for (let x = 0; x < 3; x++) {
        const k = y * 3 + x;
        const where = `${rows[y].desc} and ${cols[x].desc.toLowerCase()}`;
        const r = game.cells[k] && byId.get(game.cells[k]);
        if (r) {
          html += `<button class="cell filled${game.over ? " clickable" : ""}" data-k="${k}" ${game.over ? "" : "disabled"}
            aria-label="${esc(`${r.name}, ${r.country}. ${where}`)}">${shape(r)}<span class="c-name">${esc(r.name)}</span><span class="c-sub">${esc(r.country)}</span></button>`;
        } else if (game.over) {
          const n = answersFor(rows[y], cols[x]).length;
          html += `<button class="cell empty clickable" data-k="${k}" aria-label="${esc(`Empty. ${where}. Show ${n} answers`)}"><b>${n}</b><span>answers</span></button>`;
        } else {
          const misses = game.wrong[k].length;
          html += `<button class="cell open" data-k="${k}" aria-label="${esc(`Empty square: ${where}`)}">${misses ? `<span class="misses">${misses} miss${misses > 1 ? "es" : ""}</span>` : ""}</button>`;
        }
      }
    }
    board.innerHTML = html;

    $("tab-room").hidden = !saved.room;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    $("subtitle").textContent =
      mode === "daily" ? `Daily grid #${dayNumber(today)} · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`
      : mode === "room" ? `Challenge ${saved.room} · everyone plays this same board`
      : game.custom ? "Custom board · practice"
      : "Practice grid · play as many as you like";
    $("giveup-btn").hidden = game.over;
    for (const id of ["new-btn", "custom-btn", "challenge-btn"]) $(id).hidden = mode !== "practice";
    renderResult();
    renderRoom();

    // Keep the address shareable: it always names the board on screen.
    const hash = mode === "room" ? `#room=${saved.room}` : mode === "practice" && game.custom ? `#board=${encodeBoard(game)}` : "";
    if (location.hash !== hash) history.replaceState(null, "", pageUrl() + hash);
  }

  function animate(k, cls) {
    const el = board.querySelector(`[data-k="${k}"]`);
    if (!el) return;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  }

  function untilMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(1, Math.round((next - now) / 6e4));
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  }

  function renderResult() {
    resultEl.hidden = !game.over;
    if (!game.over) return;
    const n = score();
    const used = GUESSES - game.left;
    const verdict = n === 9 ? "Perfect grid" : n >= 7 ? "So close" : n >= 4 ? "Solid effort" : "Tough grid";
    const s = saved.stats;
    const second =
      mode === "practice" ? '<button class="btn" id="again-btn">New grid</button>'
      : mode === "room" ? ""
      : '<button class="btn" id="practice-btn">Play practice</button>';
    resultEl.className = `result${n === 9 ? " perfect" : ""}`;
    resultEl.innerHTML = `
      <div class="kicker">${verdict}</div>
      <h3>${n} <small>of 9 squares · ${used} guess${used === 1 ? "" : "es"}</small></h3>
      <p class="line">${mode === "room" ? "Tap any square to see what fits it — and what everyone else answered." : "Tap any square to see every subdivision that fits it."}</p>
      ${mode === "daily" ? `<div class="stats">
        <div><b>${s.played}</b><span>Played</span></div>
        <div><b>${s.played ? (s.total / s.played).toFixed(1) : "–"}</b><span>Average</span></div>
        <div><b>${s.perfect}</b><span>Perfect</span></div>
        <div><b>${s.streak}</b><span>Streak</span></div>
      </div>` : ""}
      <div class="row"><button class="btn primary" id="share-btn">Share</button>${second}</div>
      ${mode === "daily" ? `<p class="next">Next daily grid in ${untilMidnight()}.</p>` : ""}`;
  }

  function shareText() {
    const title = mode === "daily" ? `Hintergrid #${dayNumber(today)}` : mode === "room" ? `Hintergrid challenge ${saved.room}` : "Hintergrid practice";
    const lines = [0, 1, 2].map((y) => [0, 1, 2].map((x) => (game.cells[y * 3 + x] ? "🟩" : "⬛")).join(""));
    const link = mode === "room" || game.custom ? `\n${location.href}` : "";
    return `${title} — ${score()}/9\n${lines.join("\n")}${link}`;
  }

  function newPractice() {
    saved.practice = null;
    loadMode();
    say("");
    render();
  }

  function switchMode(next) {
    if (next === mode) return;
    mode = next;
    loadMode();
    say("");
    render();
  }

  // ---------------------------------------------------------- custom boards

  const encodeBoard = (b) => [...b.rows, ...b.cols].map(encodeURIComponent).join(",");
  function decodeBoard(text) {
    try {
      const ids = text.split(",").map(decodeURIComponent);
      const b = { rows: ids.slice(0, 3), cols: ids.slice(3, 6) };
      return ids.length === 6 && validBoard(b) ? b : null;
    } catch {
      return null;
    }
  }

  function playBoard(b) {
    mode = "practice";
    if (!(valid(saved.practice) && sameBoard(saved.practice, b))) {
      saved.practice = freshBoard(b, `custom/${Date.now()}`, { custom: true });
    }
    loadMode();
    say("");
    render();
  }

  const custom = $("custom");
  const selects = () => [...custom.querySelectorAll("select")];
  const customBoard = () => {
    const ids = selects().map((s) => s.value);
    return { rows: ids.slice(0, 3), cols: ids.slice(3) };
  };

  const optionsHtml = FAMILIES.map((f) =>
    `<optgroup label="${esc(f.kicker)}">${byFamily.get(f.id).map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("")}</optgroup>`
  ).join("");
  for (const [axis, word] of [["rows", "Row"], ["cols", "Column"]]) {
    $(`custom-${axis}`).innerHTML = [1, 2, 3].map((n) => `<select aria-label="${word} ${n}">${optionsHtml}</select>`).join("");
  }

  function renderCustom() {
    const b = customBoard();
    const rows = b.rows.map((id) => catById.get(id)), cols = b.cols.map((id) => catById.get(id));
    const mini = (c) => `<div class="head"><span class="label">${esc(c.label)}</span></div>`;
    let html = "<div></div>" + cols.map(mini).join("");
    let dead = 0;
    for (const r of rows) {
      html += mini(r);
      for (const c of cols) {
        const n = answersFor(r, c).length;
        if (!n) dead++;
        html += `<div class="count${n ? (n < MIN_ANSWERS ? " few" : "") : " none"}">${n.toLocaleString()}</div>`;
      }
    }
    $("custom-preview").innerHTML = html;
    const repeated = new Set([...b.rows, ...b.cols]).size < 6;
    $("custom-note").textContent = repeated ? "Each rule can only be used once."
      : dead ? `${dead} square${dead > 1 ? "s have" : " has"} no possible answer — change a rule.`
      : "Each number is how many subdivisions fit that square.";
    $("custom-note").classList.toggle("warn", repeated || dead > 0);
    const ok = !repeated && !dead;
    $("custom-play").disabled = !ok;
    $("custom-link").disabled = !ok;
    return ok;
  }

  function fillCustom(b) {
    selects().forEach((s, i) => { s.value = [...b.rows, ...b.cols][i]; });
    renderCustom();
  }

  $("custom-btn").addEventListener("click", () => {
    fillCustom(game);
    custom.showModal();
  });
  custom.addEventListener("change", renderCustom);
  $("custom-shuffle").addEventListener("click", () => fillCustom(generate(`custom/${Date.now()}/${Math.random()}`)));
  $("custom-link").addEventListener("click", () => {
    if (renderCustom()) copy(`${pageUrl()}#board=${encodeBoard(customBoard())}`, "Board link copied — anyone who opens it gets this board.");
  });
  $("custom-play").addEventListener("click", () => {
    if (!renderCustom()) return;
    const b = customBoard();
    if (!sameBoard(game, b) && !game.over && game.left < GUESSES && !window.confirm("Abandon the current grid and play this board?")) return;
    custom.close();
    playBoard(b);
  });

  // ------------------------------------------------------- challenge rooms

  // Live connection to the room this browser has joined (saved.room), if any.
  let room = null; // { code, ws, players, you, status, tries, timer, opened }
  const roomEl = $("room");

  const roomLink = (code) => `${pageUrl()}#room=${code}`;
  const NO_SERVER = "Multiplayer isn't switched on for this site yet: deploy the worker in <b>worker/</b> and put its address in <b>grid-config.js</b>.";

  function sendState() {
    const g = room && saved.rooms[room.code];
    if (!g || room.ws.readyState !== WebSocket.OPEN) return;
    room.ws.send(JSON.stringify({ t: "state", cells: g.cells, left: g.left, over: g.over }));
  }

  function disconnect() {
    if (!room) return;
    clearTimeout(room.timer);
    const { ws } = room;
    room = null;
    try { ws.close(); } catch { /* already closed */ }
  }

  function connect() {
    const code = saved.room;
    if (!code || !SERVER) return;
    const previous = room && room.code === code ? room : null;
    disconnect();
    const ws = new WebSocket(`${SERVER.replace(/^http/, "ws")}/rooms/${code}/ws?pid=${encodeURIComponent(saved.pid)}&name=${encodeURIComponent(saved.name || "Player")}`);
    const me = (room = { code, ws, players: previous ? previous.players : [], you: saved.pid, status: "connecting", tries: previous ? previous.tries : 0, opened: false });
    ws.onopen = () => {
      me.status = "online";
      me.tries = 0;
      me.opened = true;
      sendState();
      renderRoom();
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t !== "roster" || !Array.isArray(msg.players)) return;
      me.players = msg.players;
      me.you = msg.you;
      renderRoom();
    };
    ws.onclose = async () => {
      if (room !== me) return;
      me.status = "offline";
      renderRoom();
      // Never got in: the room may have expired.
      if (!me.opened) {
        try {
          const res = await fetch(`${SERVER}/rooms/${code}`);
          if (room !== me) return;
          if (res.status === 404) return leaveRoom("That challenge has expired.");
        } catch { /* offline — keep trying */ }
      }
      me.timer = setTimeout(() => { if (room === me) connect(); }, Math.min(15000, 1000 * 2 ** me.tries++));
    };
  }

  function leaveRoom(message = "") {
    disconnect();
    delete saved.room;
    if (mode === "room") mode = "practice";
    loadMode();
    say(message);
    render();
  }

  // Best score first; ties go to fewer guesses, then to whoever finished first.
  function ranked(players) {
    const pts = (p) => p.filled.filter(Boolean).length;
    return [...players].sort((a, b) =>
      pts(b) - pts(a) || b.left - a.left || (a.finished || Infinity) - (b.finished || Infinity) || a.joined - b.joined);
  }

  function renderRoom() {
    roomEl.hidden = mode !== "room" || !room;
    if (roomEl.hidden) return;
    const state = room.status === "online" ? "" : room.status === "connecting" ? "Connecting…" : "Offline — retrying…";
    const rows = ranked(room.players).map((p, i) => {
      const n = p.filled.filter(Boolean).length;
      return `<li class="${p.id === room.you ? "you" : ""}${p.online ? "" : " away"}">
        <span class="rank">${i + 1}</span>
        <span class="who"><b>${esc(p.name)}</b>${p.id === room.you ? " <i>you</i>" : ""}<small>${p.over ? "finished" : `${p.left} guess${p.left === 1 ? "" : "es"} left`}${p.online ? "" : " · away"}</small></span>
        <span class="dots" aria-hidden="true">${p.filled.map((f) => `<i class="${f ? "on" : ""}"></i>`).join("")}</span>
        <span class="pts">${n}<small>/9</small></span></li>`;
    });
    roomEl.innerHTML = `
      <div class="room-head">
        <h2>Challenge <b>${esc(room.code)}</b></h2>
        <span class="net">${state}</span>
        <button class="btn" id="room-copy">Copy invite link</button>
      </div>
      <ol class="players">${rows.join("") || '<li class="none">Waiting for the scoreboard…</li>'}</ol>
      <div class="room-foot">
        <span>${game.over ? "Answers are revealed now that you've finished." : "Other players' answers stay hidden until you finish."}</span>
        <button class="btn ghost" id="room-rename">Rename</button>
        <button class="btn ghost" id="room-leave">Leave</button>
      </div>`;
  }

  roomEl.addEventListener("click", (ev) => {
    if (ev.target.id === "room-copy") copy(roomLink(room.code), "Invite link copied — send it to your friends.");
    else if (ev.target.id === "room-leave") {
      if (window.confirm("Leave this challenge? You can rejoin with the invite link.")) leaveRoom();
    } else if (ev.target.id === "room-rename") {
      const name = (window.prompt("Your name on the scoreboard:", saved.name || "") || "").trim().slice(0, 24);
      if (!name) return;
      saved.name = name;
      persist();
      if (room.ws.readyState === WebSocket.OPEN) room.ws.send(JSON.stringify({ t: "name", name }));
    }
  });

  // Ask for a display name before creating or joining a challenge.
  const joinDialog = $("join");
  let joinDone = null;
  function askName(title, text, cta) {
    $("join-title").textContent = title;
    $("join-text").textContent = text;
    $("join-go").textContent = cta;
    $("name-input").value = saved.name || "";
    joinDialog.showModal();
    $("name-input").focus();
    return new Promise((resolve) => { joinDone = resolve; });
  }
  $("join-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = $("name-input").value.trim().slice(0, 24);
    if (!name) return;
    saved.name = name;
    persist();
    joinDialog.close("ok");
  });
  $("join-cancel").addEventListener("click", () => joinDialog.close(""));
  joinDialog.addEventListener("close", () => {
    const done = joinDone;
    joinDone = null;
    if (done) done(joinDialog.returnValue === "ok" ? saved.name : null);
    joinDialog.returnValue = "";
  });

  /** Puts this browser in a room whose board is already known, and shows it. */
  function enterRoom(code, b) {
    if (!(valid(saved.rooms[code]) && sameBoard(saved.rooms[code], b))) saved.rooms[code] = freshBoard(b, `room/${code}`);
    saved.rooms[code].at = Date.now();
    // Remember only the most recent few challenges.
    const stale = Object.keys(saved.rooms).sort((a, z) => (saved.rooms[z].at || 0) - (saved.rooms[a].at || 0)).slice(8);
    for (const old of stale) delete saved.rooms[old];
    saved.room = code;
    mode = "room";
    loadMode();
    connect();
    render();
  }

  async function joinRoom(code) {
    code = code.toUpperCase();
    if (!SERVER) return say(NO_SERVER, "bad");
    // Already a member: just show it.
    if (saved.room === code && valid(saved.rooms[code])) {
      mode = "room";
      loadMode();
      if (!room || room.code !== code) connect();
      say("");
      return render();
    }
    say("Looking up the challenge…");
    let info;
    try {
      const res = await fetch(`${SERVER}/rooms/${code}`);
      if (res.status === 404) return say(`There is no challenge <b>${esc(code)}</b> — it may have expired.`, "bad");
      if (!res.ok) throw new Error(res.status);
      info = await res.json();
    } catch {
      return say("Couldn't reach the challenge server. Check your connection and try again.", "bad");
    }
    if (!validBoard(info)) return say("That challenge uses rules this version of the game doesn't know. Reload the page and try again.", "bad");
    const others = info.players === 1 ? "1 player is" : `${info.players} players are`;
    const name = await askName(`Join challenge ${code}`, `${info.players ? `${others} in already. ` : ""}Everyone plays the same board with 10 guesses; the scoreboard updates live.`, "Join");
    if (!name) return say("");
    say("");
    enterRoom(code, info);
  }

  async function createRoom() {
    if (!SERVER) return say(NO_SERVER, "bad");
    const b = { rows: game.rows, cols: game.cols };
    const name = await askName("Challenge friends", "This creates a room for the board on screen. Everyone who opens the invite link plays it with a fresh 10 guesses — including you.", "Create challenge");
    if (!name) return;
    say("Creating the challenge…");
    let code;
    try {
      const res = await fetch(`${SERVER}/rooms`, { method: "POST", body: JSON.stringify(b) });
      if (!res.ok) throw new Error(res.status);
      ({ code } = await res.json());
    } catch {
      return say("Couldn't reach the challenge server. Check your connection and try again.", "bad");
    }
    enterRoom(code, b);
    const copied = await copy(roomLink(code), `Challenge <b>${esc(code)}</b> is live and the invite link is copied — send it to your friends.`);
    if (!copied) say(`Challenge <b>${esc(code)}</b> is live — send the invite link to your friends.`);
  }

  // Opening a link: #room=CODE joins a challenge, #board=… loads a custom board.
  function followHash(hash) {
    const params = new URLSearchParams(hash.slice(1));
    const code = params.get("room"), b = params.get("board");
    if (code && /^[A-Za-z0-9]{4,12}$/.test(code)) {
      joinRoom(code);
    } else if (b) {
      const decoded = decodeBoard(hash.slice(1).replace(/^board=/, ""));
      if (decoded) playBoard(decoded);
      else say("That board link isn't valid.", "bad");
    }
  }

  // ---------------------------------------------------------------- picker

  const picker = $("picker"), input = $("guess-input"), list = $("suggestions");
  let pickCell = -1, matches = [], active = 0;

  const criteriaHtml = (k) => [rowCat(k), colCat(k)].map((c) => `<span>${esc(c.desc)}</span>`).join("");

  function search(text) {
    const q = norm(text);
    if (!q) return [];
    const tokens = q.split(" ");
    const out = [];
    for (const r of regions) {
      if (!tokens.every((t) => r.hay.includes(t))) continue;
      let rank;
      if (r.key === q) rank = 0;
      else if (r.key.startsWith(q)) rank = 1;
      else if (r.altKeys.includes(q)) rank = 1.5;
      else if (r.key.includes(" " + q)) rank = 2;
      else if (r.altKeys.some((a) => a.startsWith(q))) rank = 3;
      else if (r.key.includes(q)) rank = 4;
      else if (r.altKeys.some((a) => a.includes(q))) rank = 5;
      else rank = tokens.some((t) => r.key.startsWith(t)) ? 6 : 7;
      out.push([rank, r]);
    }
    out.sort((a, b) => a[0] - b[0] || a[1].key.length - b[1].key.length || a[1].key.localeCompare(b[1].key) || a[1].country.localeCompare(b[1].country));
    return out.slice(0, 12).map((m) => m[1]);
  }

  // Why a suggestion cannot be played in the open square, if it cannot.
  function blocked(r) {
    if (placed().has(r.id)) return "already placed";
    if (game.wrong[pickCell].includes(r.id)) return "already tried here";
    return "";
  }

  function showSuggestions() {
    const text = input.value.trim();
    matches = search(text);
    active = Math.max(0, matches.findIndex((r) => !blocked(r)));
    const q = norm(text);
    list.innerHTML = !text
      ? '<li class="none">Start typing a name. Only the name counts — searching by country won\'t list its subdivisions.</li>'
      : matches.length
        ? matches
            .map((r, i) => {
              const via = !r.key.includes(q) ? r.alts.find((a) => norm(a).includes(q)) : null;
              const why = blocked(r);
              return `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === active}" aria-disabled="${why ? "true" : "false"}" class="${why ? "blocked" : ""}">
                <span class="s-name">${esc(r.name)}${via ? ` <span class="s-sub">(${esc(via)})</span>` : ""}</span>
                <span class="s-sub">${esc(r.country)}${why ? ` · ${why}` : ""}</span></li>`;
            })
            .join("")
        : '<li class="none">No subdivision matches that.</li>';
    list.scrollTop = 0;
    input.setAttribute("aria-activedescendant", matches.length ? `opt-${active}` : "");
  }

  function setActive(i) {
    if (!matches.length) return;
    active = (i + matches.length) % matches.length;
    list.querySelectorAll("li").forEach((li, k) => li.setAttribute("aria-selected", String(k === active)));
    input.setAttribute("aria-activedescendant", `opt-${active}`);
    list.children[active].scrollIntoView({ block: "nearest" });
  }

  function openPicker(k) {
    pickCell = k;
    $("picker-criteria").innerHTML = criteriaHtml(k);
    const tried = game.wrong[k].map((id) => byId.get(id)).filter(Boolean);
    $("picker-tried").innerHTML = tried.length ? `Tried here: ${tried.map((r) => `<s>${esc(r.name)}</s>`).join(", ")}` : "";
    input.value = "";
    showSuggestions();
    picker.showModal();
    input.focus();
  }

  function choose(region) {
    if (!region || blocked(region)) return;
    const k = pickCell;
    picker.close();
    guess(k, region);
  }

  input.addEventListener("input", showSuggestions);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(active + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(active - 1); }
  });
  $("guess-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    choose(matches[active]);
  });
  list.addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (li) choose(matches[+li.dataset.i]);
  });

  // --------------------------------------------------------------- answers

  const answersDialog = $("answers");

  function openAnswers(k) {
    const all = answersFor(rowCat(k), colCat(k));
    // Who answered what: me, plus everyone in the challenge once it is revealed.
    const picks = new Map();
    const pick = (id, name) => { if (id) picks.set(id, [...(picks.get(id) || []), name]); };
    pick(game.cells[k], "you");
    if (mode === "room" && room) {
      for (const p of room.players) if (p.id !== room.you && p.cells) pick(p.cells[k], p.name);
    }
    const votes = (r) => (picks.get(r.id) || []).length;
    all.sort((a, b) => votes(b) - votes(a) || a.name.localeCompare(b.name) || a.country.localeCompare(b.country));
    const LIMIT = 400;
    $("answers-criteria").innerHTML = criteriaHtml(k);
    $("answers-count").textContent = `${all.length.toLocaleString()} subdivision${all.length === 1 ? " fits" : "s fit"} this square.`;
    $("answers-list").innerHTML =
      all.slice(0, LIMIT).map((r) => {
        const by = picks.get(r.id);
        return `<li class="${by ? (by.includes("you") ? "mine" : "theirs") : ""}"><b>${esc(r.name)}</b><span>${esc(r.country)}${by ? ` · ${esc(by.join(", "))}` : ""}</span></li>`;
      }).join("") +
      (all.length > LIMIT ? `<li class="more">…and ${(all.length - LIMIT).toLocaleString()} more</li>` : "");
    answersDialog.showModal();
    $("answers-list").scrollTop = 0;
  }

  // ---------------------------------------------------------------- events

  board.addEventListener("click", (ev) => {
    const cell = ev.target.closest(".cell");
    if (!cell || cell.disabled) return;
    const k = +cell.dataset.k;
    if (game.over) openAnswers(k);
    else if (!game.cells[k]) openPicker(k);
  });

  resultEl.addEventListener("click", (ev) => {
    if (ev.target.id === "share-btn") copy(shareText(), "Result copied to the clipboard.");
    else if (ev.target.id === "again-btn") newPractice();
    else if (ev.target.id === "practice-btn") switchMode("practice");
  });

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
  $("new-btn").addEventListener("click", () => {
    if (game.over || game.left === GUESSES || window.confirm("Abandon this grid and start a new one?")) newPractice();
  });
  $("challenge-btn").addEventListener("click", createRoom);
  $("giveup-btn").addEventListener("click", () => {
    if (game.over || !window.confirm("Give up and reveal the answer counts?")) return;
    finish();
    persist();
    if (mode === "room") sendState();
    say("");
    render();
  });

  const help = $("help");
  $("help-btn").addEventListener("click", () => help.showModal());
  $("picker-close").addEventListener("click", () => picker.close());
  $("answers-close").addEventListener("click", () => answersDialog.close());
  $("custom-close").addEventListener("click", () => custom.close());
  // Click on the backdrop closes a dialog.
  for (const dialog of [picker, answersDialog, help, custom, joinDialog]) {
    dialog.addEventListener("click", (ev) => {
      if (ev.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (ev.clientX < box.left || ev.clientX > box.right || ev.clientY < box.top || ev.clientY > box.bottom) dialog.close();
    });
  }

  // ------------------------------------------------------------------ start

  $("total-count").textContent = regions.length.toLocaleString();
  const incoming = location.hash; // render() rewrites the address, so read the link first
  const linked = incoming.length > 1;
  loadMode();
  if (saved.room) connect();
  render();
  if (linked) followHash(incoming);
  window.addEventListener("hashchange", () => followHash(location.hash));
  if (!saved.seenHelp && !linked) {
    saved.seenHelp = true;
    persist();
    help.showModal();
  }
})();
