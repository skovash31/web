// CAT INCORPORATED — game server. Express serves the client; Socket.IO runs lobbies and gameplay.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room } from './Room.js';
import { loadCheckpoint } from './saves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const DEBUG = process.env.DEBUG === '1' || process.argv.includes('--debug');

// If the folder above the game has an index.html (your website), serve the whole site
// and put the game at /<game folder name>/  (e.g. /horror game/). Otherwise the game is at /.
const SITE_ROOT = process.env.SITE_ROOT || path.dirname(ROOT);
const SITE_MODE = process.env.SITE_ROOT !== '' && fs.existsSync(path.join(SITE_ROOT, 'index.html'));
const GAME_PATH = SITE_MODE ? '/' + path.basename(ROOT) : '';
const GAME_PATHS = [...new Set([GAME_PATH, encodeURI(GAME_PATH)])]; // URLs arrive with the space as %20

export function createServer({ port = PORT, debug = DEBUG, quiet = false } = {}) {
  const app = express();
  const game = express.Router();
  game.use(express.static(path.join(ROOT, 'public')));
  game.use('/shared', express.static(path.join(ROOT, 'shared')));
  game.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));
  game.use('/models', express.static(path.join(ROOT, '3d models')));
  game.use('/music', express.static(path.join(ROOT, 'music')));
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
  if (SITE_MODE) {
    // "/horror game" -> "/horror game/" so the game's relative paths work
    app.get(GAME_PATHS, (req, res, next) => (req.originalUrl.split('?')[0].endsWith('/') ? next() : res.redirect(301, encodeURI(GAME_PATH) + '/')));
    app.use(GAME_PATHS, game);
    app.use(GAME_PATHS, (_req, res) => res.status(404).send('Not found')); // never expose server code/saves
    app.use(express.static(SITE_ROOT));
  } else {
    app.use(game);
  }

  const server = http.createServer(app);
  const io = new Server(server, { pingInterval: 5000, pingTimeout: 10000 });
  const rooms = new Map();

  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
      if (!rooms.has(c)) return c;
    }
  };
  const makeRoom = (code, save) => {
    const room = new Room(code, io, { save, debug, onEmpty: (r) => { rooms.delete(r.code); if (!quiet) console.log(`room ${r.code} closed`); } });
    rooms.set(code, room);
    return room;
  };

  io.on('connection', (socket) => {
    let room = null;
    let player = null;
    const leave = () => { if (room && player) room.removePlayer(player.id); room = null; player = null; };

    socket.on('createRoom', (data = {}, ack) => {
      if (typeof ack !== 'function') return;
      leave();
      let code = newCode();
      let save = null;
      if (data.saveCode) {
        const sc = String(data.saveCode).toUpperCase().trim();
        save = loadCheckpoint(sc);
        if (!save) return ack({ ok: false, error: 'No save found for that code.' });
        if (save.completed) return ack({ ok: false, error: 'That save already reached the ending. Start a new shift!' });
        if (!rooms.has(sc)) code = sc; // resume under the same code so checkpoints keep updating it
      }
      room = makeRoom(code, save);
      player = room.addPlayer(socket, data.name);
      if (!quiet) console.log(`room ${code} created by ${player.name}${save ? ` (resuming ${save.levelName})` : ''}`);
      ack({ ok: true, code, id: socket.id, lobby: room.lobbyState() });
    });

    socket.on('joinRoom', (data = {}, ack) => {
      if (typeof ack !== 'function') return;
      const code = String(data.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return ack({ ok: false, error: 'No lobby with that code.' });
      if (r.full) return ack({ ok: false, error: 'That lobby is full (4/4).' });
      if (r.phase === 'ended') return ack({ ok: false, error: 'That game just ended.' });
      leave();
      room = r;
      player = room.addPlayer(socket, data.name);
      ack({ ok: true, code, id: socket.id, lobby: room.lobbyState() });
    });

    socket.on('leaveRoom', leave);
    socket.on('setting', (d = {}) => { if (room && player) room.setSetting(player.id, String(d.key), d.value); });
    socket.on('startGame', () => { if (room && player) room.start(player.id); });
    socket.on('state', (s) => { if (room && player) room.handleState(player, s); });
    socket.on('noise', (t) => { if (room && player) room.handleNoise(player, t); });
    socket.on('interact', (d = {}) => { if (room && player && room.floor && room.phase === 'playing' && !room.transitioning) room.floor.interact(player, String(d.id || ''), { code: d.code }); });
    socket.on('useItem', (id) => { if (room && player) room.handleUse(player, String(id)); });
    socket.on('dropItem', (id) => { if (room && player) room.handleDrop(player, String(id)); });
    socket.on('fire', (d) => { if (room && player && d && typeof d === 'object') room.handleFire(player, d); });
    socket.on('reload', (id) => { if (room && player) room.handleReload(player, typeof id === 'string' ? id : null); });
    socket.on('chat', (t) => { if (room && player) room.chat(player, t); });
    socket.on('debug', (cmd) => { if (room && player) room.debugCmd(player, cmd); });
    socket.on('disconnect', leave);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      if (!quiet) console.log(`CAT INCORPORATED server running at http://localhost:${server.address().port}${encodeURI(GAME_PATH)}/${debug ? ' (DEBUG)' : ''}`);
      resolve({ server, io, rooms, port: server.address().port, close: () => new Promise((r) => { io.close(); server.close(() => r()); }) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  createServer();
}
