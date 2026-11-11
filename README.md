<img src="assets/icon.svg" width="64" height="64" alt="">

# Glubdivision

A globe guessing game for **first-level administrative subdivisions** — states,
provinces, regions, prefectures, cantons… 3,342 of them across 244 countries and
territories.

Guess any subdivision; it lights up on the globe, coloured by its border-to-border
distance from the mystery one (cold blue = far, hot red = close, neighbours are
0 km). Daily mode gives everyone the same region each day; practice is unlimited.
In practice you can limit the mystery region to countries of your choice.

## Hintergrid

`grid.html` is a second game on the same atlas: a 3×3 grid where each square
needs a subdivision that fits both its row rule and its column rule (a country,
a continent, a unit type, something about the name, geography, cities…). Ten
guesses for nine squares, a daily grid plus unlimited practice.

- `grid.html`, `grid.css`, `grid.js` — the game
- `data/grid-facts.js` — per-subdivision facts (area, coastline, borders,
  capital, big cities, continent), built by `npm run build:grid` from
  `data/admin1.js` and Natural Earth's country and populated-places layers

In practice mode you can also build a **custom board** from any six rules (the
link in the address bar reproduces it for anyone), and **challenge friends**:
that creates a room where everyone plays the same board with a live scoreboard.

### Challenge rooms (optional)

The site stays static; rooms run on a small Cloudflare Worker in `worker/`, one
Durable Object per room (works on the free plan). Without it everything else
still works and the challenge button just explains what is missing.

```
cd worker
npx wrangler login
npx wrangler deploy
```

Put the URL it prints into `grid-config.js`:

```js
window.HINTERGRID_SERVER = "https://hintergrid-rooms.<your-subdomain>.workers.dev";
```

To try it locally, run `npx wrangler dev` in `worker/` and open
`grid.html?server=http://127.0.0.1:8787`. To restrict the API to your own site,
set `ALLOWED_ORIGINS` in `worker/wrangler.toml`. Rooms delete themselves 14 days
after the last player connects. Answers are checked in the browser, not on the
server, so a room is a scoreboard between friends rather than anti-cheat.

## Run

No build step. Open `index.html` in a browser, or serve the folder:

```
npm start
```

## Files

- `index.html`, `style.css`, `game.js` — the whole game (canvas globe via d3-geo)
- `data/admin1.js` — simplified boundaries + names (TopoJSON, ~1.3 MB)
- `vendor/` — d3 and topojson-client
- `scripts/build-data.mjs` — regenerates `data/admin1.js`

## Rebuilding the data

```
npm install
npm run build:data
```

The script downloads Natural Earth's 10m admin-1 layer (public domain), merges
second-level units up to their real first level where Natural Earth is too fine
(French departments → regions, Italian provinces → regions, UK districts → the
four countries, etc.), fixes ambiguous names, and simplifies the geometry.
