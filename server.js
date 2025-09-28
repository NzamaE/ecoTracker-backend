
const app = require('./app');
const http = require('http');
const socketIo = require('socket.io');


const PORT = process.env.PORT || 3000;

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);

// Add Render optimization
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      const allowedOrigins = [
        process.env.CLIENT_URL,
        'http://localhost:5173',
        /^https:\/\/.*\.onrender\.com$/, // Allow all Render subdomains
      ];
      
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      const isAllowed = allowedOrigins.some(allowed => {
        if (allowed instanceof RegExp) {
          return allowed.test(origin);
        }
        return allowed === origin;
      });
      
      if (isAllowed) {
        callback(null, true);
      } else {
        console.log('CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
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
  console.log(`🔌 User ${socket.userId} connected via WebSocket`);
  
  // Add production monitoring
  if (process.env.NODE_ENV === 'production') {
    console.log(`   Origin: ${socket.handshake.headers.origin}`);
    console.log(`   User-Agent: ${socket.handshake.headers['user-agent']?.substring(0, 50)}...`);
    console.log(`   Total active connections: ${authenticatedSockets.size + 1}`);
  }
  
  // Store authenticated socket
  authenticatedSockets.set(socket.userId, socket);
  
  // Join user to their personal room
  socket.join(`user:${socket.userId}`);
  
  // Handle custom events (optional)
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 User ${socket.userId} disconnected`);
    authenticatedSockets.delete(socket.userId);
  });
});

// Make io available to routes
app.set('io', io);
app.set('authenticatedSockets', authenticatedSockets);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Footprint Logger server with WebSocket running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket ready for real-time features`);
  
  // Only log endpoints in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n📋 Available HTTP endpoints:');
    console.log('POST /api/auth/register - Register new user');
    console.log('POST /api/auth/login - Login user');
    console.log('POST /api/activities - Add activity log');
    console.log('GET /api/activities - Get user activities');
    console.log('GET /api/dashboard - Get dashboard data with community comparison');
    console.log('GET /api/streak - Get weekly summaries and streak tracking');
    console.log('GET /api/leaderboard - Get low-footprint users leaderboard');
    console.log('GET /api/stats - Get user statistics');
    console.log('GET /api/insights/weekly-analysis - Get weekly insights');
    console.log('GET /api/insights/recommendations - Get personalized recommendations');
    console.log('POST /api/insights/set-emission-goal - Set emission reduction goals');
    console.log('GET /api/insights/emission-goal-progress - Track goal progress');
    
    console.log('\n⚡ WebSocket Events:');
    console.log('activity_tip - Real-time tips after logging activities');
    console.log('goal_set - Confirmation when goals are set');
    console.log('goal_milestone - Progress milestone notifications');
    console.log('weekly_insights - Weekly analysis updates');
    console.log('trend_alert - Significant trend change alerts');
    console.log('goal_status_update - Critical goal status updates');
  }
});

// Graceful shutdown with WebSocket cleanup
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  // Close WebSocket connections
  console.log('🔌 Closing WebSocket connections...');
  authenticatedSockets.forEach((socket, userId) => {
    socket.emit('server_shutdown', { 
      message: 'Server is shutting down for maintenance. Please reconnect in a moment.' 
    });
    socket.disconnect(true);
  });
  
  // Close Socket.IO server
  io.close(() => {
    console.log('🔌 WebSocket server closed');
  });
  
  // Close HTTP server
  server.close(() => {
    console.log('🚀 HTTP server closed');
    console.log('✅ Process terminated gracefully');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Enhanced error handling
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  console.error(err.stack);
  
  // Close WebSocket connections before exiting
  authenticatedSockets.forEach((socket) => {
    socket.emit('server_error', { message: 'Server encountered an error' });
    socket.disconnect(true);
  });
  
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Log more details for debugging
  if (reason instanceof Error) {
    console.error('Stack trace:', reason.stack);
  }
  
  process.exit(1);
});

// Monitor WebSocket connections (reduced logging for production)
setInterval(() => {
  const connectedUsers = authenticatedSockets.size;
  if (connectedUsers > 0) {
    if (process.env.NODE_ENV === 'production') {
      console.log(`🔌 Active connections: ${connectedUsers}`);
    } else {
      console.log(`🔌 WebSocket Status: ${connectedUsers} users connected`);
    }
  }
}, 300000); // Log every 5 minutes if users are connected

// Export server and io for testing purposes
module.exports = { server, io, authenticatedSockets };