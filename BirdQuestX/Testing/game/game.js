// Game configuration
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SQUARE_SIZE = 30;
const MOVE_SPEED = 5;

// Game state
let canvas, ctx;
let menuScreen, gameScreen;
let peer, connection;
let isHost = false;
let roomCode = '';

// Player data
let player1 = {
    x: 100,
    y: 300,
    color: '#4CAF50',
    keys: { w: false, a: false, s: false, d: false }
};

let player2 = {
    x: 700,
    y: 300,
    color: '#2196F3',
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

    menuScreen = document.getElementById('menu-screen');
    gameScreen = document.getElementById('game-screen');

    // Setup menu buttons
    document.getElementById('create-room-btn').addEventListener('click', createRoom);
    document.getElementById('join-code-btn').addEventListener('click', joinRoom);
    document.getElementById('random-match-btn').addEventListener('click', randomMatch);
    document.getElementById('leave-btn').addEventListener('click', leaveGame);

    // Setup keyboard controls
    setupControls();
    
    // Setup mobile controls
    setupMobileControls();

    // Initialize PeerJS
    initPeer();
}

function initPeer() {
    peer = new Peer();
    
    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
    });

    peer.on('connection', (conn) => {
        handleConnection(conn);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        showStatus('Connection error: ' + err.type, 'error');
    });
}

function createRoom() {
    if (!peer || !peer.id) {
        showStatus('Initializing connection...', 'info');
        setTimeout(createRoom, 1000);
        return;
    }

    isHost = true;
    roomCode = peer.id;
    
    document.getElementById('your-room-code').innerHTML = 
        `Your Room Code: <strong>${roomCode}</strong><br>Share this code with your friend!`;
    showStatus('Waiting for player to join...', 'info');
}

function joinRoom() {
    const code = document.getElementById('room-code').value.trim();
    
    if (!code) {
        showStatus('Please enter a room code', 'error');
        return;
    }

    if (!peer || !peer.id) {
        showStatus('Initializing connection...', 'info');
        setTimeout(joinRoom, 1000);
        return;
    }

    isHost = false;
    roomCode = code;
    
    showStatus('Connecting to room...', 'info');
    connection = peer.connect(code);
    handleConnection(connection);
}

function randomMatch() {
    showStatus('Random matching not implemented in demo. Use "Create Room" or "Join with Code" instead.', 'info');
    // In a real implementation, this would connect to a matchmaking server
}

function handleConnection(conn) {
    connection = conn;

    connection.on('open', () => {
        showStatus('Connected! Starting game...', 'success');
        document.getElementById('room-display').textContent = `Room: ${roomCode.substring(0, 8)}...`;
        
        setTimeout(() => {
            startGame();
        }, 1000);
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
        // Update opponent's position
        if (isHost) {
            player2.x = data.x;
            player2.y = data.y;
        } else {
            player1.x = data.x;
            player1.y = data.y;
        }
    }
}

function startGame() {
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
    
    // Reset positions
    player1.x = 100;
    player1.y = 300;
    player2.x = 700;
    player2.y = 300;
    
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

function setupMobileControls() {
    const buttons = document.querySelectorAll('.control-btn');
    
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

function updatePlayer(player) {
    if (player.keys.w) player.y -= MOVE_SPEED;
    if (player.keys.s) player.y += MOVE_SPEED;
    if (player.keys.a) player.x -= MOVE_SPEED;
    if (player.keys.d) player.x += MOVE_SPEED;

    // Keep player in bounds
    player.x = Math.max(0, Math.min(CANVAS_WIDTH - SQUARE_SIZE, player.x));
    player.y = Math.max(0, Math.min(CANVAS_HEIGHT - SQUARE_SIZE, player.y));
}

function sendPosition(player) {
    if (connection && connection.open) {
        connection.send({
            type: 'position',
            x: player.x,
            y: player.y
        });
    }
}

function gameLoop() {
    if (gameScreen.style.display === 'none') return;

    // Update my player
    const myPlayer = isHost ? player1 : player2;
    updatePlayer(myPlayer);
    sendPosition(myPlayer);

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < CANVAS_WIDTH; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, CANVAS_HEIGHT);
        ctx.stroke();
    }
    for (let i = 0; i < CANVAS_HEIGHT; i += 50) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(CANVAS_WIDTH, i);
        ctx.stroke();
    }

    // Draw players
    drawSquare(player1.x, player1.y, player1.color, 'P1');
    drawSquare(player2.x, player2.y, player2.color, 'P2');

    requestAnimationFrame(gameLoop);
}

function drawSquare(x, y, color, label) {
    // Draw square
    ctx.fillStyle = color;
    ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
    
    // Draw border
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
    
    // Draw label
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

function leaveGame() {
    if (connection) {
        connection.close();
    }
    
    gameScreen.style.display = 'none';
    menuScreen.style.display = 'block';
    
    document.getElementById('your-room-code').innerHTML = '';
    document.getElementById('room-code').value = '';
    showStatus('', '');
    
    roomCode = '';
    isHost = false;
}
