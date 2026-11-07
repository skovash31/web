// Game configuration
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 50;
const MOVE_SPEED = 5;

// Physics configuration
const GRAVITY = 0.6;
const JUMP_FORCE = 13;
const MAX_FALL_SPEED = 15;
const GROUND_TOP_CROP = 75; // ground.png is 100x100 and the grass starts ~75px down (top is transparent)

// Level: everything here is drawn with ground.png and is solid to stand on.
// The floor spans the whole width; the floating ones can be jumped up through
// from below and dropped through by holding S.
const PLATFORMS = [
    { x: 0,   y: 540, w: 800, h: 60, floor: true },
    { x: 90,  y: 410, w: 200, h: 24 },
    { x: 510, y: 410, w: 200, h: 24 },
    { x: 300, y: 280, w: 200, h: 24 }
];
const FLOOR_Y = PLATFORMS[0].y;
const SPAWN = { p1: 100, p2: 650 };
const KO_RESET_DELAY = 3000;
const JOIN_TIMEOUT = 6000;

// Combat configuration
const ATTACK_RANGE = 65;
const ATTACK_DAMAGE = 12;
const ATTACK_DURATION = 200;   // ms the attack pose/hitbox stays active
const ATTACK_COOLDOWN = 450;   // ms before you can attack again
const BLOCK_DAMAGE_MULTIPLIER = 0.25;
const MAX_HEALTH = 100;

// Room code configuration
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, avoids mix-ups
const ROOM_ID_PREFIX = 'bqx-';
const PUBLIC_ROOM_PREFIX = 'bqx-public-';
const PUBLIC_ROOM_SLOTS = 10;

// Game state
let canvas, ctx;
let characterScreen, menuScreen, gameScreen;
let peer, connection;
let isHost = false;
let roomCode = '';
let selectedCharacter = null;
let opponentCharacter = null;
let mainMusic;
let randomMatchActive = false;
let randomMatchSlot = 1;
let joinTimer = null;
let loopRunning = false;
let koTime = 0;

// Sprite images
let sprites = {
    chicken: null
};
let groundImage = null;

// Player data
let player1 = {
    x: SPAWN.p1,
    y: FLOOR_Y - PLAYER_SIZE,
    vx: 0,
    vy: 0,
    onGround: true,
    character: 'chicken',
    facing: 1,
    health: MAX_HEALTH,
    blocking: false,
    attacking: false,
    attackEndTime: 0,
    attackReadyTime: 0,
    hasHitThisSwing: false,
    keys: { w: false, a: false, s: false, d: false }
};

let player2 = {
    x: SPAWN.p2,
    y: FLOOR_Y - PLAYER_SIZE,
    vx: 0,
    vy: 0,
    onGround: true,
    character: 'chicken',
    facing: -1,
    health: MAX_HEALTH,
    blocking: false,
    attacking: false,
    attackEndTime: 0,
    attackReadyTime: 0,
    hasHitThisSwing: false,
    keys: { w: false, a: false, s: false, d: false }
};

// Initialize when page loads
window.addEventListener('load', init);

function init() {
    // Get DOM elements
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    characterScreen = document.getElementById('character-screen');
    menuScreen = document.getElementById('menu-screen');
    gameScreen = document.getElementById('game-screen');
    mainMusic = document.getElementById('main-music');

    // Load sprites
    loadSprites();

    // Setup character selection
    setupCharacterSelection();

    // Setup menu buttons
    document.getElementById('create-room-btn').addEventListener('click', createRoom);
    document.getElementById('join-code-btn').addEventListener('click', joinRoom);
    document.getElementById('random-match-btn').addEventListener('click', randomMatch);
    document.getElementById('leave-btn').addEventListener('click', leaveGame);
    document.getElementById('back-to-character-btn').addEventListener('click', backToCharacterSelect);

    // Setup keyboard controls
    setupControls();

    // Setup mouse controls (left click attack, right click block)
    setupCombatControls();

    // Setup mobile controls
    setupMobileControls();
    setupCombatMobileControls();

    // Music toggle with L key
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'l') {
            if (mainMusic.paused) {
                mainMusic.play().catch(err => console.log('Music play failed:', err));
            } else {
                mainMusic.pause();
            }
        }
    });
}

