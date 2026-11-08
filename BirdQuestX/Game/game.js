'use strict';

import {
    get,
    onValue,
    off,
    auth,
    database,
    onAuthStateChanged,
    ref,
    remove,
    runTransaction,
    serverTimestamp,
    set,
    update,
    updateProfile
} from "../accounts/firebase.js";

/* =====================================================================
   Config
   ===================================================================== */

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 50;
const MOVE_SPEED = 5;

// Physics
const GRAVITY = 0.6;
const JUMP_FORCE = 13;
const MAX_FALL_SPEED = 15;
const GROUND_TOP_CROP = 75; // ground.png is 100x100 and the grass starts ~75px down (top is transparent)

// Level: everything here is drawn with ground.png and can be stood on.
// The floor spans the whole width; floating ones can be jumped up through
// from below and dropped through by holding S.
const PLATFORMS = [
    { x: 0,   y: 540, w: 800, h: 60, floor: true },
    { x: 90,  y: 410, w: 200, h: 24 },
    { x: 510, y: 410, w: 200, h: 24 },
    { x: 300, y: 280, w: 200, h: 24 }
];
const FLOOR_Y = PLATFORMS[0].y;
const SPAWN = { p1: 100, p2: 650 };

// Combat
const ATTACK_RANGE = 65;
const ATTACK_DAMAGE = 12;
const ATTACK_DURATION = 200;   // ms the attack pose/hitbox stays active
const ATTACK_COOLDOWN = 450;   // ms before you can attack again
const BLOCK_DAMAGE_MULTIPLIER = 0.25;
const MAX_HEALTH = 100;

// Match: best of 3 rounds
const ROUNDS_TO_WIN = 2;
const ROUND_INTRO_TIME = 1500;  // "Round 2 ... Fight!" freeze
const ROUND_END_DELAY = 2500;   // K.O. screen before next round
const MATCH_OVER_DELAY = 1200;  // K.O. screen before the results popup

// Networking
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, avoids mix-ups
const ROOM_ID_PREFIX = 'bqx-';
const PUBLIC_ROOM_PREFIX = 'bqx-public-';
const PUBLIC_ROOM_SLOTS = 10;
const JOIN_TIMEOUT = 6000;

// Profile (shared with ../mainpage.html)
const ACCOUNT_KEY = 'birdQuestXAccount';
const NAME_KEY = 'birdQuestXName';
const NAME_MAX = 16;
const USERNAME_PATTERN = /^[a-z0-9_]{3,16}$/;

const ASSETS = '../BQX assets/';

/* =====================================================================
   State
   ===================================================================== */

const ui = {};
let canvas, ctx;

let peer = null;
let connection = null;
let isHost = false;
let roomCode = '';
let randomMatchActive = false;
let randomMatchSlot = 1;
let joinTimer = null;

let myName = 'Player';
let selectedCharacter = null;
let opponentName = 'Opponent';
let signedInUser = null;
let profileData = null;
let profileInitialization = Promise.resolve();
let friendRefs = [];
let currentFriends = {};
let incomingFriendRequests = {};

let loopRunning = false;

// phase: 'idle' (not playing) | 'intro' | 'fight' | 'roundOver' | 'matchOver'
const match = {
    phase: 'idle',
    phaseTime: 0,
    round: 1,
    score: { p1: 0, p2: 0 },
    roundWinner: null,
    rematchMe: false,
    rematchThem: false,
    opponentLeft: false
};

const sprites = {};
let groundImage = null;

function makePlayer(x, facing) {
    return {
        x,
        y: FLOOR_Y - PLAYER_SIZE,
        vx: 0,
        vy: 0,
        onGround: true,
        character: 'chicken',
        facing,
        health: MAX_HEALTH,
        blocking: false,
        attacking: false,
        attackEndTime: 0,
        attackReadyTime: 0,
        hasHitThisSwing: false,
        keys: { w: false, a: false, s: false, d: false }
    };
}

const player1 = makePlayer(SPAWN.p1, 1);
const player2 = makePlayer(SPAWN.p2, -1);

const me = () => (isHost ? player1 : player2);
const them = () => (isHost ? player2 : player1);
const nameOf = (key) => ((key === 'p1') === isHost ? myName : opponentName);
const myKey = () => (isHost ? 'p1' : 'p2');

/* =====================================================================
   Setup
   ===================================================================== */

window.addEventListener('load', init);

function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    [
        'profile-screen', 'menu-screen', 'game-screen',
        'user-badge', 'user-badge-name', 'username-input', 'username-preview', 'username-status', 'confirm-character-btn',
        'player-id', 'copy-player-id-btn', 'add-friend-form', 'friend-player-id',
        'friends-status', 'friend-requests', 'friend-list',
        'connection-status', 'your-room-code', 'room-code', 'room-display',
        'hud-p1-name', 'hud-p2-name', 'hud-p1-pips', 'hud-p2-pips', 'hud-round',
        'match-over', 'match-result', 'match-score', 'rematch-status',
        'rematch-btn', 'new-opponent-btn', 'menu-btn', 'main-music'
    ].forEach(id => {
        ui[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
    });

    sprites.chicken = loadImage('Game Assets/Birds/Chicken/Chicken Idle.png');
    groundImage = loadImage('Game Assets/ground.png');

    setupProfile();
    setupFriends();
    onAuthStateChanged(auth, handleAuthState);

    document.getElementById('random-match-btn').addEventListener('click', randomMatch);
    document.getElementById('create-room-btn').addEventListener('click', createRoom);
    document.getElementById('join-code-btn').addEventListener('click', joinRoom);
    ui.roomCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
    document.getElementById('back-to-character-btn').addEventListener('click', backToProfile);
    document.getElementById('leave-btn').addEventListener('click', leaveGame);

    ui.rematchBtn.addEventListener('click', requestRematch);
    ui.newOpponentBtn.addEventListener('click', findNewOpponent);
    ui.menuBtn.addEventListener('click', leaveGame);

    setupControls();
    setupMouseCombat();
    setupTouchControls();
}

