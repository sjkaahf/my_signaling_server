const WebSocket = require('ws');

const port = process.env.PORT || 9090;
const wss = new WebSocket.Server({ port: port }, () => {
    console.log(`Godot WebRTC Signaling Server started on port ${port}`);
});

// We need to generate a unique numerical ID for every player who joins
let nextPeerId = 1; 
const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = null;
    let peerId = null;

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            return; // Ignore invalid data
        }

        // 0 = JOIN (Player wants to enter a lobby)
        if (msg.type === 0) {
            if (currentRoom) return; 

            currentRoom = msg.data || 'default';
            
            if (!rooms.has(currentRoom)) {
                rooms.set(currentRoom, { sealed: false, peers: new Map() });
            }

            const room = rooms.get(currentRoom);

            if (room.sealed) {
                ws.close();
                return;
            }

            // Assign the player a unique ID
            peerId = nextPeerId++;
            room.peers.set(peerId, ws);

            // Send Type 1: Tell the player their assigned ID
            ws.send(JSON.stringify({ id: peerId, type: 1, data: "" }));
            
            // Send Type 0: Confirm the successful JOIN back to the player
            ws.send(JSON.stringify({ id: 0, type: 0, data: currentRoom }));

            // Send Type 2 (PEER_CONNECT): Introduce the players to each other
            room.peers.forEach((otherWs, otherId) => {
                if (otherId !== peerId) {
                    // Tell the old player about the new player
                    otherWs.send(JSON.stringify({ id: peerId, type: 2, data: "" }));
                    // Tell the new player about the old player
                    ws.send(JSON.stringify({ id: otherId, type: 2, data: "" }));
                }
            });
        }
        // 7 = SEAL (Lock the room so no one else can join)
        else if (msg.type === 7) {
            if (currentRoom && rooms.has(currentRoom)) {
                rooms.get(currentRoom).sealed = true;
                
                // Confirm the seal back to the client
                ws.send(JSON.stringify({ id: 0, type: 7, data: "" }));
                
                // Destroy the room and disconnect players after 10 seconds
                setTimeout(() => {
                    if (rooms.has(currentRoom)) {
                        rooms.get(currentRoom).peers.forEach(p => p.close());
                        rooms.delete(currentRoom);
                    }
                }, 10000);
            }
        }
        // 4, 5, 6 = Relayed WebRTC handshake messages (OFFER, ANSWER, CANDIDATE)
        else if (msg.type === 4 || msg.type === 5 || msg.type === 6) {
            if (currentRoom && rooms.has(currentRoom)) {
                // Find the specific player this message is meant for
                const targetWs = rooms.get(currentRoom).peers.get(msg.id);
                if (targetWs) {
                    // Replace the target ID with the sender's ID so the target knows who it's from
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

            // Notify all remaining players that someone left
            room.peers.forEach((otherWs) => {
                otherWs.send(JSON.stringify({ id: peerId, type: 3, data: "" }));
            });

            // Clean up the room if it's empty
            if (room.peers.size === 0) {
                rooms.delete(currentRoom);
            }
        }
    });
});
