// routes/activities.js - Corrected version
const express = require('express');
const Activity = require('../models/Activity');
const User = require('../models/user'); // ✅ ADD THIS MISSING IMPORT
const { authenticateToken } = require('../middleware/auth');
const { validateActivity } = require('../middleware/validation');

const router = express.Router();

// All routes are protected
router.use(authenticateToken);

// Add new activity (carbon footprint calculated automatically + real-time tips)
router.post('/', validateActivity, async (req, res) => {
  try {
    const { 
      activityName, 
      activityType, 
      description, 
      quantity, 
      activityDetails,
      date 
    } = req.body;

    const activity = new Activity({
      userId: req.user._id,
      activityName,
      activityType,
      description,
      quantity: {
        value: quantity.value,
        unit: quantity.unit
      },
      activityDetails: activityDetails || {},
      date: date || Date.now()
    });

    // Carbon footprint is calculated automatically via pre-save middleware
    await activity.save();

    // Generate real-time tip after activity is saved
    const tip = await generateRealTimeTip(req.user._id, activity);
    
    // Send tip via WebSocket if available
    const io = req.app.get('io');
    if (io && tip) {
      try {
        const user = await User.findById(req.user._id);
        // ✅ FIXED: Handle case where shouldReceiveNotification method might not exist
        const shouldSendNotification = user && typeof user.shouldReceiveNotification === 'function' 
          ? user.shouldReceiveNotification('activityTips') 
          : true; // Default to true if method doesn't exist
          
        if (shouldSendNotification) {
          io.to(`user:${req.user._id}`).emit('activity_tip', {
            activity: {
              id: activity._id,
              name: activity.activityName,
              type: activity.activityType,
              emissions: activity.carbonFootprint
            },
            tip
          });
        }
      } catch (wsError) {
        console.error('WebSocket notification error:', wsError);
        // Don't fail the request if WebSocket fails
      }
    }

    // Update user statistics
    try {
      const user = await User.findById(req.user._id);
      if (user && typeof user.updateStats === 'function') {
        await user.updateStats({
          isNew: true,
          carbonFootprint: activity.carbonFootprint
        });
      }
    } catch (statsError) {
      console.error('Error updating user stats:', statsError);
      // Don't fail the request if stats update fails
    }

    res.status(201).json({
      message: 'Activity logged successfully',
      activity: {
        ...activity.toObject(),
        calculatedCarbonFootprint: activity.carbonFootprint,
        emissionFactor: activity.emissionFactor
      },
      // Include tip in response for clients that don't use WebSocket
      ...(tip && { realTimeTip: tip })
    });
  } catch (error) {
    console.error('Activity creation error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: Object.values(error.errors).map(e => e.message) 
      });
    }
    res.status(500).json({ error: 'Error creating activity log' });
  }
});