function loadSprites() {
    sprites.chicken = new Image();
    sprites.chicken.src = '../../BQX assets/Game Assets/Birds/Chicken/Chicken Idle.png';
    groundImage = new Image();
    groundImage.src = '../../BQX assets/Game Assets/ground.png';
}

function setupCharacterSelection() {
    const characterCards = document.querySelectorAll('.character-card');
    const confirmBtn = document.getElementById('confirm-character-btn');

    characterCards.forEach(card => {
        card.addEventListener('click', () => {
            // Remove previous selection
            characterCards.forEach(c => c.classList.remove('selected'));
            // Add selection to clicked card
            card.classList.add('selected');
            selectedCharacter = card.getAttribute('data-character');
            confirmBtn.disabled = false;
        });
    });

    confirmBtn.addEventListener('click', () => {
        if (selectedCharacter) {
            characterScreen.style.display = 'none';
            menuScreen.style.display = 'block';
            // Try to start music
            mainMusic.play().catch(err => console.log('Music play failed:', err));
        }
    });
}

function backToCharacterSelect() {
    randomMatchActive = false;
    closeNetwork();
    menuScreen.style.display = 'none';
    characterScreen.style.display = 'block';
    document.getElementById('your-room-code').innerHTML = '';
    document.getElementById('room-code').value = '';
    showStatus('', '');
}

// Generates a short, easy-to-read room code (e.g. "K7QX")
function generateRoomCode() {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
    }
    return code;
}

function createRoom() {
    randomMatchActive = false;
    closeNetwork();
    isHost = true;

    const code = generateRoomCode();
    showStatus('Creating room...', 'info');

    peer = new Peer(ROOM_ID_PREFIX + code);

    peer.on('open', () => {
        roomCode = code;
        document.getElementById('your-room-code').innerHTML =
            `Your Room Code: <strong>${code}</strong><br>Share this code with your friend!`;
        showStatus('Waiting for player to join...', 'info');
    });

    peer.on('connection', (conn) => {
        handleConnection(conn);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
            // Room code collision - just try again with a fresh code
            createRoom();
        } else {
            showStatus('Connection error: ' + err.type, 'error');
        }
    });
}

function joinRoom() {
    const code = document.getElementById('room-code').value.trim().toUpperCase();

    if (!code) {
        showStatus('Please enter a room code', 'error');
        return;
    }

    randomMatchActive = false;
    closeNetwork();
    isHost = false;
    roomCode = code;

    showStatus('Connecting to room...', 'info');

    peer = new Peer();

    peer.on('open', () => {
        connection = peer.connect(ROOM_ID_PREFIX + code);
        handleConnection(connection);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'peer-unavailable') {
            showStatus('Room not found. Check the code and try again.', 'error');
        } else {
            showStatus('Connection error: ' + err.type, 'error');
        }
    });
}

function randomMatch() {
    closeNetwork();
    randomMatchActive = true;
    randomMatchSlot = 1;
    document.getElementById('your-room-code').innerHTML = '';
    showStatus('Searching for a random player...', 'info');
    claimRandomRoom(randomMatchSlot);
}

