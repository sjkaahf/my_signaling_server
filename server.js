const http = require("http");
const express = require("express");
const cors = require("cors");
const colyseus = require("colyseus");
const schema = require("@colyseus/schema");

const { Schema, type, MapSchema } = schema;

// -----------------------------------------------------------------------------
// Schema Definitions
// -----------------------------------------------------------------------------

class Player extends Schema {
  constructor() {
    super();
    this.slotId = 1;
    this.sessionId = "";
    this.x = 180.0;
    this.y = 573.0;
    this.vx = 0.0;
    this.vy = 0.0;
    this.isGrounded = true;
    this.facingRight = true;
    this.riderOf = "";
    this.riderOffsetX = 0.0;
  }
}
type("number")(Player.prototype, "slotId");
type("string")(Player.prototype, "sessionId");
type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("number")(Player.prototype, "vx");
type("number")(Player.prototype, "vy");
type("boolean")(Player.prototype, "isGrounded");
type("boolean")(Player.prototype, "facingRight");
type("string")(Player.prototype, "riderOf");
type("number")(Player.prototype, "riderOffsetX");

class NekoRoomState extends Schema {
  constructor() {
    super();
    this.roomCode = "";
    this.players = new MapSchema();
  }
}
type("string")(NekoRoomState.prototype, "roomCode");
type({ map: Player })(NekoRoomState.prototype, "players");

// -----------------------------------------------------------------------------
// Room Implementation
// -----------------------------------------------------------------------------

// Các vị trí spawn né vùng cửa (x ≈ 535–617) ở giữa sàn
const SPAWN_SLOTS = [
  { x: 180.0, y: 573.0 },
  { x: 310.0, y: 573.0 },
  { x: 440.0, y: 573.0 },
  { x: 712.0, y: 573.0 },
  { x: 842.0, y: 573.0 },
  { x: 972.0, y: 573.0 },
  { x: 380.0, y: 461.0 },
  { x: 772.0, y: 461.0 },
];

class NekoRoom extends colyseus.Room {
  onCreate(options) {
    this.maxClients = 8;
    this.setState(new NekoRoomState());
    this.state.roomCode = String(options.roomCode || "0000");

    // 30 ticks/giây: cực mượt cho client nội suy, tiết kiệm băng thông tối đa
    this.setPatchRate(1000 / 30);

    // Lắng nghe cập nhật di chuyển từ người chơi
    this.onMessage("move", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (typeof data.x === "number") p.x = data.x;
      if (typeof data.y === "number") p.y = data.y;
      if (typeof data.vx === "number") p.vx = data.vx;
      if (typeof data.vy === "number") p.vy = data.vy;
      if (typeof data.isGrounded === "boolean") p.isGrounded = data.isGrounded;
      if (typeof data.facingRight === "boolean") p.facingRight = data.facingRight;
      if (typeof data.riderOf === "string") p.riderOf = data.riderOf;
      if (typeof data.riderOffsetX === "number") p.riderOffsetX = data.riderOffsetX;
    });

    // Lắng nghe âm thanh / hiệu ứng cần phát tức thì cho các người chơi khác
    this.onMessage("sfx", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (p && data && data.name) {
        this.broadcast("sfx", { id: p.slotId, sessionId: client.sessionId, name: String(data.name) }, { except: client });
      }
    });

    console.log(`[NekoRoom] Phòng ${this.state.roomCode} đã được tạo!`);
  }

  onJoin(client, options) {
    // Tìm slot ID nhỏ nhất chưa ai dùng (từ 1 đến 8)
    const usedIds = new Set();
    this.state.players.forEach((p) => usedIds.add(p.slotId));

    let assignedId = 1;
    for (let i = 1; i <= 8; i++) {
      if (!usedIds.has(i)) {
        assignedId = i;
        break;
      }
    }

    const player = new Player();
    player.slotId = assignedId;
    player.sessionId = client.sessionId;

    const spawn = SPAWN_SLOTS[assignedId - 1] || SPAWN_SLOTS[0];
    player.x = spawn.x;
    player.y = spawn.y;
    player.isGrounded = true;

    this.state.players.set(client.sessionId, player);

    // Báo lại cho chính client biết ID và sessionId của họ
    client.send("init", {
      id: assignedId,
      sessionId: client.sessionId,
      roomCode: this.state.roomCode,
    });

    console.log(
      `[NekoRoom ${this.state.roomCode}] Client ${client.sessionId} tham gia với ID ${assignedId} (Tổng: ${this.state.players.size}/8)`
    );
  }

  onLeave(client, consented) {
    const p = this.state.players.get(client.sessionId);
    const id = p ? p.slotId : "?";
    this.state.players.delete(client.sessionId);

    console.log(
      `[NekoRoom ${this.state.roomCode}] Client ${client.sessionId} (ID ${id}) đã rời phòng (Còn lại: ${this.state.players.size})`
    );
  }

  onDispose() {
    console.log(`[NekoRoom ${this.state.roomCode}] Đã đóng phòng.`);
  }
}

// -----------------------------------------------------------------------------
// Server Setup (Colyseus Server)
// -----------------------------------------------------------------------------

const server = colyseus.defineServer({
  rooms: {
    neko_room: colyseus.defineRoom(NekoRoom).filterBy(["roomCode"]),
  },
});

const PORT = Number(process.env.PORT || 2567);

colyseus.listen(server, PORT).then(() => {
  console.log(`===============================================`);
  console.log(` Neko Park Colyseus Game Server is running!   `);
  console.log(` Port: ${PORT}                                `);
  console.log(` Endpoint: ws://localhost:${PORT}             `);
  console.log(`===============================================`);
});