// Helper function to generate real-time tips
async function generateRealTimeTip(userId, newActivity) {
  try {
    // Get user's current emission goal (if exists)
    const user = await User.findById(userId);
    const currentGoal = user?.currentEmissionGoal;
    
    if (!currentGoal || new Date() > currentGoal.endDate) {
      // No active goal - provide general tips based on activity
      return generateGeneralTip(newActivity);
    }

    // Calculate current progress against goal
    const goalStartDate = new Date(currentGoal.startDate);
    const currentActivities = await Activity.find({
      userId,
      date: { $gte: goalStartDate },
      ...(currentGoal.category !== 'all' && { activityType: currentGoal.category })
    });

    const currentEmissions = currentActivities.reduce((sum, activity) => sum + activity.carbonFootprint, 0);
    const remainingBudget = currentGoal.targetEmissions - currentEmissions;
    const daysRemaining = Math.ceil((currentGoal.endDate - new Date()) / (24 * 60 * 60 * 1000));
    
    // Generate contextual tip based on goal progress
    let tip = null;

    // Critical: Exceeding goal
    if (remainingBudget <= 0) {
      tip = {
        type: 'warning',
        title: 'Goal Budget Exceeded!',
        message: `You've exceeded your ${currentGoal.timeframe} emission goal by ${Math.abs(remainingBudget).toFixed(1)} kg CO₂. Consider lower-emission alternatives.`,
        priority: 'high',
        category: currentGoal.category,
        actionable: true,
        suggestions: getAlternativeSuggestions(newActivity)
      };
    }
    // Alert: Close to limit (within 10%)
    else if (remainingBudget < currentGoal.targetEmissions * 0.1) {
      tip = {
        type: 'alert',
        title: 'Approaching Goal Limit',
        message: `Only ${remainingBudget.toFixed(1)} kg CO₂ remaining in your ${currentGoal.timeframe} budget with ${daysRemaining} days left.`,
        priority: 'medium',
        category: currentGoal.category,
        actionable: true,
        suggestions: getLowEmissionSuggestions(newActivity.activityType)
      };
    }
    // Info: Above average emissions for this activity type
    else if (newActivity.carbonFootprint > await getActivityTypeAverage(userId, newActivity.activityType)) {
      tip = {
        type: 'info',
        title: 'Optimization Opportunity',
        message: `This ${newActivity.activityType} activity produced ${newActivity.carbonFootprint.toFixed(1)} kg CO₂. You have ${remainingBudget.toFixed(1)} kg remaining in your goal.`,
        priority: 'low',
        category: newActivity.activityType,
        actionable: true,
        suggestions: getOptimizationSuggestions(newActivity)
      };
    }
    // Success: Doing well
    else if (currentEmissions <= currentGoal.targetEmissions * 0.5 && daysRemaining > 1) {
      tip = {
        type: 'success',
        title: 'Great Progress!',
        message: `You're ${((1 - currentEmissions/currentGoal.targetEmissions) * 100).toFixed(0)}% under your ${currentGoal.timeframe} goal. Keep it up!`,
        priority: 'low',
        category: currentGoal.category,
        actionable: false,
        suggestions: []
      };
    }

    return tip;

  } catch (error) {
    console.error('Error generating real-time tip:', error);
    return null;
  }
}

// Generate tips for users without active goals
function generateGeneralTip(activity) {
  const highEmissionThresholds = {
    transport: 10, // > 10 kg CO2
    food: 5,       // > 5 kg CO2
    energy: 8,     // > 8 kg CO2
    waste: 2       // > 2 kg CO2
  };

  const threshold = highEmissionThresholds[activity.activityType] || 3;
  
  if (activity.carbonFootprint > threshold) {
    return {
      type: 'info',
      title: 'High Carbon Activity',
      message: `This ${activity.activityType} activity produced ${activity.carbonFootprint.toFixed(1)} kg CO₂. Consider setting an emission goal to track your progress!`,
      priority: 'low',
      category: activity.activityType,
      actionable: true,
      suggestions: getAlternativeSuggestions(activity)
    };
  }

  // Positive reinforcement for low-emission activities
  if (activity.carbonFootprint < 1) {
    return {
      type: 'success',
      title: 'Low Carbon Choice!',
      message: `This ${activity.activityType} activity only produced ${activity.carbonFootprint.toFixed(2)} kg CO₂.`,
      priority: 'low',
      category: activity.activityType,
      actionable: false,
      suggestions: []
    };
  }

  return null; // No tip for moderate emissions without goals
}

// Helper functions
function getAlternativeSuggestions(activity) {
  const suggestions = {
    transport: [
      'Try walking or cycling for short trips',
      'Use public transport instead of driving',
      'Combine multiple errands into one trip',
      'Consider carpooling or ride-sharing'
    ],
    food: [
      'Choose more plant-based meals',
      'Buy local, seasonal produce',
      'Reduce portion sizes to minimize waste',
      'Try one meat-free day per week'
    ],
    energy: [
      'Use energy-efficient LED lighting',
      'Unplug devices when not in use',
      'Adjust thermostat by 2°C',
      'Switch to renewable energy if available'
    ],
    waste: [
      'Recycle whenever possible',
      'Compost organic waste',
      'Buy products with minimal packaging',
      'Repair items instead of replacing them'
    ]
  };

  return suggestions[activity.activityType] || [
    'Look for lower-emission alternatives',
    'Consider reducing frequency of this activity',
    'Research eco-friendly options for this activity'
  ];
}

