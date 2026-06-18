const WebSocket = require('ws');

const port = process.env.PORT || 9090;
const wss = new WebSocket.Server({ port: port }, () => {
    console.log(`Godot WebRTC Signaling Server started on port ${port}`);
});

const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = null;
    let peerId = null;

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            return;
        }

        // 0 = JOIN
        if (msg.type === 0) {
            if (currentRoom) return; 

            currentRoom = msg.data || 'default';
            
            // If the room doesn't exist, create it and give it a dedicated ID counter starting at 1
            if (!rooms.has(currentRoom)) {
                rooms.set(currentRoom, { sealed: false, nextId: 1, peers: new Map() });
            }

            const room = rooms.get(currentRoom);

            if (room.sealed) {
                ws.close();
                return;
            }

            // Assign the player a unique ID specific to THIS room
            peerId = room.nextId++;
            room.peers.set(peerId, ws);

            ws.send(JSON.stringify({ id: peerId, type: 1, data: "" }));
            ws.send(JSON.stringify({ id: 0, type: 0, data: currentRoom }));

            room.peers.forEach((otherWs, otherId) => {
                if (otherId !== peerId) {
                    otherWs.send(JSON.stringify({ id: peerId, type: 2, data: "" }));
                    ws.send(JSON.stringify({ id: otherId, type: 2, data: "" }));
                }
            });
        }
        // 7 = SEAL
        else if (msg.type === 7) {
            if (currentRoom && rooms.has(currentRoom)) {
                rooms.get(currentRoom).sealed = true;
                ws.send(JSON.stringify({ id: 0, type: 7, data: "" }));
                setTimeout(() => {
                    if (rooms.has(currentRoom)) {
                        rooms.get(currentRoom).peers.forEach(p => p.close());
                        rooms.delete(currentRoom);
                    }
                }, 10000);
            }
        }
        // 4, 5, 6 = OFFER, ANSWER, CANDIDATE
        else if (msg.type === 4 || msg.type === 5 || msg.type === 6) {
            if (currentRoom && rooms.has(currentRoom)) {
                const targetWs = rooms.get(currentRoom).peers.get(msg.id);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        id: peerId,    
                        type: msg.type,
                        data: msg.data
                    }));
                }
            }
        }
    });

    // 3 = PEER_DISCONNECT
    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            room.peers.delete(peerId);

            room.peers.forEach((otherWs) => {
                otherWs.send(JSON.stringify({ id: peerId, type: 3, data: "" }));
            });

            if (room.peers.size === 0) {
                rooms.delete(currentRoom);
            }
        }
    });
});