function loadImage(path) {
    const img = new Image();
    img.src = ASSETS + path;
    return img;
}

function showScreen(name) {
    ui.profileScreen.hidden = name !== 'profile';
    ui.menuScreen.hidden = name !== 'menu';
    ui.gameScreen.hidden = name !== 'game';
    ui.userBadge.hidden = name === 'game';
}

/* =====================================================================
   Profile: username + bird
   ===================================================================== */

function cleanName(name) {
    let n = String(name || '');
    if (n.includes('@')) n = n.split('@')[0]; // don't show full emails
    return n.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function usernameFromName(name) {
    return cleanName(name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, NAME_MAX)
        .replace(/_+$/g, '');
}

function setUsernameStatus(message, type = '') {
    ui.usernameStatus.textContent = message;
    ui.usernameStatus.dataset.type = type;
}

function usernameSaveErrorMessage(error) {
    const message = error && error.message ? error.message : String(error);
    if (/permission[_ ]denied/i.test(message)) {
        return 'Firebase denied this @name save. Publish the Realtime Database rules from accounts/firebase-database.rules.json in the Firebase console, then try again.';
    }
    return message;
}

function loadName() {
    try {
        const saved = cleanName(localStorage.getItem(NAME_KEY));
        if (saved) return saved;
        const account = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
        const fromAccount = cleanName(account && account.username);
        if (fromAccount) return fromAccount;
    } catch (e) { /* ignore bad storage */ }
    return 'Player';
}

function saveName(name) {
    try {
        localStorage.setItem(NAME_KEY, name);
        const storedAccount = localStorage.getItem(ACCOUNT_KEY);
        const account = storedAccount && storedAccount !== 'logged-out'
            ? JSON.parse(storedAccount)
            : {};
        account.username = name;
        account.handle = usernameFromName(name);
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    } catch (e) { /* storage blocked */ }
}

async function saveUsernameProfile(user, name) {
    const username = usernameFromName(name);
    if (!USERNAME_PATTERN.test(username)) {
        throw new Error('Your name must produce an @name with 3-16 letters, numbers, or underscores.');
    }

    const profileRef = ref(database, `users/${user.uid}/profile`);
    const profileSnapshot = await get(profileRef);
    const current = profileSnapshot.val();
    const hasTimestamp = current && Number.isFinite(current.nameChangedAt);
    const nameChanged = Boolean(current &&
        (current.name !== name || current.username !== username));
    if (signedInUser !== user) throw new Error('Your account changed. Please try again.');

    const usernameRef = ref(database, `usernames/${username}`);
    const existingClaim = await get(usernameRef);
    if (existingClaim.exists() && existingClaim.val() !== user.uid) {
        throw new Error(`@${username} is already taken.`);
    }

    let claim;
    try {
        claim = await runTransaction(usernameRef, (owner) => {
            if (owner === null || owner === user.uid) return user.uid;
            return;
        }, { applyLocally: false });
    } catch (error) {
        let latestClaim;
        try {
            latestClaim = await get(usernameRef);
        } catch (lookupError) {
            console.error('Could not inspect failed @name reservation:', lookupError);
        }
        if (latestClaim && latestClaim.exists() && latestClaim.val() !== user.uid) {
            throw new Error(`@${username} is already taken.`);
        }
        throw error;
    }
    if (!claim.committed) throw new Error(`@${username} is already taken.`);

    const nameChangedAt = nameChanged || !hasTimestamp ? serverTimestamp() : current.nameChangedAt;
    let profile = {
        playerId: user.uid,
        name,
        username,
        nameChangedAt
    };
    const profileNeedsUpdate = !current || current.playerId !== user.uid ||
        current.name !== name || current.username !== username ||
        current.nameChangedAt !== nameChangedAt;

    if (profileNeedsUpdate) {
        try {
            await set(profileRef, profile);
            const savedProfileSnapshot = await get(profileRef);
            profile = savedProfileSnapshot.val();
            if (!profile) throw new Error('Could not confirm your saved @name profile. Please try again.');
        } catch (error) {
            try {
                const latest = await get(profileRef);
                if (!latest.exists() || latest.val().username !== username) {
                    await runTransaction(usernameRef, (owner) =>
                        owner === user.uid ? null : undefined,
                    { applyLocally: false });
                }
            } catch (cleanupError) {
                console.error('Could not release unused @name reservation:', cleanupError);
            }
            throw error;
        }
    }

    let reservationWarning = '';
    const oldUsername = current && current.username;
    if (USERNAME_PATTERN.test(oldUsername || '') && oldUsername !== username) {
        const oldUsernameRef = ref(database, `usernames/${oldUsername}`);
        try {
            const oldUsernameSnapshot = await get(oldUsernameRef);
            if (oldUsernameSnapshot.val() === user.uid) {
                await remove(oldUsernameRef);
            }
        } catch (error) {
            console.error(`Could not release previous @${oldUsername}:`, error);
            reservationWarning = `@${username} was saved, but @${oldUsername} could not be released: ${error.message}`;
        }
    }

    profileData = profile;
    myName = name;
    ui.usernameInput.value = name;
    ui.userBadgeName.textContent = `@${username}`;
    saveName(name);

    if (user.displayName !== name) {
        try {
            await updateProfile(user, { displayName: name });
        } catch (error) {
            console.error('Could not sync Firebase display name:', error);
            setUsernameStatus(`@${username} was saved, but the account display name could not be synced: ${error.message}`, 'error');
            return profile;
        }
    }

    setUsernameStatus(
        reservationWarning || `Your unique @${username} is saved.`,
        reservationWarning ? 'error' : 'success'
    );
    return profile;
}

function setupProfile() {
    myName = loadName();
    ui.usernameInput.value = myName;
    ui.userBadgeName.textContent = `@${usernameFromName(myName) || 'player'}`;

    const cards = document.querySelectorAll('.character-card');
    const updateConfirm = () => {
        const name = cleanName(ui.usernameInput.value);
        const username = usernameFromName(name);
        ui.usernamePreview.textContent = USERNAME_PATTERN.test(username)
            ? `Proposed @name: @${username}`
            : 'Use a name that creates a 3-16 character @name.';
        ui.confirmCharacterBtn.disabled = !selectedCharacter || !name ||
            !USERNAME_PATTERN.test(username);
    };

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedCharacter = card.dataset.character;
            updateConfirm();
        });
    });

    // Only one bird right now, so pick it for the player
    if (cards.length === 1) cards[0].click();

    ui.usernameInput.addEventListener('input', () => {
        const name = cleanName(ui.usernameInput.value);
        const username = usernameFromName(name);
        if (username) ui.userBadgeName.textContent = `@${username}`;
        setUsernameStatus('', '');
        updateConfirm();
    });
    ui.usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !ui.confirmCharacterBtn.disabled) ui.confirmCharacterBtn.click();
    });

    ui.confirmCharacterBtn.addEventListener('click', async () => {
        const name = cleanName(ui.usernameInput.value);
        if (!selectedCharacter || !USERNAME_PATTERN.test(usernameFromName(name))) return;
        ui.confirmCharacterBtn.disabled = true;
        try {
            if (signedInUser) {
                await profileInitialization;
                await saveUsernameProfile(signedInUser, name);
            } else {
                myName = name;
                ui.userBadgeName.textContent = `@${usernameFromName(name)}`;
                saveName(name);
                setUsernameStatus('Sign in to reserve your unique @name.', 'info');
            }
            showScreen('menu');
            ui.mainMusic.play().catch(() => {});
        } catch (error) {
            setUsernameStatus(usernameSaveErrorMessage(error), 'error');
        } finally {
            updateConfirm();
        }
    });

    ui.userBadge.addEventListener('click', () => {
        if (!ui.gameScreen.hidden) return;
        backToProfile();
        ui.usernameInput.focus();
        ui.usernameInput.select();
    });

    updateConfirm();
}