function claimRandomRoom(slot) {
    if (!randomMatchActive) return;
    if (slot > PUBLIC_ROOM_SLOTS) {
        randomMatchActive = false;
        showStatus('No random matches are available right now. Please try again.', 'error');
        return;
    }

    closeNetwork();
    randomMatchSlot = slot;
    const currentPeer = new Peer(PUBLIC_ROOM_PREFIX + slot);
    peer = currentPeer;

    currentPeer.on('open', () => {
        if (peer !== currentPeer || !randomMatchActive) return;
        isHost = true;
        roomCode = 'PUBLIC';
        showStatus('Waiting for a random player...', 'info');
    });

    currentPeer.on('connection', (conn) => {
        if (peer !== currentPeer) {
            conn.close();
            return;
        }
        if (connection || !randomMatchActive) {
            conn.on('open', () => {
                conn.send({ type: 'busy' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }

        isHost = true;
        roomCode = 'PUBLIC';
        handleConnection(conn);
    });

    currentPeer.on('error', (err) => {
        if (peer !== currentPeer || !randomMatchActive) return;
        if (err.type === 'unavailable-id') {
            joinRandomRoom(slot);
        } else {
            randomMatchActive = false;
            showStatus('Random match connection error: ' + err.type, 'error');
        }
    });
}

function joinRandomRoom(slot) {
    if (!randomMatchActive) return;
    closeNetwork();
    isHost = false;
    roomCode = 'PUBLIC';

    const currentPeer = new Peer();
    peer = currentPeer;

    currentPeer.on('open', () => {
        if (peer !== currentPeer || !randomMatchActive) return;
        const conn = currentPeer.connect(PUBLIC_ROOM_PREFIX + slot, { reliable: true });
        handleConnection(conn);
        conn.on('open', () => clearJoinTimer());
    });

    // If the player holding this slot never answers (stale slot, or they are
    // already in a match), move on instead of hanging forever.
    clearJoinTimer();
    joinTimer = setTimeout(() => {
        if (peer === currentPeer && randomMatchActive) tryNextRandomRoom(slot);
    }, JOIN_TIMEOUT);

    currentPeer.on('error', (err) => {
        if (peer !== currentPeer || !randomMatchActive) return;
        if (err.type === 'peer-unavailable') {
            tryNextRandomRoom(slot);
        } else {
            randomMatchActive = false;
            showStatus('Random match connection error: ' + err.type, 'error');
        }
    });
}

function clearJoinTimer() {
    if (joinTimer) clearTimeout(joinTimer);
    joinTimer = null;
}

function tryNextRandomRoom(slot) {
    clearJoinTimer();
    if (!randomMatchActive) return;
    randomMatchSlot = slot + 1;
    showStatus('Searching for another random player...', 'info');
    closeNetwork();
    claimRandomRoom(randomMatchSlot);
}

function closeNetwork() {
    clearJoinTimer();
    const oldConnection = connection;
    const oldPeer = peer;
    connection = null;
    peer = null;

    if (oldConnection) oldConnection.close();
    if (oldPeer) oldPeer.destroy();
}

function handleConnection(conn) {
    connection = conn;

    connection.on('open', () => {
        if (connection !== conn) return;
        showStatus('Connected! Exchanging character info...', 'success');
        document.getElementById('room-display').textContent = `Room: ${roomCode}`;

        // Send character selection
        connection.send({
            type: 'character',
            character: selectedCharacter
        });
    });

    connection.on('data', (data) => {
        if (data.type === 'busy' && randomMatchActive) {
            tryNextRandomRoom(randomMatchSlot);
            return;
        }
        handleNetworkData(data);
    });

    connection.on('close', () => {
        if (connection !== conn) return;
        connection = null;
        if (randomMatchActive) {
            if (isHost) {
                showStatus('Waiting for a random player...', 'info');
            } else {
                tryNextRandomRoom(randomMatchSlot);
            }
            return;
        }
        showStatus('Player disconnected', 'error');
        setTimeout(leaveGame, 2000);
    });

    connection.on('error', (err) => {
        console.error('Connection error:', err);
        showStatus('Connection failed', 'error');
    });
}

function handleNetworkData(data) {
    if (data.type === 'position') {
        // Update opponent's synced state
        const opponent = isHost ? player2 : player1;
        opponent.x = data.x;
        opponent.y = data.y;
        opponent.facing = data.facing;
        opponent.attacking = data.attacking;
        opponent.blocking = data.blocking;
        opponent.health = data.health;
    } else if (data.type === 'hit') {
        // Opponent's attack landed on us - we're authoritative over our own health
        const myPlayer = isHost ? player1 : player2;
        if (koTime || myPlayer.health <= 0) return;
        const damage = myPlayer.blocking
            ? Math.round(data.damage * BLOCK_DAMAGE_MULTIPLIER)
            : data.damage;
        myPlayer.health = Math.max(0, myPlayer.health - damage);
    } else if (data.type === 'character') {
        // Receive opponent's character
        opponentCharacter = data.character;
        showStatus('Starting game...', 'success');

        // Set characters
        if (isHost) {
            player1.character = selectedCharacter;
            player2.character = opponentCharacter;
        } else {
            player2.character = selectedCharacter;
            player1.character = opponentCharacter;
        }

        const conn = connection;
        setTimeout(() => {
            if (connection === conn && conn && conn.open) startGame();
        }, 1000);
    }
}

function startGame() {
    // Matched with a random player: free the public slot on the server so other
    // people can use it. disconnect() keeps our existing connection alive.
    if (randomMatchActive && isHost && peer) peer.disconnect();
    randomMatchActive = false;
    clearJoinTimer();
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';

    resetRound();

    if (!loopRunning) {
        loopRunning = true;
        gameLoop();
    }
}

function resetPlayer(player, x, facing) {
    player.x = x;
    player.y = FLOOR_Y - PLAYER_SIZE;
    player.vx = 0;
    player.vy = 0;
    player.onGround = true;
    player.facing = facing;
    player.health = MAX_HEALTH;
    player.blocking = false;
    player.attacking = false;
    player.attackReadyTime = 0;
    player.hasHitThisSwing = false;
}

function resetRound() {
    koTime = 0;
    resetPlayer(player1, SPAWN.p1, 1);
    resetPlayer(player2, SPAWN.p2, -1);
}

function setupControls() {
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        const myPlayer = isHost ? player1 : player2;

        if (key === 'w') myPlayer.keys.w = true;
        if (key === 'a') myPlayer.keys.a = true;
        if (key === 's') myPlayer.keys.s = true;
        if (key === 'd') myPlayer.keys.d = true;
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        const myPlayer = isHost ? player1 : player2;

        if (key === 'w') myPlayer.keys.w = false;
        if (key === 'a') myPlayer.keys.a = false;
        if (key === 's') myPlayer.keys.s = false;
        if (key === 'd') myPlayer.keys.d = false;
    });
}

// Left click = attack, right click (held) = block
function setupCombatControls() {
    // Don't let the browser's right-click menu pop up over the game
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        const myPlayer = isHost ? player1 : player2;

        if (e.button === 0) {
            tryAttack(myPlayer);
        } else if (e.button === 2) {
            myPlayer.blocking = true;
        }
    });

    window.addEventListener('mouseup', (e) => {
        const myPlayer = isHost ? player1 : player2;

        if (e.button === 2) {
            myPlayer.blocking = false;
        }
    });

    // If the mouse leaves the window while holding right click, stop blocking
    window.addEventListener('mouseleave', () => {
        const myPlayer = isHost ? player1 : player2;
        myPlayer.blocking = false;
    });
}