function getLowEmissionSuggestions(activityType) {
  const suggestions = {
    transport: ['Walk', 'Bicycle', 'Public transport', 'Electric vehicle'],
    food: ['Vegetables', 'Fruits', 'Local produce', 'Plant-based proteins'],
    energy: ['LED lighting', 'Natural light', 'Energy-efficient appliances'],
    waste: ['Recycling', 'Composting', 'Reusable items', 'Minimal packaging']
  };

  return suggestions[activityType] || ['Eco-friendly alternatives'];
}

function getOptimizationSuggestions(activity) {
  const suggestions = [];
  
  if (activity.activityType === 'transport') {
    if (activity.activityDetails?.transportMode === 'car_gasoline') {
      suggestions.push('Consider hybrid or electric vehicle');
      suggestions.push('Carpool when possible');
      suggestions.push('Plan efficient routes');
    }
    if (activity.activityDetails?.transportMode === 'plane_international') {
      suggestions.push('Consider direct flights (more efficient)');
      suggestions.push('Offset your flight emissions');
    }
  } else if (activity.activityType === 'food') {
    if (activity.activityDetails?.foodType === 'beef') {
      suggestions.push('Try chicken or fish alternatives');
      suggestions.push('Consider plant-based proteins');
      suggestions.push('Reduce portion size');
    }
  } else if (activity.activityType === 'energy') {
    suggestions.push('Switch to renewable energy sources');
    suggestions.push('Improve home insulation');
    suggestions.push('Use smart thermostats');
  }
  
  return suggestions.length > 0 ? suggestions : ['Look for more efficient options'];
}

// ✅ FIXED: Calculate user's average for activity type
async function getActivityTypeAverage(userId, activityType) {
  try {
    const mongoose = require('mongoose');
    const stats = await Activity.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(userId), // ✅ FIXED: Added 'new'
          activityType: activityType,
          date: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
        } 
      },
      { 
        $group: { 
          _id: null, 
          avgEmissions: { $avg: '$carbonFootprint' } 
        } 
      }
    ]);
    
    return stats[0]?.avgEmissions || getGlobalActivityTypeAverage(activityType);
  } catch (error) {
    return getGlobalActivityTypeAverage(activityType);
  }
}

function getGlobalActivityTypeAverage(activityType) {
  // Global averages as fallback
  const averages = {
    transport: 5.0,
    food: 3.0,
    energy: 2.5,
    waste: 1.0,
    other: 2.0
  };
  
  return averages[activityType] || 2.0;
}

// ========================================
// All your existing routes remain the same
// ========================================

// Get user's activities with filtering and pagination
router.get('/', async (req, res) => {
  console.log('🔍 REQUEST HIT - User:', req.user?._id, 'Query:', req.query);
  try {
    const { 
      startDate, 
      endDate, 
      activityType, 
      activityName,
      page = 1, 
      limit = 50 
    } = req.query;
    
    let query = { userId: req.user._id };

    // Date filtering
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // Activity type filtering
    if (activityType && activityType !== 'all') {
      query.activityType = activityType;
    }

    // Activity name filtering (case-insensitive partial match)
    if (activityName) {
      query.activityName = { $regex: activityName, $options: 'i' };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const activities = await Activity.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    console.log('🔍 FOUND', activities.length, 'activities for user', req.user._id);

    const total = await Activity.countDocuments(query);

    // Calculate total carbon footprint for filtered results
    const totalCarbonFootprint = await Activity.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$carbonFootprint' } } }
    ]);

    res.json({
      activities,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / parseInt(limit)),
        count: activities.length,
        totalCount: total
      },
      summary: {
        totalCarbonFootprint: totalCarbonFootprint[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Activities fetch error:', error);
    res.status(500).json({ error: 'Error fetching activities' });
  }
});

// Get single activity
router.get('/:id', async (req, res) => {
  try {
    const activity = await Activity.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json(activity);
  } catch (error) {
    console.error('Activity fetch error:', error);
    res.status(500).json({ error: 'Error fetching activity' });
  }
});

// Update activity (carbon footprint recalculated automatically)
router.put('/:id', validateActivity, async (req, res) => {
  try {
    const { 
      activityName, 
      activityType, 
      description, 
      quantity, 
      activityDetails,
      date 
    } = req.body;

    const updateData = {
      activityName,
      activityType,
      description,
      quantity: {
        value: quantity.value,
        unit: quantity.unit
      },
      activityDetails: activityDetails || {},
      date
    };

    // Find and update the activity
    const activity = await Activity.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json({
      message: 'Activity updated successfully',
      activity: {
        ...activity.toObject(),
        calculatedCarbonFootprint: activity.carbonFootprint,
        emissionFactor: activity.emissionFactor
      }
    });
  } catch (error) {
    console.error('Activity update error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: Object.values(error.errors).map(e => e.message) 
      });
    }
    res.status(500).json({ error: 'Error updating activity' });
  }
});