function setupFriends() {
    ui.addFriendForm.addEventListener('submit', sendFriendRequest);
    ui.copyPlayerIdBtn.addEventListener('click', copyPlayerId);
}

async function handleAuthState(user) {
    friendRefs.forEach(path => off(ref(database, path)));
    friendRefs = [];
    signedInUser = user;
    profileData = null;
    profileInitialization = Promise.resolve();
    currentFriends = {};
    incomingFriendRequests = {};
    renderFriends();

    ui.copyPlayerIdBtn.disabled = !user;
    ui.addFriendForm.querySelector('button').disabled = !user;
    ui.friendPlayerId.disabled = !user;
    ui.playerId.textContent = user ? user.uid : 'Sign in to load';
    if (!user) {
        setUsernameStatus('Sign in to reserve your unique @name.', 'info');
        showFriendsMessage('Sign in with your account to use friends.', 'error');
        return;
    }

    profileInitialization = (async () => {
        const profileRef = ref(database, `users/${user.uid}/profile`);
        const profileSnapshot = await get(profileRef);
        if (signedInUser !== user) return;
        const existing = profileSnapshot.val();
        let name = cleanName(existing && (existing.name || existing.username) ||
            user.displayName || user.email || loadName()) || `Player_${user.uid.slice(0, 8)}`;
        if (!USERNAME_PATTERN.test(usernameFromName(name))) {
            name = `Player_${user.uid.slice(0, 8)}`;
        }
        await saveUsernameProfile(user, name);
    })();

    try {
        await profileInitialization;
    } catch (error) {
        profileInitialization = Promise.resolve();
        setUsernameStatus(`Could not load your @name: ${usernameSaveErrorMessage(error)}`, 'error');
        showFriendDatabaseError(error);
        return;
    }

    if (signedInUser !== user) return;
    try {
        await set(ref(database, `playerIds/${user.uid}`), user.uid);
        const friendsPath = `users/${user.uid}/friends`;
        const requestsPath = `friendRequests/${user.uid}`;
        friendRefs = [friendsPath, requestsPath];
        onValue(ref(database, friendsPath), (snapshot) => {
            currentFriends = snapshot.val() || {};
            renderFriends();
        }, showFriendDatabaseError);
        onValue(ref(database, requestsPath), (snapshot) => {
            incomingFriendRequests = snapshot.val() || {};
            renderFriends();
        }, showFriendDatabaseError);
        showFriendsMessage('', '');
    } catch (error) {
        showFriendDatabaseError(error);
    }
}

