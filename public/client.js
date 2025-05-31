// client.js

let socket;
let username;
let myAvatarId;
let otherAvatars = {};
let cameraRig;
let camera;

const nameModal = document.getElementById("nameModal");
const joinBtn = document.getElementById("joinBtn");
const usernameInput = document.getElementById("username");

const chatDiv = document.getElementById("chat");
const messagesDiv = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");

const userListUl = document.getElementById("users");
const userListDiv = document.getElementById("userList");

// Wait for A-Frame to be ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, A-Frame should be available');
  
  joinBtn.onclick = () => {
    const name = usernameInput.value.trim();
    if (!name) {
      alert("Please enter a name.");
      return;
    }
    username = name;
    startApp();
  };

  // Allow pressing Enter in username input
  usernameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      joinBtn.click();
    }
  });
});

function startApp() {
  console.log('Starting app for user:', username);
  
  // Hide name modal
  nameModal.style.display = "none";

  // Show chat and user list
  chatDiv.style.display = "block";
  userListDiv.style.display = "block";

  // Connect Socket.IO
  socket = io("https://agrivr.onrender.com");

  socket.on('connect', () => {
    console.log('Socket connected');
    socket.emit("join", username);
  });

  socket.on("userList", (users) => {
    console.log('Updated user list:', users);
    userListUl.innerHTML = "";
    users.forEach((user) => {
      const li = document.createElement("li");
      li.textContent = user;
      userListUl.appendChild(li);
    });
  });

  socket.on("chatMessage", (msg) => {
    console.log('Chat message:', msg);
    const p = document.createElement("p");
    p.textContent = msg;
    p.style.margin = "2px 0";
    p.style.padding = "2px";
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });

  socket.on("chatBubble", (messageData) => {
    console.log('Chat bubble data:', messageData);
    // Don't show bubble for our own messages
    if (messageData.username !== username) {
      showChatBubble(messageData.userId, messageData.message);
    }
  });

  // Avatar system events
  socket.on('existing-users', (users) => {
    console.log('Existing users:', users);
    users.forEach(user => {
      createOtherUserAvatar(user.userId, user.username, user.position);
    });
  });

  socket.on('user-joined', (userData) => {
    console.log('New user joined:', userData);
    createOtherUserAvatar(userData.userId, userData.username, userData.position);
  });

  socket.on('user-moved', (moveData) => {
    updateOtherUserPosition(moveData.userId, moveData.position, moveData.rotation);
  });

  socket.on('user-left', (userData) => {
    console.log('User left:', userData.userId);
    removeOtherUserAvatar(userData.userId);
  });

  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const msg = chatInput.value.trim();
      if (msg) {
        socket.emit("chatMessage", msg);
        chatInput.value = "";
      }
    }
  });

  // Setup scene after socket is connected
  setupScene();
}

function setupScene() {
  console.log('Setting up scene');
  
  const scene = document.querySelector("a-scene");
  
  if (scene.hasLoaded) {
    initScene();
  } else {
    scene.addEventListener('loaded', initScene);
  }
}

function initScene() {
  console.log('Initializing scene');
  
  cameraRig = document.querySelector('#cameraRig');
  camera = document.querySelector('#playerCamera');
  
  // Start position tracking
  startPositionTracking();
  
  // Start billboard update loop for names only (not chat bubbles)
  startBillboardUpdates();
  
  console.log('Scene initialized, camera rig found:', !!cameraRig, 'camera found:', !!camera);
}

function startPositionTracking() {
  let lastPosition = { x: 0, y: 1.6, z: 3 };
  
  // Send position updates every 200ms for smoother movement
  setInterval(() => {
    if (camera && socket && socket.connected) {
      // Get the camera's world position (this handles the camera rig properly)
      const cameraWorldPos = camera.object3D.getWorldPosition(new AFRAME.THREE.Vector3());
      const cameraWorldRot = camera.object3D.getWorldQuaternion(new AFRAME.THREE.Quaternion());
      
      // Convert quaternion to euler angles
      const euler = new AFRAME.THREE.Euler();
      euler.setFromQuaternion(cameraWorldRot);
      
      const currentPosition = {
        x: parseFloat(cameraWorldPos.x.toFixed(2)),
        y: parseFloat(cameraWorldPos.y.toFixed(2)),
        z: parseFloat(cameraWorldPos.z.toFixed(2))
      };
      
      // Check if position changed significantly
      const moved = Math.abs(currentPosition.x - lastPosition.x) > 0.05 ||
                   Math.abs(currentPosition.y - lastPosition.y) > 0.05 ||
                   Math.abs(currentPosition.z - lastPosition.z) > 0.05;
      
      if (moved) {
        console.log('Position changed from', lastPosition, 'to', currentPosition);
        
        const positionData = {
          position: currentPosition,
          rotation: {
            x: parseFloat((euler.x * 180 / Math.PI).toFixed(2)),
            y: parseFloat((euler.y * 180 / Math.PI).toFixed(2)),
            z: parseFloat((euler.z * 180 / Math.PI).toFixed(2))
          }
        };
        
        socket.emit('position-update', positionData);
        lastPosition = { ...currentPosition };
      }
    }
  }, 200);
}

