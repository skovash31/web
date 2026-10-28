// Game configuration
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 50;
const MOVE_SPEED = 5;

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

// Game state
let canvas, ctx;
let characterScreen, menuScreen, gameScreen;
let peer, connection;
let isHost = false;
let roomCode = '';
let selectedCharacter = null;
let opponentCharacter = null;
let mainMusic;

// Sprite images
let sprites = {
    chicken: null
};

// Player data
let player1 = {
    x: 100,
    y: 300,
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
    x: 700,
    y: 300,
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
    isHost = true;

    if (peer) {
        peer.destroy();
    }

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

    isHost = false;
    roomCode = code;

    if (peer) {
        peer.destroy();
    }

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
    showStatus('Random matching not implemented in demo. Use "Create Room" or "Join with Code" instead.', 'info');
    // In a real implementation, this would connect to a matchmaking server
}

function handleConnection(conn) {
    connection = conn;

    connection.on('open', () => {
        showStatus('Connected! Exchanging character info...', 'success');
        document.getElementById('room-display').textContent = `Room: ${roomCode}`;

        // Send character selection
        connection.send({
            type: 'character',
            character: selectedCharacter
        });
    });

    connection.on('data', (data) => {
        handleNetworkData(data);
    });

    connection.on('close', () => {
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

        setTimeout(() => {
            startGame();
        }, 1000);
    }
}

function startGame() {
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';

    // Reset player state
    player1.x = 100;
    player1.y = 300;
    player1.facing = 1;
    player1.health = MAX_HEALTH;
    player1.blocking = false;
    player1.attacking = false;
    player1.attackReadyTime = 0;

    player2.x = 700;
    player2.y = 300;
    player2.facing = -1;
    player2.health = MAX_HEALTH;
    player2.blocking = false;
    player2.attacking = false;
    player2.attackReadyTime = 0;

    gameLoop();
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
    const now = Date.now();
    if (player.attacking || now < (player.attackReadyTime || 0)) return;

    player.attacking = true;
    player.attackEndTime = now + ATTACK_DURATION;
    player.attackReadyTime = now + ATTACK_COOLDOWN;
    player.hasHitThisSwing = false;
}

function updatePlayer(player) {
    if (player.keys.w) player.y -= MOVE_SPEED;
    if (player.keys.s) player.y += MOVE_SPEED;
    // Moving left/right also sets which way the bird is facing -
    // e.g. if it was facing right and you move left (backwards), it flips.
    if (player.keys.a) {
        player.x -= MOVE_SPEED;
        player.facing = -1;
    }
    if (player.keys.d) {
        player.x += MOVE_SPEED;
        player.facing = 1;
    }

    // Keep player in bounds
    player.x = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_SIZE, player.x));
    player.y = Math.max(0, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, player.y));

    // End the attack pose once its window is over
    if (player.attacking && Date.now() > player.attackEndTime) {
        player.attacking = false;
    }
}

function checkAttackHit(myPlayer, opponent) {
    if (!myPlayer.attacking || myPlayer.hasHitThisSwing) return;

    const dx = opponent.x - myPlayer.x;
    const dy = opponent.y - myPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= ATTACK_RANGE) {
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
    if (gameScreen.style.display === 'none') return;

    // Update my player
    const myPlayer = isHost ? player1 : player2;
    const opponent = isHost ? player2 : player1;

    updatePlayer(myPlayer);
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
    if (connection) {
        connection.close();
    }

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
