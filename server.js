// Minimal WebSocket signaling server for WebRTC rooms
// Supports many viewers per broadcaster via per-viewer RTCPeerConnections

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// roomId -> Set of clientIds
const rooms = new Map();
// clientId -> ws
const clients = new Map();
// ws -> clientId
const idsBySocket = new Map();

let nextId = 1;

function joinRoom(clientId, roomId){
  if(!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(clientId);
}
function leaveRoom(clientId){
  for(const [roomId, set] of rooms){
    if(set.has(clientId)){
      set.delete(clientId);
      if(set.size === 0) rooms.delete(roomId);
    }
  }
}
function getRoomOf(clientId){
  for(const [roomId, set] of rooms){
    if(set.has(clientId)) return roomId;
  }
  return null;
}

function safeSend(ws, obj){
  try { ws.send(JSON.stringify(obj)); } catch(e) {}
}

wss.on('connection', (ws) => {
  const clientId = String(nextId++);
  clients.set(clientId, ws);
  idsBySocket.set(ws, clientId);
  safeSend(ws, { type: 'hello', id: clientId });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch(e){ return; }

    // {type:'join', room}
    if(msg.type === 'join' && typeof msg.room === 'string'){
      joinRoom(clientId, msg.room);
      // Notify others in the room that someone joined
      const room = rooms.get(msg.room) || new Set();
      for(const otherId of room){
        if(otherId === clientId) continue;
        const otherWs = clients.get(otherId);
        if(otherWs && otherWs.readyState === WebSocket.OPEN){
          safeSend(otherWs, { type: 'peer-join', from: clientId });
        }
      }
      return;
    }

    // Generic relay: if msg.to specified, forward to that client; else to all peers in room (except sender)
    const to = msg.to && String(msg.to);
    if(to){
      const target = clients.get(to);
      if(target && target.readyState === WebSocket.OPEN){
        msg.from = clientId;
        safeSend(target, msg);
      }
      return;
    } else {
      const roomId = getRoomOf(clientId);
      if(!roomId) return;
      const room = rooms.get(roomId) || new Set();
      for(const otherId of room){
        if(otherId === clientId) continue;
        const otherWs = clients.get(otherId);
        if(otherWs && otherWs.readyState === WebSocket.OPEN){
          safeSend(otherWs, { ...msg, from: clientId });
        }
      }
    }
  });

  ws.on('close', () => {
    const id = idsBySocket.get(ws);
    leaveRoom(id);
    clients.delete(id);
    idsBySocket.delete(ws);
    // Notify peers in the same room
    const roomId = getRoomOf(id);
    if(roomId){
      const room = rooms.get(roomId) || new Set();
      for(const otherId of room){
        const otherWs = clients.get(otherId);
        if(otherWs && otherWs.readyState === WebSocket.OPEN){
          safeSend(otherWs, { type: 'peer-leave', from: id });
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on ws://localhost:${PORT}`);
});