// Delete activity
router.delete('/:id', async (req, res) => {
  try {
    const activity = await Activity.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json({ 
      message: 'Activity deleted successfully',
      deletedActivity: {
        activityName: activity.activityName,
        carbonFootprint: activity.carbonFootprint
      }
    });
  } catch (error) {
    console.error('Activity deletion error:', error);
    res.status(500).json({ error: 'Error deleting activity' });
  }
});

// Get activity statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const { startDate, endDate, activityType } = req.query;
    let matchQuery = { userId: req.user._id };

    // Date filtering
    if (startDate || endDate) {
      matchQuery.date = {};
      if (startDate) matchQuery.date.$gte = new Date(startDate);
      if (endDate) matchQuery.date.$lte = new Date(endDate);
    }

    // Activity type filtering
    if (activityType) {
      matchQuery.activityType = activityType;
    }

    const stats = await Activity.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalActivities: { $sum: 1 },
          totalCarbonFootprint: { $sum: '$carbonFootprint' },
          avgCarbonFootprint: { $avg: '$carbonFootprint' },
          maxCarbonFootprint: { $max: '$carbonFootprint' },
          minCarbonFootprint: { $min: '$carbonFootprint' }
        }
      }
    ]);

    const typeBreakdown = await Activity.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$activityType',
          count: { $sum: 1 },
          totalCarbon: { $sum: '$carbonFootprint' }
        }
      },
      { $sort: { totalCarbon: -1 } }
    ]);

    res.json({
      summary: stats[0] || {
        totalActivities: 0,
        totalCarbonFootprint: 0,
        avgCarbonFootprint: 0,
        maxCarbonFootprint: 0,
        minCarbonFootprint: 0
      },
      breakdown: typeBreakdown
    });
  } catch (error) {
    console.error('Activity stats error:', error);
    res.status(500).json({ error: 'Error fetching activity statistics' });
  }
});

