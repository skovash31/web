// Game configuration
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SQUARE_SIZE = 30;
const MOVE_SPEED = 5;
const PEER_PREFIX = 'bqx-';
const PUBLIC_PREFIX = 'bqx-public-';
const PUBLIC_SLOTS = 10;
const MAX_HP = 100;
const ATTACK_RANGE = 60;      // distance between centers that counts as a hit
const ATTACK_DURATION = 200;  // ms the attack is active
const ATTACK_COOLDOWN = 500;  // ms between attacks
const ATTACK_DAMAGE = 10;

// Game state
let canvas, ctx;
let characterScreen, menuScreen, gameScreen;
let peer, connection;
let isHost = false;
let roomCode = '';
let selectedCharacter = null;
let gameRunning = false;
let roundOver = false;
let resultText = '';

// Player data
const newKeys = () => ({ w: false, a: false, s: false, d: false, attack: false, block: false });

const makePlayer = (x, color) => ({
    x, y: 300, color, keys: newKeys(),
    hp: MAX_HP, attacking: false, lastAttack: 0, hitDone: false
});

let player1 = makePlayer(100, '#4CAF50');
let player2 = makePlayer(700, '#2196F3');

function resetPlayers() {
    Object.assign(player1, makePlayer(100, '#4CAF50'));
    Object.assign(player2, makePlayer(700, '#2196F3'));
}

const myPlayer = () => (isHost ? player1 : player2);

window.addEventListener('load', init);

function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    characterScreen = document.getElementById('character-screen');
    menuScreen = document.getElementById('menu-screen');
    gameScreen = document.getElementById('game-screen');

    // Character select
    const confirmBtn = document.getElementById('confirm-character-btn');
    document.querySelectorAll('.character-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.character-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedCharacter = card.dataset.character;
            confirmBtn.disabled = false;
        });
    });
    confirmBtn.addEventListener('click', () => {
        characterScreen.style.display = 'none';
        menuScreen.style.display = 'block';
    });
    document.getElementById('back-to-character-btn').addEventListener('click', () => {
        closeNetwork();
        menuScreen.style.display = 'none';
        characterScreen.style.display = 'flex';
    });

    // Menu buttons
    document.getElementById('create-room-btn').addEventListener('click', createRoom);
    document.getElementById('join-code-btn').addEventListener('click', joinRoom);
    document.getElementById('random-match-btn').addEventListener('click', randomMatch);
    document.getElementById('leave-btn').addEventListener('click', leaveGame);

    setupControls();
    setupMobileControls();

    // Music starts on first tap/click (browsers block autoplay)
    const music = document.getElementById('main-music');
    const startMusic = () => { music.play().catch(() => {}); };
    window.addEventListener('pointerdown', startMusic, { once: true });
}

/* ---------- Networking ---------- */

function closeNetwork() {
    if (connection) { try { connection.close(); } catch (e) {} connection = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
}

function makeCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
    return code;
}

function createRoom() {
    closeNetwork();
    isHost = true;
    roomCode = makeCode();
    showStatus('Creating room...', 'info');

    peer = new Peer(PEER_PREFIX + roomCode);

    peer.on('open', () => {
        document.getElementById('your-room-code').innerHTML =
            `Your Room Code: <strong>${roomCode}</strong><br>Share this code with your friend!`;
        showStatus('Waiting for player to join...', 'info');
    });

    peer.on('connection', (conn) => {
        if (connection && connection.open) { conn.close(); return; }
        handleConnection(conn);
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') { createRoom(); return; } // code taken, pick another
        showStatus('Connection error: ' + err.type, 'error');
    });
}

function joinRoom() {
    const code = document.getElementById('room-code').value.trim().toUpperCase();
    if (code.length !== 4) {
        showStatus('Please enter a 4-letter room code', 'error');
        return;
    }

    closeNetwork();
    isHost = false;
    roomCode = code;
    document.getElementById('your-room-code').innerHTML = '';
    showStatus('Connecting to room...', 'info');

    peer = new Peer();

    peer.on('open', () => {
        handleConnection(peer.connect(PEER_PREFIX + code));
    });

    peer.on('error', (err) => {
        showStatus(err.type === 'peer-unavailable' ? 'Room not found' : 'Connection error: ' + err.type, 'error');
    });
}

function randomMatch() {
    closeNetwork();
    document.getElementById('your-room-code').innerHTML = '';
    showStatus('Searching for a public game...', 'info');
    claimSlot(1);
}

