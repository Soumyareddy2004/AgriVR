const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type"]
  }
});

let users = {};

// Add CORS middleware for Express
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join', (username) => {
    // Create user object with initial position
    users[socket.id] = {
      username: username,
      userId: socket.id,
      position: { x: 0, y: 1.6, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      joinTime: new Date()
    };
    
    console.log(`${username} joined (ID: ${socket.id})`);
    
    // Send user list for chat
    const userList = Object.values(users).map(u => u.username);
    io.emit('userList', userList);
    
    // Send existing users to new player (for their avatars)
    const existingUsers = Object.keys(users)
      .filter(id => id !== socket.id)
      .map(id => ({
        userId: id,
        username: users[id].username,
        position: users[id].position,
        rotation: users[id].rotation
      }));
    
    if (existingUsers.length > 0) {
      socket.emit('existing-users', existingUsers);
    }
    
    // Notify other users about new player (for their avatar creation)
    socket.broadcast.emit('user-joined', {
      userId: socket.id,
      username: username,
      position: users[socket.id].position,
      rotation: users[socket.id].rotation
    });
    
    // Send chat notification
    socket.broadcast.emit('chatMessage', `🌾 ${username} joined the farm!`);
    socket.emit('chatMessage', `Welcome to the farm, ${username}! Use WASD to move around.`);
  });

  socket.on('chatMessage', (msg) => {
    const user = users[socket.id];
    if (user) {
      // Broadcast message to all users with user info for bubble handling
      const messageData = {
        username: user.username,
        userId: socket.id,
        message: msg,
        timestamp: new Date()
      };
      
      // Send formatted message for chat window
      io.emit('chatMessage', `${user.username}: ${msg}`);
      
      // Send structured data for chat bubbles
      io.emit('chatBubble', messageData);
      
      console.log(`Chat message from ${user.username}: ${msg}`);
    }
  });

  // Handle position updates for avatars
  socket.on('position-update', (data) => {
    const user = users[socket.id];
    if (user && data.position) {
      // Validate and sanitize position data
      const newPosition = {
        x: Math.max(-50, Math.min(50, parseFloat(data.position.x) || 0)),
        y: Math.max(0, Math.min(10, parseFloat(data.position.y) || 1.6)),
        z: Math.max(-50, Math.min(50, parseFloat(data.position.z) || 0))
      };
      
      const newRotation = {
        x: parseFloat(data.rotation?.x) || 0,
        y: parseFloat(data.rotation?.y) || 0,
        z: parseFloat(data.rotation?.z) || 0
      };
      
      // Only update if position actually changed significantly
      const posChanged = Math.abs(user.position.x - newPosition.x) > 0.05 || 
                        Math.abs(user.position.y - newPosition.y) > 0.05 ||
                        Math.abs(user.position.z - newPosition.z) > 0.05;
      
      if (posChanged) {
        // Store the previous position for debugging
        const oldPosition = { ...user.position };
        
        user.position = newPosition;
        user.rotation = newRotation;
        
        console.log(`Position update for ${user.username}: ${oldPosition.x.toFixed(2)},${oldPosition.y.toFixed(2)},${oldPosition.z.toFixed(2)} -> ${newPosition.x.toFixed(2)},${newPosition.y.toFixed(2)},${newPosition.z.toFixed(2)}`);
        
        // Broadcast position update to other users
        socket.broadcast.emit('user-moved', {
          userId: socket.id,
          position: user.position,
          rotation: user.rotation
        });
      }
    }
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      console.log(`${user.username} disconnected (ID: ${socket.id})`);
      
      // Remove user from users object
      delete users[socket.id];
      
      // Update user list for chat
      const userList = Object.values(users).map(u => u.username);
      io.emit('userList', userList);
      
      // Notify remaining users
      io.emit('chatMessage', `🌾 ${user.username} left the farm.`);
      
      // Notify other clients to remove avatar
      socket.broadcast.emit('user-left', {
        userId: socket.id
      });
    }
  });

  // Handle ping for connection testing
  socket.on('ping', (callback) => {
    if (callback) callback('pong');
  });
});

// Heartbeat to keep connections alive and log active users
setInterval(() => {
  const connectedUsers = Object.keys(users).length;
  if (connectedUsers > 0) {
    console.log(`${connectedUsers} users connected:`, Object.values(users).map(u => u.username).join(', '));
  }
}, 30000);

server.listen(3000, () => {
  console.log('🌾 Immersive Farm Server running on http://localhost:3000');
  console.log('Multi-user VR farm with avatar system enabled');
});