async function sendFriendRequest(event) {
    event.preventDefault();
    if (!signedInUser) return showFriendsMessage('Sign in to add friends.', 'error');

    const playerId = ui.friendPlayerId.value.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(playerId)) {
        return showFriendsMessage('Enter a valid Player ID.', 'error');
    }
    if (playerId === signedInUser.uid) {
        return showFriendsMessage("You can't add yourself.", 'error');
    }

    showFriendsMessage('Looking up Player ID...', 'info');
    try {
        const recipientSnapshot = await get(ref(database, `playerIds/${playerId}`));
        if (!recipientSnapshot.exists()) {
            return showFriendsMessage('Player ID not found.', 'error');
        }
        const recipientUid = recipientSnapshot.val();
        if (currentFriends[recipientUid]) {
            return showFriendsMessage('You are already friends.', 'info');
        }
        if (incomingFriendRequests[recipientUid]) {
            return showFriendsMessage('This player already sent you a request. Accept it below.', 'info');
        }

        const requestRef = ref(database, `friendRequests/${recipientUid}/${signedInUser.uid}`);
        await set(requestRef, { createdAt: Date.now() });
        ui.friendPlayerId.value = '';
        showFriendsMessage('Friend request sent.', 'success');
    } catch (error) {
        showFriendDatabaseError(error);
    }
}

async function copyPlayerId() {
    if (!signedInUser) return;
    try {
        await navigator.clipboard.writeText(signedInUser.uid);
        showFriendsMessage('Player ID copied.', 'success');
    } catch (error) {
        showFriendsMessage('Could not copy the Player ID. Select and copy it instead.', 'error');
    }
}

function renderFriends() {
    if (!ui.friendList || !ui.friendRequests) return;
    ui.friendRequests.replaceChildren();
    ui.friendList.replaceChildren();

    Object.keys(incomingFriendRequests).forEach(senderUid => {
        const row = makeFriendEntry(senderUid);
        const accept = makeFriendAction('Accept', async () => {
            try {
                await update(ref(database), {
                    [`users/${signedInUser.uid}/friends/${senderUid}`]: true,
                    [`users/${senderUid}/friends/${signedInUser.uid}`]: true
                });
                await remove(ref(database, `friendRequests/${signedInUser.uid}/${senderUid}`));
                showFriendsMessage('Friend request accepted.', 'success');
            } catch (error) {
                showFriendDatabaseError(error);
            }
        });
        const decline = makeFriendAction('Decline', async () => {
            try {
                await remove(ref(database, `friendRequests/${signedInUser.uid}/${senderUid}`));
            } catch (error) {
                showFriendDatabaseError(error);
            }
        });
        row.append(accept, decline);
        ui.friendRequests.appendChild(row);
    });

    Object.keys(currentFriends).forEach(async friendUid => {
        const row = document.createElement('li');
        row.className = 'friend-entry';
        const label = document.createElement('span');
        label.textContent = 'Loading friend...';
        row.appendChild(label);
        row.appendChild(makeFriendAction('Remove', async () => {
            try {
                await update(ref(database), {
                    [`users/${signedInUser.uid}/friends/${friendUid}`]: null,
                    [`users/${friendUid}/friends/${signedInUser.uid}`]: null
                });
                showFriendsMessage('Friend removed.', 'success');
            } catch (error) {
                showFriendDatabaseError(error);
            }
        }));
        ui.friendList.appendChild(row);
        try {
            const profileSnapshot = await get(ref(database, `users/${friendUid}/profile`));
            const profile = profileSnapshot.val() || {};
            label.textContent = `${profile.name || 'Player'} (@${profile.username || 'unknown'}) `;
            const id = document.createElement('code');
            id.textContent = friendUid;
            label.appendChild(id);
        } catch (error) {
            label.textContent = 'Could not load friend profile.';
            showFriendDatabaseError(error);
        }
    });
}

function makeFriendEntry(uid) {
    const row = document.createElement('li');
    row.className = 'friend-entry';
    const label = document.createElement('span');
    label.textContent = 'Loading player...';
    row.appendChild(label);
    get(ref(database, `users/${uid}/profile`)).then(snapshot => {
        if (!row.isConnected) return;
        const profile = snapshot.val() || {};
        label.textContent = `${profile.name || 'Player'} (@${profile.username || 'unknown'}) `;
        const id = document.createElement('code');
        id.textContent = uid;
        label.appendChild(id);
    }).catch(showFriendDatabaseError);
    return row;
}

function makeFriendAction(text, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-small';
    button.textContent = text;
    button.addEventListener('click', action);
    return button;
}

function showFriendsMessage(message, type) {
    ui.friendsStatus.textContent = message;
    ui.friendsStatus.dataset.type = type || '';
}

function showFriendDatabaseError(error) {
    console.error('Friend system error:', error);
    showFriendsMessage('Friend system unavailable. Check your Firebase database setup and rules.', 'error');
}

