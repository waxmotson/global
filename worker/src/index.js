// Hintergrid challenge rooms.
//
// The game itself is a static site; this Worker is the only moving part. Each
// challenge is one Durable Object that stores the board and every player's
// progress, and pushes a live scoreboard to everyone connected.
//
//   POST /rooms            {rows:[3], cols:[3]}  ->  {code}
//   GET  /rooms/:code                            ->  {code, rows, cols, players}
//   GET  /rooms/:code/ws?pid=…&name=…            ->  WebSocket
//
// The subdivision data lives only in the browser, so answers are not checked
// here: a room is a scoreboard between friends, not an anti-cheat system.

import { DurableObject } from "cloudflare:workers";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CODE_LENGTH = 6;
const MAX_PLAYERS = 40;
const MAX_GUESSES = 10;
const ROOM_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const cleanName = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) || "Player";
const isId = (s, max = 80) => typeof s === "string" && s.length > 0 && s.length <= max;

function validBoard(board) {
  const axis = (a) => Array.isArray(a) && a.length === 3 && a.every((id) => isId(id));
  return board && axis(board.rows) && axis(board.cols) && new Set([...board.rows, ...board.cols]).size === 6;
}

export class Room extends DurableObject {
  /** Returns false when the room already exists. */
  async create(code, board) {
    if (await this.ctx.storage.get("board")) return false;
    await this.ctx.storage.put({ code, board, created: Date.now() });
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    return true;
  }

  async info() {
    const board = await this.ctx.storage.get("board");
    if (!board) return null;
    const players = await this.players();
    return { code: await this.ctx.storage.get("code"), rows: board.rows, cols: board.cols, players: players.size };
  }

  async players() {
    return this.ctx.storage.list({ prefix: "p:" });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    if (!(await this.ctx.storage.get("board"))) return new Response("No such room", { status: 404 });

    const pid = url.searchParams.get("pid");
    if (!isId(pid, 64)) return new Response("Missing player id", { status: 400 });

    const key = `p:${pid}`;
    let player = await this.ctx.storage.get(key);
    if (!player) {
      if ((await this.players()).size >= MAX_PLAYERS) return new Response("Room is full", { status: 403 });
      player = { name: cleanName(url.searchParams.get("name")), cells: Array(9).fill(null), left: MAX_GUESSES, over: false, joined: Date.now(), finished: null };
    } else if (url.searchParams.get("name")) {
      player.name = cleanName(url.searchParams.get("name"));
    }
    await this.ctx.storage.put(key, player);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ pid });
    await this.broadcast();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 4000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { pid } = ws.deserializeAttachment() || {};
    const key = `p:${pid}`;
    const player = await this.ctx.storage.get(key);
    if (!player) return;

    if (msg.t === "state") {
      const cells = msg.cells;
      if (!Array.isArray(cells) || cells.length !== 9 || !cells.every((c) => c === null || isId(c))) return;
      if (!Number.isInteger(msg.left) || msg.left < 0 || msg.left > MAX_GUESSES) return;
      // A finished game is final, and progress never goes backwards.
      if (player.over) return;
      player.cells = cells.map((c, i) => c ?? player.cells[i]);
      player.left = Math.min(player.left, msg.left);
      if (msg.over === true || player.left === 0 || player.cells.every(Boolean)) {
        player.over = true;
        player.finished = Date.now();
      }
    } else if (msg.t === "name") {
      player.name = cleanName(msg.name);
    } else {
      return;
    }
    await this.ctx.storage.put(key, player);
    await this.broadcast();
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch { /* already closed */ }
    await this.broadcast(ws);
  }

  async webSocketError(ws) {
    await this.broadcast(ws);
  }

  /** Sends everyone the scoreboard. Answers are only shown to players who have finished. */
  async broadcast(leaving) {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== leaving);
    const online = new Set(sockets.map((ws) => ws.deserializeAttachment()?.pid));
    const players = [...(await this.players())].map(([key, p]) => ({ id: key.slice(2), ...p, online: online.has(key.slice(2)) }));
    const doneById = new Map(players.map((p) => [p.id, p.over]));

    for (const ws of sockets) {
      const me = ws.deserializeAttachment()?.pid;
      const reveal = doneById.get(me) === true;
      const roster = players.map((p) => ({
        id: p.id,
        name: p.name,
        filled: p.cells.map(Boolean),
        left: p.left,
        over: p.over,
        joined: p.joined,
        finished: p.finished,
        online: p.online,
        ...(reveal || p.id === me ? { cells: p.cells } : {}),
      }));
      try { ws.send(JSON.stringify({ t: "roster", you: me, players: roster })); } catch { /* socket is gone */ }
    }
  }

  // Rooms clean themselves up once nobody has connected for a while.
  async alarm() {
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    else await this.ctx.storage.deleteAll();
  }
}

function cors(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin") || "";
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : null;
  return {
    allow,
    headers: {
      ...(allow ? { "Access-Control-Allow-Origin": allow } : {}),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { allow, headers } = cors(request, env);
    const json = (body, status = 200) => Response.json(body, { status, headers });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!allow) return json({ error: "Origin not allowed" }, 403);

    const room = (code) => env.ROOMS.get(env.ROOMS.idFromName(code));

    if (url.pathname === "/rooms" && request.method === "POST") {
      let board;
      try {
        const text = await request.text();
        if (text.length > 2000) throw new Error("too large");
        board = JSON.parse(text);
      } catch {
        return json({ error: "Invalid request" }, 400);
      }
      if (!validBoard(board)) return json({ error: "Invalid board" }, 400);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        if (await room(code).create(code, { rows: board.rows, cols: board.cols })) return json({ code }, 201);
      }
      return json({ error: "Could not create a room" }, 503);
    }

    const match = url.pathname.match(/^\/rooms\/([A-Za-z0-9]{4,12})(\/ws)?$/);
    if (match && request.method === "GET") {
      const code = match[1].toUpperCase();
      if (match[2]) return room(code).fetch(request);
      const info = await room(code).info();
      return info ? json(info) : json({ error: "No such room" }, 404);
    }

    if (url.pathname === "/") return json({ service: "hintergrid-rooms" });
    return json({ error: "Not found" }, 404);
  },
};
