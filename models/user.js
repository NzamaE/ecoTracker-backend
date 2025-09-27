// models/User.js - Enhanced User model with goal tracking
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Goal schemas for better structure
const weeklyGoalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  category: {
    type: String,
    enum: ['transport', 'energy', 'food', 'waste', 'all'],
    default: 'all'
  },
  goalType: {
    type: String,
    enum: ['percentage', 'absolute'],
    required: true
  },
  targetReduction: {
    type: Number,
    required: true,
    min: 0
  },
  baselineEmissions: {
    type: Number,
    required: true,
    min: 0
  },
  targetEmissions: {
    type: Number,
    required: true,
    min: 0
  },
  currentProgress: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false }); // Don't create separate _id for subdocuments

const emissionGoalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetEmissions: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    enum: ['transport', 'energy', 'food', 'waste', 'all'],
    default: 'all'
  },
  timeframe: {
    type: String,
    enum: ['weekly', 'monthly'],
    required: true
  },
  baselineEmissions: {
    type: Number,
    required: true,
    min: 0
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// User preferences for notifications
const notificationPreferencesSchema = new mongoose.Schema({
  weeklyInsights: {
    type: Boolean,
    default: true
  },
  goalMilestones: {
    type: Boolean,
    default: true
  },
  trendAlerts: {
    type: Boolean,
    default: true
  },
  activityTips: {
    type: Boolean,
    default: true
  },
  goalStatusUpdates: {
    type: Boolean,
    default: true
  },
  emailNotifications: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: { 
    type: String, 
    required: true,
    minlength: 6
  },
  
  // Enhanced goal tracking fields
  currentWeeklyGoal: {
    type: weeklyGoalSchema,
    default: null
  },
  weeklyGoalHistory: [weeklyGoalSchema],
  
  // New emission goal tracking
  currentEmissionGoal: {
    type: emissionGoalSchema,
    default: null
  },
  emissionGoalHistory: [emissionGoalSchema],
  
  // User preferences
  notificationPreferences: {
    type: notificationPreferencesSchema,
    default: () => ({})
  },
  
  // User statistics (for quick access)
  stats: {
    totalActivitiesLogged: {
      type: Number,
      default: 0
    },
    totalCarbonFootprint: {
      type: Number,
      default: 0
    },
    lastActivityDate: {
      type: Date,
      default: null
    },
    joinedChallenges: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Challenge'
    }]
  },
  
  // Account settings
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    this.password = await bcrypt.hash(this.password, 10);
    next();
  } catch (error) {
    next(error);
  }
});

// Update last login timestamp
userSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  return this.save();
};

// Check if user has active weekly goal
userSchema.methods.hasActiveWeeklyGoal = function() {
  return this.currentWeeklyGoal && 
         this.currentWeeklyGoal.status === 'active' && 
         new Date() <= this.currentWeeklyGoal.endDate;
};

// Check if user has active emission goal
userSchema.methods.hasActiveEmissionGoal = function() {
  return this.currentEmissionGoal && 
         this.currentEmissionGoal.status === 'active' && 
         new Date() <= this.currentEmissionGoal.endDate;
};

// Get notification preferences for specific type
userSchema.methods.shouldReceiveNotification = function(notificationType) {
  const preferences = this.notificationPreferences || {};
  return preferences[notificationType] !== false; // Default to true if not set
};

// Update user statistics (called when activities are added/updated)
userSchema.methods.updateStats = async function(activityData) {
  if (activityData.isNew) {
    this.stats.totalActivitiesLogged = (this.stats.totalActivitiesLogged || 0) + 1;
  }
  
  if (activityData.carbonFootprint !== undefined) {
    this.stats.totalCarbonFootprint = (this.stats.totalCarbonFootprint || 0) + activityData.carbonFootprint;
  }
  
  this.stats.lastActivityDate = new Date();
  
  return this.save();
};

// Archive expired goals (utility method)
userSchema.methods.archiveExpiredGoals = function() {
  const now = new Date();
  
  // Archive expired weekly goal
  if (this.currentWeeklyGoal && 
      this.currentWeeklyGoal.status === 'active' && 
      now > this.currentWeeklyGoal.endDate) {
    this.currentWeeklyGoal.status = 'completed';
    this.weeklyGoalHistory.push(this.currentWeeklyGoal);
    this.currentWeeklyGoal = null;
  }
  
  // Archive expired emission goal
  if (this.currentEmissionGoal && 
      this.currentEmissionGoal.status === 'active' && 
      now > this.currentEmissionGoal.endDate) {
    this.currentEmissionGoal.status = 'completed';
    this.emissionGoalHistory.push(this.currentEmissionGoal);
    this.currentEmissionGoal = null;
  }
  
  return this.save();
};

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive data from JSON output
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

// Static method to find users with active goals (for batch processing)
userSchema.statics.findUsersWithActiveGoals = function() {
  return this.find({
    $or: [
      { 'currentWeeklyGoal.status': 'active' },
      { 'currentEmissionGoal.status': 'active' }
    ],
    isActive: true
  });
};

// Indexes for efficient queries
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ 'currentWeeklyGoal.endDate': 1 });
userSchema.index({ 'currentEmissionGoal.endDate': 1 });
userSchema.index({ isActive: 1 });

module.exports = mongoose.model('User', userSchema);