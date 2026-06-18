const WebSocket = require('ws');

const port = process.env.PORT || 9090;
const wss = new WebSocket.Server({ port: port }, () => {
    console.log(`Signaling server started on port ${port}`);
});

// Room map matching a string key to an array of peer objects
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

        // Handle joining a room
        if (msg.type === 'join') {
            currentRoom = msg.room || 'default';
            peerId = msg.id;
            
            if (!rooms.has(currentRoom)) {
                rooms.set(currentRoom, []);
            }
            rooms.get(currentRoom).push({ id: peerId, ws: ws });
            
            // Notify others
            rooms.get(currentRoom).forEach(peer => {
                if (peer.id !== peerId) {
                    peer.ws.send(JSON.stringify({ type: 'peer_connected', id: peerId }));
                    ws.send(JSON.stringify({ type: 'peer_connected', id: peer.id }));
                }
            });
        } 
        // Relay WebRTC messages (offers, answers, candidates) to target peer
        else if (msg.to) {
            if (rooms.has(currentRoom)) {
                const target = rooms.get(currentRoom).find(peer => peer.id === msg.to);
                if (target) {
                    msg.from = peerId;
                    target.ws.send(JSON.stringify(msg));
                }
            }
        }
    });

    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            rooms.set(currentRoom, rooms.get(currentRoom).filter(peer => peer.id !== peerId));
            rooms.get(currentRoom).forEach(peer => {
                peer.ws.send(JSON.stringify({ type: 'peer_disconnected', id: peerId }));
            });
            if (rooms.get(currentRoom).length === 0) {
                rooms.delete(currentRoom);
            }
        }
    });
});