// Get emission factors for reference (helpful for frontend)
router.get('/reference/emission-factors', async (req, res) => {
  try {
    const emissionFactors = {
      transport: {
        car_gasoline: { factor: 0.21, unit: 'kg CO2/km', description: 'Gasoline car' },
        car_diesel: { factor: 0.17, unit: 'kg CO2/km', description: 'Diesel car' },
        car_electric: { factor: 0.05, unit: 'kg CO2/km', description: 'Electric car' },
        car_hybrid: { factor: 0.12, unit: 'kg CO2/km', description: 'Hybrid car' },
        bus: { factor: 0.08, unit: 'kg CO2/km', description: 'Public bus' },
        train: { factor: 0.04, unit: 'kg CO2/km', description: 'Train' },
        plane_domestic: { factor: 0.25, unit: 'kg CO2/km', description: 'Domestic flight' },
        plane_international: { factor: 0.30, unit: 'kg CO2/km', description: 'International flight' },
        motorcycle: { factor: 0.15, unit: 'kg CO2/km', description: 'Motorcycle' },
        bicycle: { factor: 0, unit: 'kg CO2/km', description: 'Bicycle' },
        walking: { factor: 0, unit: 'kg CO2/km', description: 'Walking' }
      },
      energy: {
        coal: { factor: 0.82, unit: 'kg CO2/kWh', description: 'Coal power' },
        natural_gas: { factor: 0.49, unit: 'kg CO2/kWh', description: 'Natural gas' },
        solar: { factor: 0.05, unit: 'kg CO2/kWh', description: 'Solar power' },
        wind: { factor: 0.02, unit: 'kg CO2/kWh', description: 'Wind power' },
        hydro: { factor: 0.03, unit: 'kg CO2/kWh', description: 'Hydroelectric' },
        nuclear: { factor: 0.06, unit: 'kg CO2/kWh', description: 'Nuclear power' },
        grid_average: { factor: 0.45, unit: 'kg CO2/kWh', description: 'Grid average' }
      },
      food: {
        beef: { factor: 27.0, unit: 'kg CO2/kg', description: 'Beef' },
        pork: { factor: 12.1, unit: 'kg CO2/kg', description: 'Pork' },
        chicken: { factor: 6.9, unit: 'kg CO2/kg', description: 'Chicken' },
        fish: { factor: 6.1, unit: 'kg CO2/kg', description: 'Fish' },
        dairy_milk: { factor: 3.2, unit: 'kg CO2/kg', description: 'Milk' },
        dairy_cheese: { factor: 13.5, unit: 'kg CO2/kg', description: 'Cheese' },
        vegetables: { factor: 2.0, unit: 'kg CO2/kg', description: 'Vegetables' },
        fruits: { factor: 1.1, unit: 'kg CO2/kg', description: 'Fruits' },
        grains: { factor: 1.4, unit: 'kg CO2/kg', description: 'Grains' },
        processed_food: { factor: 3.5, unit: 'kg CO2/kg', description: 'Processed food' }
      },
      waste: {
        general_waste_landfill: { factor: 0.5, unit: 'kg CO2/kg', description: 'General waste to landfill' },
        general_waste_incineration: { factor: 0.3, unit: 'kg CO2/kg', description: 'General waste incineration' },
        recycling: { factor: -0.1, unit: 'kg CO2/kg', description: 'Recycling (saves emissions)' },
        compost: { factor: 0.1, unit: 'kg CO2/kg', description: 'Composting' },
        hazardous: { factor: 2.0, unit: 'kg CO2/kg', description: 'Hazardous waste' }
      }
    };

    res.json({
      message: 'Emission factors reference',
      emissionFactors,
      notes: {
        transport: 'Factors are per kilometer traveled',
        energy: 'Factors are per kilowatt-hour consumed',
        food: 'Factors are per kilogram of food consumed',
        waste: 'Factors are per kilogram of waste generated'
      }
    });
  } catch (error) {
    console.error('Emission factors fetch error:', error);
    res.status(500).json({ error: 'Error fetching emission factors' });
  }
});

// ✅ FIXED: Calculate carbon footprint preview (without saving)
router.post('/calculate-preview', validateActivity, async (req, res) => {
  try {
    const { 
      activityType, 
      quantity, 
      activityDetails 
    } = req.body;

    // Create a temporary activity instance for calculation
    const tempActivity = new Activity({
      userId: req.user._id,
      activityName: 'temp',
      activityType,
      description: 'temp',
      quantity,
      activityDetails: activityDetails || {}
    });

    // ✅ FIXED: Your method returns an object, handle it properly
    const result = tempActivity.calculateCarbonFootprint();

    res.json({
      calculatedCarbonFootprint: result.carbonFootprint,
      emissionFactor: result.emissionFactor,
      unit: 'kg CO2',
      calculation: {
        quantity: tempActivity.formattedQuantity,
        activityType,
        activityDetails: activityDetails || {}
      }
    });
  } catch (error) {
    console.error('Carbon calculation preview error:', error);
    res.status(500).json({ error: 'Error calculating carbon footprint preview' });
  }
});

module.exports = router;
