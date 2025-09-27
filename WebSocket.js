// server.js - Updated with WebSocket support
const app = require('./app');
const http = require('http');
const socketIo = require('socket.io');

const PORT = process.env.PORT || 3000;

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Store authenticated socket connections
const authenticatedSockets = new Map();

// Socket.IO middleware for authentication
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }

    // Verify JWT token (reuse your existing auth logic)
    const jwt = require('jsonwebtoken');
    const User = require('./models/User');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return next(new Error('User not found'));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

// Handle socket connections
io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected`);
  
  // Store authenticated socket
  authenticatedSockets.set(socket.userId, socket);
  
  // Join user to their personal room
  socket.join(`user:${socket.userId}`);
  
  socket.on('disconnect', () => {
    console.log(`User ${socket.userId} disconnected`);
    authenticatedSockets.delete(socket.userId);
  });
});

// Make io available to routes
app.set('io', io);

server.listen(PORT, () => {
  console.log(`🚀 Server with WebSocket running on port ${PORT}`);
});