function setupMobileControls() {
    const buttons = document.querySelectorAll('.control-btn[data-key]');

    buttons.forEach(button => {
        const key = button.getAttribute('data-key');

        // Touch start - key down
        button.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const myPlayer = isHost ? player1 : player2;
            myPlayer.keys[key] = true;
        });

        // Touch end - key up
        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            const myPlayer = isHost ? player1 : player2;
            myPlayer.keys[key] = false;
        });

        // Touch cancel - key up
        button.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            const myPlayer = isHost ? player1 : player2;
            myPlayer.keys[key] = false;
        });

        // Also support mouse for testing
        button.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const myPlayer = isHost ? player1 : player2;
            myPlayer.keys[key] = true;
        });

        button.addEventListener('mouseup', (e) => {
            e.preventDefault();
            const myPlayer = isHost ? player1 : player2;
            myPlayer.keys[key] = false;
        });

        button.addEventListener('mouseleave', (e) => {
            const myPlayer = isHost ? player1 : player2;
            myPlayer.keys[key] = false;
        });
    });
}

// Mobile equivalents of left-click attack / right-click block
function setupCombatMobileControls() {
    const attackBtn = document.getElementById('attack-btn');
    const blockBtn = document.getElementById('block-btn');

    if (attackBtn) {
        const doAttack = (e) => {
            e.preventDefault();
            const myPlayer = isHost ? player1 : player2;
            tryAttack(myPlayer);
        };
        attackBtn.addEventListener('touchstart', doAttack);
        attackBtn.addEventListener('mousedown', doAttack);
    }

    if (blockBtn) {
        const setBlocking = (value) => (e) => {
            e.preventDefault();
            const myPlayer = isHost ? player1 : player2;
            myPlayer.blocking = value;
        };
        blockBtn.addEventListener('touchstart', setBlocking(true));
        blockBtn.addEventListener('touchend', setBlocking(false));
        blockBtn.addEventListener('touchcancel', setBlocking(false));
        blockBtn.addEventListener('mousedown', setBlocking(true));
        blockBtn.addEventListener('mouseup', setBlocking(false));
        blockBtn.addEventListener('mouseleave', setBlocking(false));
    }
}

