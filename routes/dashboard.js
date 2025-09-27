// routes/dashboard.js - Dashboard and analytics routes
const express = require('express');
const Activity = require('../models/Activity');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All dashboard routes are protected
router.use(authenticateToken);

// Helper function to get date range
const getDateRange = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

// Get user dashboard data with community comparison
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.user._id;
    const thirtyDaysAgo = getDateRange(30);

    // Get user activities from last 30 days
    const userActivities = await Activity.find({
      userId,
      date: { $gte: thirtyDaysAgo }
    });

    // Calculate user's total emissions
    const totalEmissions = userActivities.reduce((sum, activity) => sum + activity.carbonFootprint, 0);

    // Get community stats using aggregation
    const communityStats = await Activity.aggregate([
      { $match: { date: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: '$userId',
          totalEmissions: { $sum: '$carbonFootprint' },
          activityCount: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          averageEmissions: { $avg: '$totalEmissions' },
          totalUsers: { $sum: 1 }
        }
      }
    ]);

    const communityAverage = communityStats[0]?.averageEmissions || 0;

    // Weekly breakdown for current user
    const weeklyData = [];
    for (let i = 0; i < 4; i++) {
      const weekStart = getDateRange(i * 7 + 6);
      const weekEnd = getDateRange(i * 7);

      const weekActivities = userActivities.filter(activity => {
        const activityDate = new Date(activity.date);
        return activityDate >= weekStart && activityDate <= weekEnd;
      });

      const weekTotal = weekActivities.reduce((sum, activity) => sum + activity.carbonFootprint, 0);

      weeklyData.unshift({
        week: `Week ${4 - i}`,
        emissions: parseFloat(weekTotal.toFixed(2)),
        activitiesCount: weekActivities.length
      });
    }

    // Emissions by category - FIXED: consistent field naming
    const emissionsByCategory = userActivities.reduce((acc, activity) => {
      const type = activity.activityType; // Consistently using activityType
      acc[type] = (acc[type] || 0) + activity.carbonFootprint;
      return acc;
    }, {});

    res.json({
      totalEmissions: parseFloat(totalEmissions.toFixed(2)),
      communityAverage: parseFloat(communityAverage.toFixed(2)),
      weeklyBreakdown: weeklyData,
      activitiesCount: userActivities.length,
      comparisonToCommunity: parseFloat((totalEmissions - communityAverage).toFixed(2)),
      emissionsByCategory: Object.keys(emissionsByCategory).map(type => ({
        type,
        emissions: parseFloat(emissionsByCategory[type].toFixed(2))
      })),
      performanceScore: totalEmissions <= communityAverage ? 'Above Average' : 'Below Average'
    });
  } catch (error) {
    console.error('Dashboard fetch error:', error);
    res.status(500).json({ error: 'Error fetching dashboard data' });
  }
});