function startBillboardUpdates() {
  // Update billboard orientations every frame - only for name tags
  setInterval(() => {
    if (camera) {
      const cameraWorldPos = camera.object3D.getWorldPosition(new AFRAME.THREE.Vector3());
      
      // Update all avatar name tag billboards only
      Object.keys(otherAvatars).forEach(userId => {
        const avatar = otherAvatars[userId];
        if (avatar && avatar.nameTag) {
          updateBillboard(avatar.nameTag, cameraWorldPos);
        }
      });
    }
  }, 50); // 20 FPS for smooth billboard updates
}

function updateBillboard(element, cameraPos) {
  if (!element || !element.object3D) return;
  
  const elementPos = element.object3D.getWorldPosition(new AFRAME.THREE.Vector3());
  const direction = new AFRAME.THREE.Vector3();
  direction.subVectors(cameraPos, elementPos);
  direction.y = 0; // Keep it horizontal
  direction.normalize();
  
  const angle = Math.atan2(direction.x, direction.z);
  element.setAttribute('rotation', `0 ${angle * 180 / Math.PI} 0`);
}

function createOtherUserAvatar(userId, userName, position) {
  console.log('Creating avatar for:', userName, userId);
  
  // Don't create avatar if it already exists
  if (otherAvatars[userId]) {
    return;
  }
  
  const scene = document.querySelector('a-scene');
  
  // Create avatar entity
  const avatar = document.createElement('a-entity');
  avatar.setAttribute('id', `avatar-${userId}`);
  avatar.setAttribute('position', `${position.x} ${position.y} ${position.z}`);
  
  // Create body (sphere)
  const body = document.createElement('a-sphere');
  body.setAttribute('color', getRandomColor());
  body.setAttribute('radius', '0.3');
  body.setAttribute('position', '0 0 0');
  avatar.appendChild(body);
  
  // Create head (smaller sphere)
  const head = document.createElement('a-sphere');
  head.setAttribute('color', '#FFDBAC');
  head.setAttribute('radius', '0.2');
  head.setAttribute('position', '0 0.4 0');
  avatar.appendChild(head);
  
  // Create name tag with billboard behavior
  const nameTag = document.createElement('a-text');
  nameTag.setAttribute('value', userName);
  nameTag.setAttribute('position', '0 0.9 0');
  nameTag.setAttribute('align', 'center');
  nameTag.setAttribute('color', '#FFFFFF');
  nameTag.setAttribute('scale', '1.5 1.5 1.5');
  nameTag.setAttribute('shader', 'msdf');
  nameTag.setAttribute('font', 'roboto');
  // Add a fitted background for better visibility
  const nameLength = userName.length;
  const bgWidth = Math.max(nameLength * 0.15, 1.0);
  nameTag.setAttribute('geometry', `primitive: plane; width: ${bgWidth}; height: 0.4`);
  nameTag.setAttribute('material', 'color: #000000; opacity: 0.7');
  avatar.appendChild(nameTag);
  
  // Create chat bubble container (separate entity for independent positioning)
  const chatBubbleContainer = document.createElement('a-entity');
  chatBubbleContainer.setAttribute('position', '0 1.3 0');
  chatBubbleContainer.setAttribute('visible', false);
  
  // Create chat bubble text
  const chatBubble = document.createElement('a-text');
  chatBubble.setAttribute('value', '');
  chatBubble.setAttribute('position', '0 0 0.01'); // Slightly forward to avoid z-fighting
  chatBubble.setAttribute('align', 'center');
  chatBubble.setAttribute('color', '#000000');
  chatBubble.setAttribute('scale', '1.2 1.2 1.2');
  chatBubble.setAttribute('shader', 'msdf');
  chatBubble.setAttribute('font', 'roboto');
  
  // Chat bubble background
  const chatBubbleBg = document.createElement('a-plane');
  chatBubbleBg.setAttribute('width', '2');
  chatBubbleBg.setAttribute('height', '0.5');
  chatBubbleBg.setAttribute('color', '#FFFFFF');
  chatBubbleBg.setAttribute('opacity', '0.9');
  chatBubbleBg.setAttribute('position', '0 0 0');
  
  chatBubbleContainer.appendChild(chatBubbleBg);
  chatBubbleContainer.appendChild(chatBubble);
  avatar.appendChild(chatBubbleContainer);
  
  // Add to scene
  scene.appendChild(avatar);
  
  // Store avatar reference
  otherAvatars[userId] = {
    entity: avatar,
    username: userName,
    nameTag: nameTag,
    chatBubble: chatBubble,
    chatBubbleContainer: chatBubbleContainer,
    chatBubbleBg: chatBubbleBg,
    chatTimeout: null
  };
  
  console.log('Avatar created for:', userName);
}