function tryAttack(player) {
    if (koTime) return;
    const now = Date.now();
    if (player.attacking || now < (player.attackReadyTime || 0)) return;

    player.attacking = true;
    player.attackEndTime = now + ATTACK_DURATION;
    player.attackReadyTime = now + ATTACK_COOLDOWN;
    player.hasHitThisSwing = false;
}

function overlaps(a, b) {
    return a.x < b.x + PLAYER_SIZE && a.x + PLAYER_SIZE > b.x &&
           a.y < b.y + PLAYER_SIZE && a.y + PLAYER_SIZE > b.y;
}

function clampX(player) {
    player.x = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_SIZE, player.x));
}

function updatePlayer(player, opponent) {
    // --- Walking ---
    const dir = (player.keys.d ? 1 : 0) - (player.keys.a ? 1 : 0);
    player.vx = dir * MOVE_SPEED;
    // Walking right (forward) shows the image normally, walking left (backwards) flips it.
    if (dir !== 0) player.facing = dir;

    player.x += player.vx;
    clampX(player);

    // Bump into the other bird sideways
    if (overlaps(player, opponent)) {
        player.x = player.x < opponent.x ? opponent.x - PLAYER_SIZE : opponent.x + PLAYER_SIZE;
        clampX(player);
    }

    // --- Jumping ---
    if (player.keys.w && player.onGround) {
        player.vy = -JUMP_FORCE;
        player.onGround = false;
    }

    // --- Gravity: always pulling down, only ground stops it ---
    player.vy = Math.min(player.vy + GRAVITY, MAX_FALL_SPEED);
    const prevY = player.y;
    const prevBottom = prevY + PLAYER_SIZE;
    player.y += player.vy;
    const bottom = player.y + PLAYER_SIZE;
    player.onGround = false;

    if (player.vy >= 0) {
        // Land on a ground.png platform we were above last frame
        for (const p of PLATFORMS) {
            if (!p.floor && player.keys.s) continue; // hold S to drop through
            const overX = player.x + PLAYER_SIZE > p.x && player.x < p.x + p.w;
            if (overX && prevBottom <= p.y + 0.01 && bottom >= p.y) {
                player.y = p.y - PLAYER_SIZE;
                player.vy = 0;
                player.onGround = true;
                break;
            }
        }

        // Land on the other bird's head
        if (!player.onGround && overlaps(player, opponent) && prevBottom <= opponent.y + 0.01) {
            player.y = opponent.y - PLAYER_SIZE;
            player.vy = 0;
            player.onGround = true;
        }
    } else if (overlaps(player, opponent) && prevY >= opponent.y + PLAYER_SIZE - 0.01) {
        // Bonk head on the bird above
        player.y = opponent.y + PLAYER_SIZE;
        player.vy = 0;
    }

    // Still stuck inside the other bird (e.g. they landed on us): push out sideways
    if (overlaps(player, opponent)) {
        player.x = player.x < opponent.x ? opponent.x - PLAYER_SIZE : opponent.x + PLAYER_SIZE;
        clampX(player);
    }

    if (player.y < 0) {
        player.y = 0;
        player.vy = Math.max(0, player.vy);
    }

    // Fell out of the world somehow: respawn on the floor
    if (player.y > CANVAS_HEIGHT) {
        player.x = player === player1 ? SPAWN.p1 : SPAWN.p2;
        player.y = FLOOR_Y - PLAYER_SIZE;
        player.vy = 0;
    }

    // End the attack pose once its window is over
    if (player.attacking && Date.now() > player.attackEndTime) {
        player.attacking = false;
    }
}