// Try to become the waiting host of a public slot; if it is taken, try to join it
function claimSlot(slot) {
    if (slot > PUBLIC_SLOTS) {
        showStatus('All public servers are busy. Try again in a moment.', 'error');
        return;
    }

    closeNetwork();
    const p = new Peer(PUBLIC_PREFIX + slot);
    peer = p;

    p.on('open', () => {
        isHost = true;
        roomCode = 'PUBLIC';
        showStatus('Waiting for a random player...', 'info');
    });

    p.on('connection', (conn) => {
        if (connection && connection.open) {
            conn.on('open', () => {
                conn.send({ type: 'busy' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        handleConnection(conn);
    });

    p.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            joinSlot(slot);
        } else {
            showStatus('Connection error: ' + err.type, 'error');
        }
    });
}

// Join the player already waiting in a public slot
function joinSlot(slot) {
    closeNetwork();
    isHost = false;
    roomCode = 'PUBLIC';
    const p = new Peer();
    peer = p;
    let done = false;

    const next = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        closeNetwork();
        claimSlot(slot + 1);
    };
    const timer = setTimeout(next, 5000);

    p.on('open', () => {
        const conn = p.connect(PUBLIC_PREFIX + slot);
        handleConnection(conn);
        conn.on('data', (d) => {
            if (d.type === 'busy') next(); // that server already has a match
        });
        conn.on('open', () => clearTimeout(timer));
    });

    p.on('error', () => { if (!gameRunning) next(); });
}

function handleConnection(conn) {
    connection = conn;

    conn.on('open', () => {
        showStatus('Connected! Starting game...', 'success');
        document.getElementById('room-display').textContent = `Room: ${roomCode}`;
        setTimeout(() => { if (connection === conn && conn.open) startGame(); }, 800);
    });

    conn.on('data', handleNetworkData);

    conn.on('close', () => {
        if (gameRunning) {
            showStatus('Player disconnected', 'error');
            leaveGame();
        }
    });

    conn.on('error', (err) => {
        console.error('Connection error:', err);
        showStatus('Connection failed', 'error');
    });
}

function handleNetworkData(data) {
    const opponent = isHost ? player2 : player1;

    if (data.type === 'state') {
        opponent.x = data.x;
        opponent.y = data.y;
        opponent.keys.block = !!data.block;
        opponent.attacking = !!data.attacking;
    } else if (data.type === 'hit') {
        takeHit(data.damage || ATTACK_DAMAGE);
    } else if (data.type === 'gameover') {
        endRound(true); // opponent died, I win
    }
}

function sendState(player) {
    send({
        type: 'state',
        x: player.x,
        y: player.y,
        block: player.keys.block,
        attacking: player.attacking
    });
}

function send(msg) {
    if (connection && connection.open) connection.send(msg);
}

/* ---------- Game ---------- */

function startGame() {
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';

    resetPlayers();
    roundOver = false;
    resultText = '';

    if (!gameRunning) {
        gameRunning = true;
        gameLoop();
    }
}

function leaveGame() {
    gameRunning = false;
    closeNetwork();

    gameScreen.style.display = 'none';
    menuScreen.style.display = 'block';

    document.getElementById('your-room-code').innerHTML = '';
    document.getElementById('room-code').value = '';
    showStatus('', '');

    roomCode = '';
    isHost = false;
}

/* ---------- Controls ---------- */

function setupControls() {
    const map = { w: 'w', a: 'a', s: 's', d: 'd', ' ': 'attack', b: 'block' };

    window.addEventListener('keydown', (e) => {
        const action = map[e.key.toLowerCase()];
        if (!action) return;
        if (e.key === ' ') e.preventDefault();
        myPlayer().keys[action] = true;
    });

    window.addEventListener('keyup', (e) => {
        const action = map[e.key.toLowerCase()];
        if (!action) return;
        myPlayer().keys[action] = false;
    });
}

function setupMobileControls() {
    // Each button: [element, action name]
    const binds = [];
    document.querySelectorAll('#mobile-controls .control-btn[data-key]').forEach(btn => {
        binds.push([btn, btn.dataset.key]);
    });
    binds.push([document.getElementById('attack-btn'), 'attack']);
    binds.push([document.getElementById('block-btn'), 'block']);

    binds.forEach(([btn, action]) => {
        const press = (e) => { e.preventDefault(); myPlayer().keys[action] = true; btn.classList.add('pressed'); };
        const release = (e) => { e.preventDefault(); myPlayer().keys[action] = false; btn.classList.remove('pressed'); };

        btn.addEventListener('touchstart', press, { passive: false });
        btn.addEventListener('touchend', release, { passive: false });
        btn.addEventListener('touchcancel', release, { passive: false });
        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup', release);
        btn.addEventListener('mouseleave', release);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
}

/* ---------- Combat ---------- */

function updateCombat(me) {
    const opponent = isHost ? player2 : player1;
    const now = performance.now();

    // Start an attack (can't attack while blocking)
    if (me.keys.attack && !me.keys.block && now - me.lastAttack >= ATTACK_COOLDOWN) {
        me.lastAttack = now;
        me.hitDone = false;
    }
    me.attacking = now - me.lastAttack < ATTACK_DURATION && me.lastAttack > 0;

    // Check for a hit once per swing; the victim decides if they blocked it
    if (me.attacking && !me.hitDone) {
        const dx = (me.x - opponent.x);
        const dy = (me.y - opponent.y);
        if (Math.hypot(dx, dy) <= ATTACK_RANGE) {
            me.hitDone = true;
            send({ type: 'hit', damage: ATTACK_DAMAGE });
        }
    }
}

function takeHit(damage) {
    const me = myPlayer();
    if (roundOver || me.keys.block) return; // blocked
    me.hp = Math.max(0, me.hp - damage);
    if (me.hp === 0) {
        send({ type: 'gameover' });
        endRound(false);
    }
}

function endRound(iWon) {
    if (roundOver) return;
    roundOver = true;
    resultText = iWon ? 'You Win!' : 'You Lose!';
    setTimeout(() => {
        if (!gameRunning) return;
        resetPlayers();
        roundOver = false;
        resultText = '';
    }, 3000);
}

/* ---------- Loop & drawing ---------- */

function updatePlayer(player) {
    if (player.keys.w) player.y -= MOVE_SPEED;
    if (player.keys.s) player.y += MOVE_SPEED;
    if (player.keys.a) player.x -= MOVE_SPEED;
    if (player.keys.d) player.x += MOVE_SPEED;

    player.x = Math.max(0, Math.min(CANVAS_WIDTH - SQUARE_SIZE, player.x));
    player.y = Math.max(0, Math.min(CANVAS_HEIGHT - SQUARE_SIZE, player.y));
}

function gameLoop() {
    if (!gameRunning) return;

    const me = myPlayer();
    if (!roundOver) {
        updatePlayer(me);
        updateCombat(me);
    } else {
        me.attacking = false;
    }
    sendState(me);

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < CANVAS_WIDTH; i += 50) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_HEIGHT); ctx.stroke();
    }
    for (let i = 0; i < CANVAS_HEIGHT; i += 50) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(CANVAS_WIDTH, i); ctx.stroke();
    }

    drawSquare(player1, 'P1');
    drawSquare(player2, 'P2');

    if (roundOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(resultText, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    }

    requestAnimationFrame(gameLoop);
}

function drawSquare(player, label) {
    const { x, y, color, keys, hp, attacking } = player;

    ctx.fillStyle = color;
    ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, SQUARE_SIZE, SQUARE_SIZE);

    if (keys.block) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 4;
        ctx.strokeRect(x - 6, y - 6, SQUARE_SIZE + 12, SQUARE_SIZE + 12);
    }

    if (attacking) {
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + SQUARE_SIZE / 2, y + SQUARE_SIZE / 2, SQUARE_SIZE * 1.3, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Health bar
    ctx.fillStyle = '#400';
    ctx.fillRect(x - 10, y - 14, SQUARE_SIZE + 20, 6);
    ctx.fillStyle = hp > 30 ? '#4CAF50' : '#f44336';
    ctx.fillRect(x - 10, y - 14, (SQUARE_SIZE + 20) * (hp / MAX_HP), 6);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + SQUARE_SIZE / 2, y + SQUARE_SIZE / 2);
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('connection-status');
    statusDiv.textContent = message;
    statusDiv.style.background =
        type === 'error' ? 'rgba(244, 67, 54, 0.3)' :
        type === 'success' ? 'rgba(76, 175, 80, 0.3)' :
        'rgba(255, 255, 255, 0.2)';
}