function updateOtherUserPosition(userId, position, rotation) {
  const avatar = otherAvatars[userId];
  if (avatar && avatar.entity) {
    console.log('Updating avatar position for:', userId, position);
    
    // Update position with proper coordinate system
    avatar.entity.setAttribute('position', `${position.x} ${position.y} ${position.z}`);
    
    // Also set rotation if available
    if (rotation) {
      avatar.entity.setAttribute('rotation', `${rotation.x} ${rotation.y} ${rotation.z}`);
    }
  } else {
    console.log('Avatar not found for user:', userId);
  }
}

function removeOtherUserAvatar(userId) {
  const avatar = otherAvatars[userId];
  if (avatar && avatar.entity) {
    // Clear any existing chat timeout
    if (avatar.chatTimeout) {
      clearTimeout(avatar.chatTimeout);
    }
    
    avatar.entity.parentNode.removeChild(avatar.entity);
    delete otherAvatars[userId];
    console.log('Removed avatar for user:', userId);
  }
}

function showChatBubble(userId, message) {
  const avatar = otherAvatars[userId];
  if (!avatar || !avatar.chatBubble || !avatar.chatBubbleContainer) return;
  
  // Clear existing timeout
  if (avatar.chatTimeout) {
    clearTimeout(avatar.chatTimeout);
  }
  
  // Truncate long messages
  const displayMessage = message.length > 50 ? 
    message.substring(0, 47) + '...' : message;
  
  // Calculate bubble width based on message length
  const messageLength = displayMessage.length;
  const bubbleWidth = Math.max(messageLength * 0.12, 1.5);
  const bubbleHeight = messageLength > 30 ? 0.7 : 0.5;
  
  // Update chat bubble background size
  avatar.chatBubbleBg.setAttribute('width', bubbleWidth);
  avatar.chatBubbleBg.setAttribute('height', bubbleHeight);
  
  // Show the chat bubble
  avatar.chatBubble.setAttribute('value', displayMessage);
  avatar.chatBubbleContainer.setAttribute('visible', true);
  
  // Make chat bubble always face the camera (but don't use the billboard system)
  updateChatBubbleOrientation(avatar.chatBubbleContainer);
  
  // Hide the bubble after 5 seconds
  avatar.chatTimeout = setTimeout(() => {
    avatar.chatBubbleContainer.setAttribute('visible', false);
    avatar.chatTimeout = null;
  }, 5000);
}

function updateChatBubbleOrientation(bubbleContainer) {
  if (!camera || !bubbleContainer || !bubbleContainer.object3D) return;
  
  // Get camera world position
  const cameraWorldPos = camera.object3D.getWorldPosition(new AFRAME.THREE.Vector3());
  const bubbleWorldPos = bubbleContainer.object3D.getWorldPosition(new AFRAME.THREE.Vector3());
  
  // Calculate direction from bubble to camera
  const direction = new AFRAME.THREE.Vector3();
  direction.subVectors(cameraWorldPos, bubbleWorldPos);
  direction.y = 0; // Keep horizontal
  direction.normalize();
  
  // Calculate angle and apply rotation
  const angle = Math.atan2(direction.x, direction.z);
  bubbleContainer.setAttribute('rotation', `0 ${angle * 180 / Math.PI} 0`);
}

function getRandomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF'];
  return colors[Math.floor(Math.random() * colors.length)];
}