function backToProfile() {
    randomMatchActive = false;
    closeNetwork();
    resetLobbyUi();
    showScreen('profile');
}

/* =====================================================================
   Networking
   ===================================================================== */

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

    const currentPeer = new Peer(ROOM_ID_PREFIX + code);
    peer = currentPeer;

    currentPeer.on('open', () => {
        if (peer !== currentPeer) return;
        roomCode = code;
        ui.yourRoomCode.hidden = false;
        ui.yourRoomCode.innerHTML = 'Share this code with your friend:<strong></strong>';
        ui.yourRoomCode.querySelector('strong').textContent = code;
        showStatus('Waiting for player to join...', 'info');
    });

    currentPeer.on('connection', (conn) => {
        if (peer !== currentPeer) return conn.close();
        if (connection) return rejectBusy(conn);
        handleConnection(conn);
    });

    currentPeer.on('error', (err) => {
        if (peer !== currentPeer) return;
        if (err.type === 'unavailable-id') {
            createRoom(); // room code collision - try a fresh one
        } else {
            showStatus('Connection error: ' + err.type, 'error');
        }
    });
}

function joinRoom() {
    const code = ui.roomCode.value.trim().toUpperCase();
    if (!code) {
        showStatus('Please enter a room code', 'error');
        return;
    }

    randomMatchActive = false;
    closeNetwork();
    isHost = false;
    roomCode = code;
    ui.yourRoomCode.hidden = true;
    showStatus('Connecting to room...', 'info');

    const currentPeer = new Peer();
    peer = currentPeer;

    currentPeer.on('open', () => {
        if (peer !== currentPeer) return;
        handleConnection(currentPeer.connect(ROOM_ID_PREFIX + code, { reliable: true }));
    });

    currentPeer.on('error', (err) => {
        if (peer !== currentPeer) return;
        showStatus(err.type === 'peer-unavailable'
            ? 'Room not found. Check the code and try again.'
            : 'Connection error: ' + err.type, 'error');
    });
}

// Random match: try to hold public slot 1..N as the waiting host.
// If a slot is already held, connect to whoever holds it instead.
function randomMatch() {
    closeNetwork();
    randomMatchActive = true;
    ui.yourRoomCode.hidden = true;
    showStatus('Searching for a random player...', 'info');
    claimRandomRoom(1);
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
        if (peer !== currentPeer) return conn.close();
        if (connection || !randomMatchActive) return rejectBusy(conn);
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
        conn.on('open', clearJoinTimer);
    });

    currentPeer.on('error', (err) => {
        if (peer !== currentPeer || !randomMatchActive) return;
        if (err.type === 'peer-unavailable') {
            tryNextRandomRoom(slot);
        } else {
            randomMatchActive = false;
            showStatus('Random match connection error: ' + err.type, 'error');
        }
    });

    // If whoever holds this slot never answers, move on instead of hanging
    clearJoinTimer();
    joinTimer = setTimeout(() => {
        if (peer === currentPeer && randomMatchActive) tryNextRandomRoom(slot);
    }, JOIN_TIMEOUT);
}

function tryNextRandomRoom(slot) {
    clearJoinTimer();
    if (!randomMatchActive) return;
    showStatus('Searching for another random player...', 'info');
    closeNetwork();
    claimRandomRoom(slot + 1);
}

function clearJoinTimer() {
    if (joinTimer) clearTimeout(joinTimer);
    joinTimer = null;
}

