const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const activityRoutes = require('./routes/activities');
const dashboardRoutes = require('./routes/dashboard');
const insightsRoutes = require('./routes/insights');

const app = express();

// CORS configuration for Render deployment
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.CLIENT_URL,
      'http://localhost:5173',
      /^https:\/\/.*\.onrender\.com$/, // Allow all Render subdomains
    ];
    
    // Allow requests with no origin (mobile apps, curl, postman, etc.)
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
      console.log('Express CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' })); // Add size limit for security
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Set Mongoose-specific options (only valid ones)
mongoose.set('bufferCommands', false);


// Simple MongoDB connection options
const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/footprint-logger', mongoOptions)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    console.log('Database:', mongoose.connection.db.databaseName);
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/insights', insightsRoutes);

// Health check route with WebSocket info
app.get('/health', (req, res) => {
  const authenticatedSockets = req.app.get('authenticatedSockets');
  
  res.json({ 
    status: 'OK', 
    message: 'Footprint Logger API is running on Render',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    websocket_connections: authenticatedSockets ? authenticatedSockets.size : 0,
    memory_usage: process.memoryUsage()
  });
});

// Add wake endpoint for Render's sleep/wake cycle
app.get('/wake', (req, res) => {
  res.status(200).json({ 
    message: 'Server is awake!',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware - more detailed in development
app.use((error, req, res, next) => {
  console.error('Error occurred:', error);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(error.status || 500).json({
    error: isDevelopment ? error.message : 'Internal server error',
    ...(isDevelopment && { stack: error.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

module.exports = app;