# BirdQuestX Multiplayer Game

A revamped multiplayer bird battle game using BirdQuestX assets!

## Features

✨ **Character Selection** - Choose between Kirby and Chicken birds
🎮 **Multiplayer Modes** - Join with code or create room
📱 **Mobile Support** - Touch controls for mobile devices
🎨 **BirdQuestX Theme** - Full integration with BirdQuestX assets and styling
🎵 **Background Music** - Toggle with 'L' key
☁️ **Animated Environment** - Sky gradient with moving clouds

## How to Play

1. Open `game/game.html` in your browser
2. Select your bird character (Kirby or Chicken)
3. Choose a connection method:
   - **Create Room**: Generate a code to share with friends
   - **Join with Code**: Enter a friend's room code
   - **Random Match**: (Coming soon)
4. Use **WASD** keys to move your bird
5. On mobile, use the on-screen D-pad controls

## Controls

### Keyboard
- **W** - Move Up
- **A** - Move Left  
- **S** - Move Down
- **D** - Move Right
- **L** - Toggle Background Music

### Mobile
- Touch the arrow buttons on screen to move

## File Structure

```
Testing/
├── game/
│   └── game.html       # Main game HTML
├── game.js             # Game logic and networking
├── style.css           # BirdQuestX themed styles
└── README.md           # This file
```

## Assets Used

- **Birds**: Kirby and Chicken sprites from BirdQuestX
- **UI**: BirdQuestX title logo and themed buttons
- **Music**: Pixel Feathers background track
- **Background**: BirdQuestX menu background

## Technology

- **PeerJS** - Peer-to-peer WebRTC for multiplayer
- **HTML5 Canvas** - Game rendering
- **Vanilla JavaScript** - No frameworks needed

## Notes

- Both players must be connected to start the game
- The game uses peer-to-peer connections (no server needed)
- Characters are exchanged at connection time
- Press "Leave Game" to return to character selection

---

**Tip**: Make sure the BirdQuestX assets are in the correct path (`../../Downloads/BirdQuestX/`) or update the paths in the HTML and JS files accordingly!