// Tell someone we're already in a match so they search elsewhere
function rejectBusy(conn) {
    conn.on('open', () => {
        conn.send({ type: 'busy' });
        setTimeout(() => conn.close(), 500);
    });
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

function send(msg) {
    if (connection && connection.open) connection.send(msg);
}

function handleConnection(conn) {
    connection = conn;

    conn.on('open', () => {
        if (connection !== conn) return;
        showStatus('Connected! Getting ready...', 'success');
        conn.send({ type: 'hello', name: myName, character: selectedCharacter || 'chicken' });
    });

    conn.on('data', (data) => {
        if (connection !== conn || !data || typeof data !== 'object') return;
        if (data.type === 'busy') {
            if (randomMatchActive) tryNextRandomRoom(randomMatchSlot);
            else showStatus('That room is already in a match.', 'error');
            return;
        }
        handleNetworkData(data);
    });

    conn.on('close', () => {
        if (connection !== conn) return;
        connection = null;
        onOpponentDisconnected();
    });

    conn.on('error', (err) => {
        console.error('Connection error:', err);
        if (connection === conn && match.phase === 'idle') showStatus('Connection failed', 'error');
    });
}

function onOpponentDisconnected() {
    if (match.phase !== 'idle') {
        // Mid-match or on the results screen: show results with rematch disabled
        match.opponentLeft = true;
        if (match.phase !== 'matchOver') {
            match.phase = 'matchOver';
            match.phaseTime = performance.now();
        }
        showMatchOver();
        return;
    }
    if (randomMatchActive) {
        if (isHost) showStatus('Waiting for a random player...', 'info');
        else tryNextRandomRoom(randomMatchSlot);
        return;
    }
    showStatus('Player disconnected', 'error');
}

function handleNetworkData(data) {
    const opponent = them();

    switch (data.type) {
        case 'hello': {
            opponentName = cleanName(data.name) || 'Opponent';
            opponent.character = sprites[data.character] ? data.character : 'chicken';
            me().character = selectedCharacter || 'chicken';
            if (match.phase === 'idle') {
                showStatus(`Matched with ${opponentName}!`, 'success');
                const conn = connection;
                setTimeout(() => {
                    if (connection === conn && conn && conn.open && match.phase === 'idle') startMatch();
                }, 800);
            }
            break;
        }

        case 'state':
            opponent.x = data.x;
            opponent.y = data.y;
            opponent.vx = data.vx || 0;
            opponent.facing = data.facing === -1 ? -1 : 1;
            opponent.attacking = !!data.attacking;
            opponent.blocking = !!data.blocking;
            // Ignore health left over from the previous round
            if (data.round === match.round) opponent.health = data.health;
            break;

        case 'hit': {
            if (data.round !== match.round || match.phase !== 'fight') return;
            const mine = me();
            if (mine.health <= 0) return;
            const damage = mine.blocking ? Math.round(data.damage * BLOCK_DAMAGE_MULTIPLIER) : data.damage;
            mine.health = Math.max(0, mine.health - damage);
            break;
        }

        // The host referees rounds so both screens always agree
        case 'roundEnd':
            if (!isHost) applyRoundEnd(data);
            break;
        case 'roundStart':
            if (!isHost) startRound(data.round);
            break;

        case 'rematch':
            match.rematchThem = true;
            updateRematchUi();
            maybeStartRematch();
            break;
        case 'matchStart':
            if (!isHost) startMatch();
            break;
    }
}

/* =====================================================================
   Match flow: best of 3, rematch, new opponent
   ===================================================================== */

function startMatch() {
    // Matched with a random player: free the public slot so others can use it.
    // disconnect() keeps the connection we already have.
    if (randomMatchActive && isHost && peer) peer.disconnect();
    randomMatchActive = false;
    clearJoinTimer();

    match.score = { p1: 0, p2: 0 };
    match.rematchMe = false;
    match.rematchThem = false;
    match.opponentLeft = false;
    ui.matchOver.hidden = true;

    ui.roomDisplay.textContent = roomCode === 'PUBLIC' ? 'Random match' : `Room ${roomCode}`;
    showScreen('game');
    startRound(1);

    if (!loopRunning) {
        loopRunning = true;
        requestAnimationFrame(gameLoop);
    }
}

function resetPlayer(player, x, facing) {
    const character = player.character;
    const keys = player.keys;
    Object.assign(player, makePlayer(x, facing), { character, keys });
}

function startRound(round) {
    match.round = round;
    match.phase = 'intro';
    match.phaseTime = performance.now();
    match.roundWinner = null;
    resetPlayer(player1, SPAWN.p1, 1);
    resetPlayer(player2, SPAWN.p2, -1);
    updateHud();
}

// Host only: check for a K.O. and tell the guest what happened
function hostCheckRoundOver() {
    if (player1.health > 0 && player2.health > 0) return;
    const winner = player1.health <= 0 ? 'p2' : 'p1';
    const score = { ...match.score, [winner]: match.score[winner] + 1 };
    const msg = {
        type: 'roundEnd',
        round: match.round,
        winner,
        score,
        matchOver: score[winner] >= ROUNDS_TO_WIN
    };
    send(msg);
    applyRoundEnd(msg);
}

function applyRoundEnd(msg) {
    if (msg.round !== match.round || (match.phase !== 'fight' && match.phase !== 'intro')) return;
    match.score = { p1: msg.score.p1 | 0, p2: msg.score.p2 | 0 };
    match.roundWinner = msg.winner;
    match.phase = msg.matchOver ? 'matchOver' : 'roundOver';
    match.phaseTime = performance.now();
    updateHud();

    if (msg.matchOver) {
        setTimeout(() => {
            if (match.phase === 'matchOver') showMatchOver();
        }, MATCH_OVER_DELAY);
    }
}

function showMatchOver() {
    const { p1, p2 } = match.score;
    const myScore = isHost ? p1 : p2;
    const theirScore = isHost ? p2 : p1;
    const finished = myScore >= ROUNDS_TO_WIN || theirScore >= ROUNDS_TO_WIN;

    let title;
    if (finished) title = myScore > theirScore ? 'You Win!' : 'You Lose!';
    else title = 'Opponent Left';

    ui.matchResult.textContent = title;
    ui.matchResult.classList.toggle('lose', finished && myScore < theirScore);
    ui.matchScore.textContent = `${myName} ${myScore} - ${theirScore} ${opponentName}`;
    updateRematchUi();
    ui.matchOver.hidden = false;
}

function updateRematchUi() {
    let text = '';
    if (match.opponentLeft) text = `${opponentName} left the game.`;
    else if (match.rematchMe) text = `Waiting for ${opponentName}...`;
    else if (match.rematchThem) text = `${opponentName} wants a rematch!`;
    ui.rematchStatus.textContent = text;
    ui.rematchBtn.disabled = match.opponentLeft || match.rematchMe;
}

function requestRematch() {
    if (match.opponentLeft || match.rematchMe) return;
    match.rematchMe = true;
    send({ type: 'rematch' });
    updateRematchUi();
    maybeStartRematch();
}

// Host starts the rematch once both players asked for it
function maybeStartRematch() {
    if (isHost && match.rematchMe && match.rematchThem && !match.opponentLeft) {
        send({ type: 'matchStart' });
        startMatch();
    }
}

function findNewOpponent() {
    stopMatch();
    closeNetwork();
    showScreen('menu');
    randomMatch();
}

function leaveGame() {
    stopMatch();
    randomMatchActive = false;
    closeNetwork();
    resetLobbyUi();
    showScreen('menu');
}

function stopMatch() {
    match.phase = 'idle';
    ui.matchOver.hidden = true;
    isHost = false;
    roomCode = '';
    [player1, player2].forEach(p => Object.keys(p.keys).forEach(k => { p.keys[k] = false; }));
}

function resetLobbyUi() {
    ui.yourRoomCode.hidden = true;
    ui.yourRoomCode.textContent = '';
    ui.roomCode.value = '';
    showStatus('', '');
}

function updateHud() {
    const p1Name = nameOf('p1');
    const p2Name = nameOf('p2');
    ui.hudP1Name.textContent = p1Name;
    ui.hudP2Name.textContent = p2Name;
    ui.hudP1Name.classList.toggle('me', isHost);
    ui.hudP2Name.classList.toggle('me', !isHost);
    ui.hudRound.textContent = `Round ${match.round}`;
    renderPips(ui.hudP1Pips, match.score.p1);
    renderPips(ui.hudP2Pips, match.score.p2);
}

function renderPips(el, wins) {
    el.innerHTML = '';
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
        const pip = document.createElement('span');
        pip.className = 'pip' + (i < wins ? ' won' : '');
        el.appendChild(pip);
    }
}