// Get weekly summaries and streak tracking
router.get('/streak', async (req, res) => {
  try {
    const userId = req.user._id;
    const ninetyDaysAgo = getDateRange(90);

    const activities = await Activity.find({
      userId,
      date: { $gte: ninetyDaysAgo }
    }).sort({ date: -1 });

    // Group activities by date
    const dailyActivities = activities.reduce((acc, activity) => {
      const dateKey = activity.date.toISOString().split('T')[0];
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(activity);
      return acc;
    }, {});

    // Calculate current streak
    let currentStreak = 0;
    const today = new Date();

    for (let i = 0; i < 90; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const dateKey = checkDate.toISOString().split('T')[0];

      if (dailyActivities[dateKey]?.length > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Calculate longest streak - IMPROVED: better logic
    let longestStreak = 0;
    let tempStreak = 0;
    const sortedDates = Object.keys(dailyActivities).sort();

    for (let i = 0; i < sortedDates.length; i++) {
      const currentDate = new Date(sortedDates[i]);
      const nextDate = sortedDates[i + 1] ? new Date(sortedDates[i + 1]) : null;
      
      tempStreak++;
      
      const daysDiff = nextDate ? (nextDate - currentDate) / (24 * 60 * 60 * 1000) : Infinity;
      
      if (daysDiff > 1) { // Break in streak
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 0;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak); // Don't forget the last streak

    // Weekly summary for last 4 weeks
    const weeklySummary = [];
    for (let week = 0; week < 4; week++) {
      const weekStart = getDateRange(week * 7 + 6);
      const weekEnd = getDateRange(week * 7);

      const weekActivities = activities.filter(activity => {
        const activityDate = new Date(activity.date);
        return activityDate >= weekStart && activityDate <= weekEnd;
      });

      const daysWithActivity = new Set(
        weekActivities.map(activity => activity.date.toISOString().split('T')[0])
      );

      weeklySummary.unshift({
        week: week + 1,
        daysActive: daysWithActivity.size,
        totalActivities: weekActivities.length,
        totalEmissions: parseFloat(weekActivities.reduce((sum, a) => sum + a.carbonFootprint, 0).toFixed(2))
      });
    }

    res.json({
      currentStreak,
      longestStreak,
      weeklySummary,
      totalDays: Object.keys(dailyActivities).length,
      averageActivitiesPerDay: parseFloat((activities.length / Math.max(Object.keys(dailyActivities).length, 1)).toFixed(2))
    });
  } catch (error) {
    console.error('Streak fetch error:', error);
    res.status(500).json({ error: 'Error fetching streak data' });
  }
});

// Get leaderboard of low-footprint users
router.get('/leaderboard', async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const periodInt = Math.max(1, Math.min(365, parseInt(period))); // Validate period
    const daysAgo = getDateRange(periodInt);

    // Use aggregation pipeline for efficient leaderboard calculation
    const leaderboard = await Activity.aggregate([
      { $match: { date: { $gte: daysAgo } } },
      {
        $group: {
          _id: '$userId',
          totalEmissions: { $sum: '$carbonFootprint' },
          activityCount: { $sum: 1 }
        }
      },
      { $match: { activityCount: { $gte: 5 } } }, // Only users with at least 5 activities
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          username: '$user.username',
          totalEmissions: { $round: ['$totalEmissions', 2] },
          activityCount: 1,
          averagePerActivity: { $round: [{ $divide: ['$totalEmissions', '$activityCount'] }, 2] }
        }
      },
      { $sort: { totalEmissions: 1 } },
      { $limit: 10 }
    ]);

    // Add rank to each user
    const rankedLeaderboard = leaderboard.map((user, index) => ({
      rank: index + 1,
      ...user
    }));

    // Find current user's position - IMPROVED: single aggregation
    const [currentUserStats] = await Activity.aggregate([
      {
        $match: {
          userId: req.user._id,
          date: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalEmissions: { $sum: '$carbonFootprint' },
          activityCount: { $sum: 1 }
        }
      }
    ]);

    let currentUserRank = null;
    if (currentUserStats && currentUserStats.activityCount >= 5) {
      const [rankData] = await Activity.aggregate([
        { $match: { date: { $gte: daysAgo } } },
        {
          $group: {
            _id: '$userId',
            totalEmissions: { $sum: '$carbonFootprint' },
            activityCount: { $sum: 1 }
          }
        },
        { $match: { activityCount: { $gte: 5 } } },
        {
          $group: {
            _id: null,
            users: {
              $push: {
                userId: '$_id',
                totalEmissions: '$totalEmissions'
              }
            }
          }
        },
        {
          $project: {
            rank: {
              $add: [
                {
                  $size: {
                    $filter: {
                      input: '$users',
                      cond: { $lt: ['$$this.totalEmissions', currentUserStats.totalEmissions] }
                    }
                  }
                },
                1
              ]
            }
          }
        }
      ]);
      
      currentUserRank = rankData?.rank || null;
    }

    res.json({
      leaderboard: rankedLeaderboard,
      currentUser: currentUserStats ? {
        rank: currentUserRank,
        totalEmissions: parseFloat(currentUserStats.totalEmissions.toFixed(2)),
        activityCount: currentUserStats.activityCount,
        averagePerActivity: parseFloat((currentUserStats.totalEmissions / currentUserStats.activityCount).toFixed(2))
      } : null,
      period: `${periodInt} days`
    });
  } catch (error) {
    console.error('Leaderboard fetch error:', error);
    res.status(500).json({ error: 'Error fetching leaderboard' });
  }
});

// Get user statistics
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user._id;
    const { period = '30' } = req.query;
    const periodInt = Math.max(1, Math.min(365, parseInt(period)));
    const daysAgo = getDateRange(periodInt);

    // FIXED: Consistent field naming throughout
    const stats = await Activity.aggregate([
      {
        $match: {
          userId: userId,
          date: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: '$activityType', // Consistently using activityType
          count: { $sum: 1 },
          totalEmissions: { $sum: '$carbonFootprint' },
          averageEmissions: { $avg: '$carbonFootprint' }
        }
      },
      {
        $project: {
          activityType: '$_id',
          count: 1,
          totalEmissions: { $round: ['$totalEmissions', 2] },
          averageEmissions: { $round: ['$averageEmissions', 2] }
        }
      },
      { $sort: { totalEmissions: -1 } }
    ]);

    // Overall totals
    const [overallStats] = await Activity.aggregate([
      {
        $match: {
          userId: userId,
          date: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: null,
          totalActivities: { $sum: 1 },
          totalEmissions: { $sum: '$carbonFootprint' },
          averageEmissions: { $avg: '$carbonFootprint' },
          minEmissions: { $min: '$carbonFootprint' },
          maxEmissions: { $max: '$carbonFootprint' }
        }
      }
    ]);

    res.json({
      byCategory: stats,
      overall: overallStats ? {
        totalActivities: overallStats.totalActivities,
        totalEmissions: parseFloat(overallStats.totalEmissions.toFixed(2)),
        averageEmissions: parseFloat(overallStats.averageEmissions.toFixed(2)),
        minEmissions: parseFloat(overallStats.minEmissions.toFixed(2)),
        maxEmissions: parseFloat(overallStats.maxEmissions.toFixed(2))
      } : {
        totalActivities: 0,
        totalEmissions: 0,
        averageEmissions: 0,
        minEmissions: 0,
        maxEmissions: 0
      },
      period: `${periodInt} days`
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Error fetching statistics' });
  }
});

module.exports = router;