function checkAttackHit(myPlayer, opponent) {
    if (!myPlayer.attacking || myPlayer.hasHitThisSwing) return;

    if (koTime) return;
    const dx = opponent.x - myPlayer.x;
    const dy = opponent.y - myPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // Only hit birds in front of you (the way you're facing)
    const inFront = dx * myPlayer.facing >= -PLAYER_SIZE / 4;

    if (distance <= ATTACK_RANGE && inFront) {
        myPlayer.hasHitThisSwing = true;
        if (connection && connection.open) {
            connection.send({ type: 'hit', damage: ATTACK_DAMAGE });
        }
    }
}

function sendState(player) {
    if (connection && connection.open) {
        connection.send({
            type: 'position',
            x: player.x,
            y: player.y,
            facing: player.facing,
            attacking: player.attacking,
            blocking: player.blocking,
            health: player.health
        });
    }
}

function gameLoop() {
    if (gameScreen.style.display === 'none') {
        loopRunning = false;
        return;
    }

    // Update my player
    const myPlayer = isHost ? player1 : player2;
    const opponent = isHost ? player2 : player1;

    // Someone got K.O.'d: freeze for a moment, then start a new round
    if (!koTime && (player1.health <= 0 || player2.health <= 0)) koTime = Date.now();
    if (koTime && Date.now() - koTime > KO_RESET_DELAY) resetRound();

    if (koTime) {
        myPlayer.keys.a = myPlayer.keys.d = myPlayer.keys.w = false;
        myPlayer.attacking = false;
    }
    updatePlayer(myPlayer, opponent);
    checkAttackHit(myPlayer, opponent);
    sendState(myPlayer);

    // Clear canvas with sky gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(0.5, '#E0F6FF');
    gradient.addColorStop(1, '#90EE90');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw clouds
    drawClouds();

    // Draw the ground platforms
    drawGround();

    // Draw players
    drawBird(player1, 'P1');
    drawBird(player2, 'P2');

    drawKOOverlay();

    requestAnimationFrame(gameLoop);
}

