import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Room state: roomId -> { admin: WebSocket, members: Set<WebSocket>, pending: Set<WebSocket>, locked: boolean }
const rooms = new Map<string, { admin: WebSocket | null; members: Set<WebSocket>; pending: Set<WebSocket>; locked: boolean }>();
// Map to track which room a socket belongs to and their peerId
const socketInfo = new Map<WebSocket, { roomId: string; peerId: string; isAdmin: boolean; name: string }>();

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const distPath = path.join(process.cwd(), "dist");
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

  console.log(`NEXUS Server Initialization:`);
  console.log(`- CWD: ${process.cwd()}`);
  console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`- Dist Path: ${distPath}`);
  console.log(`- Is Production: ${isProduction}`);

  // API Health Check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      version: "2.1.0",
      mode: isProduction ? "production" : "development"
    });
  });

  wss.on("connection", (ws) => {
    const peerId = uuidv4();

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "join": {
            const roomId = (message.roomId || "").trim();
            const name = (message.name || "Anonymous").trim();
            if (!roomId) return;

            if (!rooms.has(roomId)) {
              rooms.set(roomId, { admin: ws, members: new Set([ws]), pending: new Set(), locked: false });
              socketInfo.set(ws, { roomId, peerId, isAdmin: true, name });
              ws.send(JSON.stringify({ type: "joined", peerId, isAdmin: true, peers: [] }));
            } else {
              const room = rooms.get(roomId)!;
              if (room.locked) {
                ws.send(JSON.stringify({ type: "error", message: "Room is locked by administrator" }));
                return;
              }
              if (room.members.size + room.pending.size >= 5) {
                ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
                return;
              }
              
              room.pending.add(ws);
              socketInfo.set(ws, { roomId, peerId, isAdmin: false, name });
              
              // Notify admin of join request
              if (room.admin && room.admin.readyState === WebSocket.OPEN) {
                room.admin.send(JSON.stringify({ type: "join-request", peerId, name }));
              }
              ws.send(JSON.stringify({ type: "waiting-for-approval", peerId }));
            }
            break;
          }

          case "approve-join": {
            const info = socketInfo.get(ws);
            if (!info || !info.isAdmin) return;
            const room = rooms.get(info.roomId);
            if (!room) return;

            const targetPeerId = message.peerId;
            let targetWs: WebSocket | null = null;
            for (const [s, sInfo] of socketInfo.entries()) {
              if (sInfo.peerId === targetPeerId && room.pending.has(s)) {
                targetWs = s;
                break;
              }
            }

            if (targetWs) {
              room.pending.delete(targetWs);
              room.members.add(targetWs);

              const peers = Array.from(room.members)
                .map((s) => {
                  const sInfo = socketInfo.get(s)!;
                  return { id: sInfo.peerId, isAdmin: sInfo.isAdmin, name: sInfo.name };
                });

              targetWs.send(JSON.stringify({ type: "joined", peerId: targetPeerId, isAdmin: false, peers }));
              
              room.members.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: "room-update", peers }));
                }
              });
              console.log(`Approved ${targetPeerId} for room ${info.roomId}`);
            }
            break;
          }

          case "admin-command": {
            const info = socketInfo.get(ws);
            if (!info || !info.isAdmin) return;
            const room = rooms.get(info.roomId);
            if (!room) return;

            const { targetId, command } = message;
            room.members.forEach((client) => {
              const clientInfo = socketInfo.get(client);
              if (clientInfo && clientInfo.peerId === targetId && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "remote-command", command }));
              }
            });
            break;
          }

          case "kick": {
            const info = socketInfo.get(ws);
            if (!info || !info.isAdmin) return;
            const room = rooms.get(info.roomId);
            if (!room) return;

            const targetPeerId = message.peerId;
            for (const [s, sInfo] of socketInfo.entries()) {
              if (sInfo.peerId === targetPeerId && room.members.has(s)) {
                s.send(JSON.stringify({ type: "kicked" }));
                s.close();
                break;
              }
            }
            break;
          }

          case "end-meeting": {
            const info = socketInfo.get(ws);
            if (!info || !info.isAdmin) return;
            const room = rooms.get(info.roomId);
            if (!room) return;

            room.members.forEach((client) => {
              client.send(JSON.stringify({ type: "kicked" }));
              client.close();
            });
            rooms.delete(info.roomId);
            break;
          }

          case "toggle-lock": {
            const info = socketInfo.get(ws);
            if (!info || !info.isAdmin) return;
            const room = rooms.get(info.roomId);
            if (!room) return;

            room.locked = !room.locked;
            room.members.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "room-lock-status", locked: room.locked }));
              }
            });
            break;
          }

          case "signal": {
            const { to, signal } = message;
            const info = socketInfo.get(ws);
            if (!info) return;

            const room = rooms.get(info.roomId);
            if (!room) return;

            room.members.forEach((client) => {
              const clientInfo = socketInfo.get(client);
              if (clientInfo && clientInfo.peerId === to && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: "signal",
                  from: info.peerId,
                  signal
                }));
              }
            });
            break;
          }

          case "chat": {
            const info = socketInfo.get(ws);
            if (!info) return;
            const room = rooms.get(info.roomId);
            if (!room) return;

            room.members.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: "chat",
                  from: info.peerId,
                  senderName: info.name,
                  content: message.content,
                  media: message.media
                }));
              }
            });
            break;
          }
        }
      } catch (e) {
        console.error("WS Message Error:", e);
      }
    });

    ws.on("close", () => {
      const info = socketInfo.get(ws);
      if (info) {
        const { roomId, peerId, isAdmin } = info;
        const room = rooms.get(roomId);
        if (room) {
          room.members.delete(ws);
          room.pending.delete(ws);
          
          if (isAdmin) {
            // Assign new admin
            const nextAdmin = Array.from(room.members)[0];
            if (nextAdmin) {
              room.admin = nextAdmin;
              const nextAdminInfo = socketInfo.get(nextAdmin)!;
              nextAdminInfo.isAdmin = true;
              nextAdmin.send(JSON.stringify({ type: "admin-status", isAdmin: true }));
            } else {
              room.admin = null;
            }
          }

          if (room.members.size === 0 && room.pending.size === 0) {
            rooms.delete(roomId);
          } else {
            room.members.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "peer-left", peerId }));
              }
            });
          }
        }
        socketInfo.delete(ws);
      }
    });
  });

  // Vite middleware for development
  if (!isProduction) {
    console.log("Running in DEVELOPMENT mode (Vite Middleware)");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Running in PRODUCTION mode");
    console.log(`Serving static files from: ${distPath}`);
    
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        const indexPath = path.join(distPath, "index.html");
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send("index.html not found in dist");
        }
      });
    } else {
      console.error("CRITICAL: dist directory not found!");
      app.get("*", (req, res) => {
        res.status(500).send("Production build missing. Please run build first.");
      });
    }
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`NEXUS Server running on http://localhost:${PORT}`);
  });
}

startServer();