/* =====================================================================
   Controls
   ===================================================================== */

const isTyping = (e) => e.target instanceof HTMLInputElement;

function setupControls() {
    const moveKeys = { w: 'w', a: 'a', s: 's', d: 'd' };

    window.addEventListener('keydown', (e) => {
        if (isTyping(e)) return;
        const key = e.key.toLowerCase();

        if (key === 'l' && !e.repeat) {
            if (ui.mainMusic.paused) ui.mainMusic.play().catch(() => {});
            else ui.mainMusic.pause();
            return;
        }

        if (match.phase === 'idle') return;
        if (moveKeys[key]) me().keys[key] = true;
        if (key === 'j' && !e.repeat) tryAttack(me());
        if (key === 'k') me().blocking = true;
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (moveKeys[key]) me().keys[key] = false;
        if (key === 'k') me().blocking = false;
    });

    // Don't get stuck walking if the window loses focus
    window.addEventListener('blur', () => {
        const p = me();
        Object.keys(p.keys).forEach(k => { p.keys[k] = false; });
        p.blocking = false;
    });
}

// Left click = attack, right click (held) = block
function setupMouseCombat() {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) tryAttack(me());
        else if (e.button === 2) me().blocking = true;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) me().blocking = false;
    });
}

function setupTouchControls() {
    const bindHold = (button, onDown, onUp) => {
        const down = (e) => { e.preventDefault(); button.classList.add('pressed'); onDown(); };
        const up = (e) => { e.preventDefault(); button.classList.remove('pressed'); onUp(); };
        button.addEventListener('touchstart', down, { passive: false });
        button.addEventListener('touchend', up, { passive: false });
        button.addEventListener('touchcancel', up, { passive: false });
        button.addEventListener('mousedown', down);
        button.addEventListener('mouseup', up);
        button.addEventListener('mouseleave', up);
        button.addEventListener('contextmenu', (e) => e.preventDefault());
    };

    document.querySelectorAll('.control-btn[data-key]').forEach(button => {
        const key = button.dataset.key;
        bindHold(button, () => { me().keys[key] = true; }, () => { me().keys[key] = false; });
    });

    bindHold(document.getElementById('attack-btn'), () => tryAttack(me()), () => {});
    bindHold(document.getElementById('block-btn'),
        () => { me().blocking = true; },
        () => { me().blocking = false; });
}

/* =====================================================================
   Gameplay
   ===================================================================== */