function drawClouds() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    // Simple cloud shapes
    const time = Date.now() * 0.0001;
    for (let i = 0; i < 5; i++) {
        const x = ((time * 20 + i * 200) % (CANVAS_WIDTH + 100)) - 50;
        const y = 50 + i * 80;
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, Math.PI * 2);
        ctx.arc(x + 25, y, 35, 0, Math.PI * 2);
        ctx.arc(x + 50, y, 30, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawGround() {
    const img = groundImage;
    const ready = img && img.complete && img.naturalWidth;
    for (const p of PLATFORMS) {
        if (ready) {
            ctx.imageSmoothingEnabled = false;
            // Skip the transparent top part of ground.png so the grass sits exactly on p.y
            const srcY = img.naturalHeight * GROUND_TOP_CROP / 100;
            const srcH = img.naturalHeight - srcY;
            const tile = p.h * (img.naturalWidth / srcH); // keep the tile's aspect ratio
            for (let tx = p.x; tx < p.x + p.w; tx += tile) {
                const w = Math.min(tile, p.x + p.w - tx);
                ctx.drawImage(img, 0, srcY, img.naturalWidth * (w / tile), srcH, tx, p.y, w, p.h);
            }
        } else {
            ctx.fillStyle = '#8B5A2B';
            ctx.fillRect(p.x, p.y, p.w, p.h);
            ctx.fillStyle = '#2E9E3E';
            ctx.fillRect(p.x, p.y, p.w, 4);
        }
    }
}

function drawBird(player, label) {
    const { x, y, character, facing, attacking, blocking, health } = player;
    const sprite = sprites[character];

    ctx.save();

    // Flip the sprite horizontally when facing left
    if (facing === -1) {
        ctx.translate(x + PLAYER_SIZE, y);
        ctx.scale(-1, 1);
    } else {
        ctx.translate(x, y);
    }

    if (sprite && sprite.complete) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, 0, 0, PLAYER_SIZE, PLAYER_SIZE);
    } else {
        // Fallback if sprite not loaded
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(0, 0, PLAYER_SIZE, PLAYER_SIZE);
    }

    // Blocking shield overlay
    if (blocking) {
        ctx.fillStyle = 'rgba(80, 170, 255, 0.45)';
        ctx.fillRect(0, 0, PLAYER_SIZE, PLAYER_SIZE);
        ctx.strokeStyle = '#3fa9f5';
        ctx.lineWidth = 3;
        ctx.strokeRect(1, 1, PLAYER_SIZE - 2, PLAYER_SIZE - 2);
    }

    // Attack swipe, drawn in front of the direction the bird is facing
    if (attacking) {
        ctx.fillStyle = 'rgba(255, 60, 60, 0.85)';
        ctx.beginPath();
        ctx.moveTo(PLAYER_SIZE, PLAYER_SIZE * 0.15);
        ctx.lineTo(PLAYER_SIZE + 22, PLAYER_SIZE * 0.5);
        ctx.lineTo(PLAYER_SIZE, PLAYER_SIZE * 0.85);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();

    // Border (unflipped, in world coordinates)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, PLAYER_SIZE, PLAYER_SIZE);

    // Label
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeText(label, x + PLAYER_SIZE / 2, y - 34);
    ctx.fillText(label, x + PLAYER_SIZE / 2, y - 34);

    // Health bar
    const barWidth = PLAYER_SIZE;
    const barHeight = 6;
    const barX = x;
    const barY = y - 18;
    const pct = Math.max(0, health) / MAX_HEALTH;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = pct > 0.5 ? '#4CAF50' : pct > 0.2 ? '#FFC107' : '#F44336';
    ctx.fillRect(barX, barY, barWidth * pct, barHeight);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
}

function drawKOOverlay() {
    let winner = null;
    if (player1.health <= 0) winner = 'P2';
    else if (player2.health <= 0) winner = 'P1';
    if (!winner) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('K.O.', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
    ctx.font = 'bold 24px Arial';
    ctx.fillText(winner + ' wins!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30);
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('connection-status');
    statusDiv.textContent = message;
    statusDiv.style.background =
        type === 'error' ? 'rgba(244, 67, 54, 0.3)' :
        type === 'success' ? 'rgba(76, 175, 80, 0.3)' :
        'rgba(255, 255, 255, 0.2)';
}

function leaveGame() {
    randomMatchActive = false;
    koTime = 0;
    closeNetwork();

    gameScreen.style.display = 'none';
    characterScreen.style.display = 'block';

    document.getElementById('your-room-code').innerHTML = '';
    document.getElementById('room-code').value = '';
    showStatus('', '');

    roomCode = '';
    isHost = false;
    selectedCharacter = null;
    opponentCharacter = null;

    // Reset character selection
    document.querySelectorAll('.character-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('confirm-character-btn').disabled = true;
}
