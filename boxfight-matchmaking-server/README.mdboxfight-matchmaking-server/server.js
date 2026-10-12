'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const ALLOWED_MODES = new Set(['1v1', '1v2', '2v2']);
const PARTY_SIZE = { '1v1': 2, '1v2': 3, '2v2': 4 };
const QUEUE_TTL_MS = 90_000;
const MATCH_TTL_MS = 45_000;

const app = express();
app.disable('x-powered-by');
app.get('/', (_req, res) => {
  res.type('text').send('Box Fight 2D central matchmaking is online.');
});
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'box-fight-central-matchmaking', time: new Date().toISOString() });
});
app.get('/status', (_req, res) => {
  const queues = {};
  for (const mode of ALLOWED_MODES) queues[mode] = (queuesByMode.get(mode) || []).filter((entry) => io.sockets.sockets.has(entry.socketId)).length;
  res.json({ ok: true, queues, activeMatches: matchesById.size, activeRooms: roomCodes.size });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === '*' ? '*' : CLIENT_ORIGIN.split(',').map((s) => s.trim()), methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 64 * 1024
});

const queuesByMode = new Map([['1v1', []], ['1v2', []], ['2v2', []]]);
const queueBySocket = new Map();
const matchesById = new Map();
const roomCodes = new Map();

function cleanName(value) {
  const name = String(value || 'Player').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 22);
  return name || 'Player';
}
function makeCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(crypto.randomInt(10000, 100000));
    if (!roomCodes.has(code)) return code;
  }
  throw new Error('Could not generate a unique room code');
}
function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function leaveQueue(socketId) {
  const mode = queueBySocket.get(socketId);
  if (!mode) return;
  const q = queuesByMode.get(mode) || [];
  queuesByMode.set(mode, q.filter((entry) => entry.socketId !== socketId));
  queueBySocket.delete(socketId);
}
function clearMatch(matchId, reason, notify = true) {
  const match = matchesById.get(matchId);
  if (!match) return;
  matchesById.delete(matchId);
  roomCodes.delete(match.roomCode);
  for (const player of match.players) {
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.leave(`match:${matchId}`);
      if (notify) socket.emit('match:cancelled', { matchId, reason: reason || 'Match closed.' });
      if (socket.data.matchId === matchId) socket.data.matchId = null;
      if (socket.data.matchRole) socket.data.matchRole = null;
    }
  }
}
function teamFor(mode, index) {
  if (mode === '1v2') return index === 0 ? 'A' : 'B';
  if (mode === '2v2') return index < 2 ? 'A' : 'B';
  return index === 0 ? 'A' : 'B';
}
function tryMatch(mode) {
  const q = queuesByMode.get(mode);
  const needed = PARTY_SIZE[mode];
  while (q && q.length >= needed) {
    const selected = [];
    while (q.length && selected.length < needed) {
      const next = q.shift();
      queueBySocket.delete(next.socketId);
      if (io.sockets.sockets.has(next.socketId) && Date.now() - next.joinedAt < QUEUE_TTL_MS) selected.push(next);
    }
    if (selected.length < needed) continue;

    const players = shuffle(selected);
    const matchId = crypto.randomUUID();
    const roomCode = makeCode();
    const hostPeerId = `boxfight2d-${roomCode}`;
    const match = { matchId, roomCode, mode, hostPeerId, players, hostSocketId: players[0].socketId, createdAt: Date.now(), hostReady: false };
    matchesById.set(matchId, match);
    roomCodes.set(roomCode, matchId);

    const publicPlayers = players.map((player, index) => ({ name: player.name, team: teamFor(mode, index), slot: index + 1 }));
    players.forEach((player, index) => {
      const socket = io.sockets.sockets.get(player.socketId);
      if (!socket) return;
      socket.data.matchId = matchId;
      socket.data.matchRole = index === 0 ? 'host' : 'guest';
      socket.join(`match:${matchId}`);
      socket.emit('match:found', {
        matchId,
        mode,
        roomCode,
        hostPeerId,
        role: index === 0 ? 'host' : 'guest',
        team: teamFor(mode, index),
        slot: index + 1,
        players: publicPlayers
      });
    });
  }
}

io.on('connection', (socket) => {
  socket.emit('center:ready', { service: 'box-fight-central-matchmaking' });

  socket.on('queue:join', (payload = {}) => {
    const mode = String(payload.mode || '1v1');
    if (!ALLOWED_MODES.has(mode)) {
      socket.emit('queue:error', { message: 'Unknown game mode.' });
      return;
    }
    if (socket.data.matchId) {
      socket.emit('queue:error', { message: 'You are already in a match.' });
      return;
    }
    leaveQueue(socket.id);
    const entry = { socketId: socket.id, name: cleanName(payload.name), mode, joinedAt: Date.now() };
    queuesByMode.get(mode).push(entry);
    queueBySocket.set(socket.id, mode);
    socket.data.queueMode = mode;
    socket.emit('queue:joined', { mode, waiting: queuesByMode.get(mode).length, needed: PARTY_SIZE[mode] });
    tryMatch(mode);
  });

  socket.on('queue:leave', () => {
    leaveQueue(socket.id);
    socket.data.queueMode = null;
    socket.emit('queue:left', { ok: true });
  });

  socket.on('match:host-ready', (payload = {}) => {
    const match = matchesById.get(String(payload.matchId || ''));
    if (!match || match.hostSocketId !== socket.id || match.mode !== '1v1') return;
    if (String(payload.roomCode || '') !== match.roomCode) return;
    match.hostReady = true;
    io.to(`match:${match.matchId}`).emit('match:ready', {
      matchId: match.matchId,
      mode: match.mode,
      roomCode: match.roomCode,
      hostPeerId: match.hostPeerId
    });
  });

  socket.on('match:peer-connected', (payload = {}) => {
    const match = matchesById.get(String(payload.matchId || ''));
    if (!match || !match.players.some((player) => player.socketId === socket.id)) return;
    match.peerConnected = true;
    match.connectedAt = Date.now();
  });

  socket.on('match:complete', (payload = {}) => {
    const matchId = String(payload.matchId || '');
    if (socket.data.matchId !== matchId) return;
    clearMatch(matchId, 'Match finished.', false);
  });

  socket.on('match:cancel', (payload = {}) => {
    const matchId = String(payload.matchId || socket.data.matchId || '');
    const match = matchesById.get(matchId);
    if (!match || !match.players.some((player) => player.socketId === socket.id)) return;
    clearMatch(matchId, 'A player cancelled matchmaking.');
  });

  socket.on('disconnect', () => {
    leaveQueue(socket.id);
    const matchId = socket.data.matchId;
    if (matchId && matchesById.has(matchId)) clearMatch(matchId, 'A player disconnected.');
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [socketId, mode] of queueBySocket.entries()) {
    const q = queuesByMode.get(mode) || [];
    const item = q.find((entry) => entry.socketId === socketId);
    if (!io.sockets.sockets.has(socketId) || !item || now - item.joinedAt > QUEUE_TTL_MS) {
      leaveQueue(socketId);
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.emit('queue:expired', { message: 'Queue timed out. Try again.' });
    }
  }
  for (const [matchId, match] of matchesById.entries()) {
    if (!match.peerConnected && now - match.createdAt > MATCH_TTL_MS) clearMatch(matchId, 'Matchmaking timed out. Try again.');
  }
}, 5_000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Box Fight 2D matchmaking listening on 0.0.0.0:${PORT}`);
});