function tryAttack(player) {
    if (match.phase !== 'fight') return;
    const now = Date.now();
    if (player.attacking || now < player.attackReadyTime) return;

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

function updatePlayer(player, opponent, frozen) {
    const keys = frozen ? { w: false, a: false, s: false, d: false } : player.keys;

    // --- Walking ---
    const dir = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    player.vx = dir * MOVE_SPEED;
    // Walking right shows the image normally, walking left flips it
    if (dir !== 0) player.facing = dir;

    player.x += player.vx;
    clampX(player);

    // Bump into the other bird sideways
    if (overlaps(player, opponent)) {
        player.x = player.x < opponent.x ? opponent.x - PLAYER_SIZE : opponent.x + PLAYER_SIZE;
        clampX(player);
    }

    // --- Jumping ---
    if (keys.w && player.onGround) {
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
        // Land on a platform we were above last frame
        for (const p of PLATFORMS) {
            if (!p.floor && keys.s) continue; // hold S to drop through
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

    if (player.attacking && Date.now() > player.attackEndTime) {
        player.attacking = false;
    }
}

function checkAttackHit(attacker, target) {
    if (!attacker.attacking || attacker.hasHitThisSwing || match.phase !== 'fight') return;

    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const inFront = dx * attacker.facing >= -PLAYER_SIZE / 4; // only hit what you're facing

    if (Math.hypot(dx, dy) <= ATTACK_RANGE && inFront) {
        attacker.hasHitThisSwing = true;
        send({ type: 'hit', round: match.round, damage: ATTACK_DAMAGE });
    }
}

function sendState(player) {
    send({
        type: 'state',
        round: match.round,
        x: player.x,
        y: player.y,
        vx: player.vx,
        facing: player.facing,
        attacking: player.attacking,
        blocking: player.blocking,
        health: player.health
    });
}

function updateMatchPhase(now) {
    const elapsed = now - match.phaseTime;

    if (match.phase === 'intro' && elapsed >= ROUND_INTRO_TIME) {
        match.phase = 'fight';
        match.phaseTime = now;
    } else if (match.phase === 'fight' && isHost) {
        hostCheckRoundOver();
    } else if (match.phase === 'roundOver' && isHost && elapsed >= ROUND_END_DELAY) {
        const next = match.round + 1;
        send({ type: 'roundStart', round: next });
        startRound(next);
    }
}

function gameLoop() {
    if (match.phase === 'idle') {
        loopRunning = false;
        return;
    }

    const now = performance.now();
    const mine = me();
    const opponent = them();

    updateMatchPhase(now);

    const frozen = match.phase !== 'fight';
    if (frozen) mine.attacking = false;
    updatePlayer(mine, opponent, frozen);
    checkAttackHit(mine, opponent);
    sendState(mine);

    draw(now);
    requestAnimationFrame(gameLoop);
}

/* =====================================================================
   Drawing
   ===================================================================== */

function draw(now) {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    sky.addColorStop(0, '#5bb8f5');
    sky.addColorStop(1, '#c9ecff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawClouds();
    drawGround();
    drawBird(player1, nameOf('p1'), isHost);
    drawBird(player2, nameOf('p2'), !isHost);
    drawBanner(now);
}

function drawClouds() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    const time = Date.now() * 0.0001;
    for (let i = 0; i < 5; i++) {
        const x = ((time * 20 + i * 200) % (CANVAS_WIDTH + 100)) - 50;
        const y = 50 + i * 70;
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
    ctx.imageSmoothingEnabled = false;

    for (const p of PLATFORMS) {
        if (ready) {
            // Skip the transparent top of ground.png so the grass sits exactly on p.y
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

function drawBird(player, name, isMe) {
    const { x, y, character, facing, attacking, blocking, health } = player;
    const sprite = sprites[character] || sprites.chicken;

    ctx.save();
    // Flip the sprite horizontally when facing left
    if (facing === -1) {
        ctx.translate(x + PLAYER_SIZE, y);
        ctx.scale(-1, 1);
    } else {
        ctx.translate(x, y);
    }

    if (sprite && sprite.complete && sprite.naturalWidth) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, 0, 0, PLAYER_SIZE, PLAYER_SIZE);
    } else {
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(0, 0, PLAYER_SIZE, PLAYER_SIZE);
    }

    if (blocking) {
        ctx.fillStyle = 'rgba(80, 170, 255, 0.4)';
        ctx.strokeStyle = '#3fa9f5';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(PLAYER_SIZE / 2, PLAYER_SIZE / 2, PLAYER_SIZE * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    // Attack swipe in front of the bird
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

    // Name tag
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillStyle = isMe ? '#ffd23f' : '#ffffff';
    ctx.strokeText(name, x + PLAYER_SIZE / 2, y - 14);
    ctx.fillText(name, x + PLAYER_SIZE / 2, y - 14);

    // Health bar
    const barY = y - 10;
    const pct = Math.max(0, health) / MAX_HEALTH;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, barY, PLAYER_SIZE, 6);
    ctx.fillStyle = pct > 0.5 ? '#4CAF50' : pct > 0.2 ? '#FFC107' : '#F44336';
    ctx.fillRect(x, barY, PLAYER_SIZE * pct, 6);
}

function drawBanner(now) {
    let big = '';
    let small = '';
    const elapsed = now - match.phaseTime;

    if (match.phase === 'intro') {
        big = elapsed < ROUND_INTRO_TIME * 0.65 ? `Round ${match.round}` : 'Fight!';
        small = match.round === 3 ? 'Final round' : '';
    } else if (match.phase === 'fight' && elapsed < 500) {
        big = 'Fight!';
    } else if (match.phase === 'roundOver' || match.phase === 'matchOver') {
        if (!match.roundWinner) return; // opponent left; popup handles it
        big = 'K.O.!';
        small = `${nameOf(match.roundWinner)} wins the round`;
        if (match.phase === 'matchOver') small = `${nameOf(match.roundWinner)} wins the match`;
    }
    if (!big) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, CANVAS_HEIGHT / 2 - 70, CANVAS_WIDTH, small ? 130 : 100);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1a1a2e';
    ctx.fillStyle = big === 'K.O.!' ? '#ff5a5f' : '#ffd23f';
    ctx.font = 'bold 56px Arial';
    ctx.strokeText(big, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
    ctx.fillText(big, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);

    if (small) {
        ctx.font = 'bold 22px Arial';
        ctx.lineWidth = 4;
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(small, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 32);
        ctx.fillText(small, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 32);
    }
}

function showStatus(message, type) {
    ui.connectionStatus.textContent = message;
    ui.connectionStatus.className = 'status ' + (type || '');
    ui.connectionStatus.hidden = !message;
}
