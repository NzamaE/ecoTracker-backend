// models/Activity.js - Activity model with automatic carbon calculation
const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  activityName: {
    type: String,
    required: [true, 'Activity name is required'],
    trim: true,
    maxlength: [100, 'Activity name cannot exceed 100 characters']
  },
  activityType: {
    type: String,
    required: [true, 'Activity type is required'],
    enum: {
      values: ['transport', 'energy', 'food', 'waste', 'other'],
      message: 'Activity type must be one of: transport, energy, food, waste, other'
    }
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  quantity: {
    value: {
      type: Number,
      required: [true, 'Quantity value is required'],
      min: [0, 'Quantity value cannot be negative']
    },
    unit: {
      type: String,
      required: [true, 'Quantity unit is required'],
      enum: {
        values: [
          // Distance units
          'km', 'miles', 'm',
          // Volume units
          'L', 'gallons', 'ml',
          // Time units
          'hours', 'minutes', 'days',
          // Weight units
          'kg', 'lbs', 'g',
          // Energy units
          'kWh', 'MWh', 'BTU',
          // Count units
          'items', 'pieces', 'servings'
        ],
        message: 'Invalid quantity unit'
      }
    }
  },
  // Specific activity details for carbon calculation
  activityDetails: {
    // Transport specific
    transportMode: {
      type: String,
      enum: ['car_gasoline', 'car_diesel', 'car_electric', 'car_hybrid', 'bus', 'train', 'plane_domestic', 'plane_international', 'motorcycle', 'bicycle', 'walking']
    },
    fuelEfficiency: Number, // km/L or mpg
    
    // Energy specific
    energySource: {
      type: String,
      enum: ['coal', 'natural_gas', 'solar', 'wind', 'hydro', 'nuclear', 'grid_average']
    },
    
    // Food specific
    foodType: {
      type: String,
      enum: ['beef', 'pork', 'chicken', 'fish', 'dairy_milk', 'dairy_cheese', 'vegetables', 'fruits', 'grains', 'processed_food']
    },
    
    // Waste specific
    wasteType: {
      type: String,
      enum: ['general_waste', 'recycling', 'compost', 'hazardous']
    },
    disposalMethod: {
      type: String,
      enum: ['landfill', 'incineration', 'recycling', 'composting']
    }
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
    default: Date.now
  },
  // System calculated carbon footprint
  carbonFootprint: {
    type: Number,
    min: [0, 'Carbon footprint cannot be negative'],
    default: 0
  },
  // Calculation metadata
  calculationMethod: {
    type: String,
    default: 'system_calculated'
  },
  emissionFactor: {
    type: Number, // The emission factor used in calculation
    default: 0
  }
}, {
  timestamps: true
});

// Virtual field to format quantity display
activitySchema.virtual('formattedQuantity').get(function() {
  return `${this.quantity.value}${this.quantity.unit}`;
});

// Pre-save middleware to calculate carbon footprint
activitySchema.pre('save', function(next) {
  if (this.isNew || this.isModified(['quantity', 'activityType', 'activityDetails'])) {
    const result = this.calculateCarbonFootprint();
    this.carbonFootprint = result.carbonFootprint || result; // Handle both old and new format
    this.emissionFactor = result.emissionFactor || 0;
  }
  next();
});


// Method to calculate carbon footprint based on activity data
activitySchema.methods.calculateCarbonFootprint = function() {
  const { activityType, quantity, activityDetails } = this;
  
  let carbonFootprint = 0;
  let emissionFactor = 0;
  
  switch (activityType) {
    case 'transport':
      ({ carbonFootprint, emissionFactor } = this.calculateTransportEmissions());
      break;
    case 'energy':
      ({ carbonFootprint, emissionFactor } = this.calculateEnergyEmissions());
      break;
    case 'food':
      ({ carbonFootprint, emissionFactor } = this.calculateFoodEmissions());
      break;
    case 'waste':
      ({ carbonFootprint, emissionFactor } = this.calculateWasteEmissions());
      break;
    default:
      carbonFootprint = 0;
      emissionFactor = 0;
  }
  
 
    this.emissionFactor = emissionFactor;
  return { 
    carbonFootprint: Math.round(carbonFootprint * 100) / 100,
    emissionFactor 
  };
};

// Transport emissions calculation
activitySchema.methods.calculateTransportEmissions = function() {
  const { quantity, activityDetails } = this;
  let emissionFactor = 0; // kg CO2 per km
  
  // Convert distance to km if needed
  let distanceKm = quantity.value;
  if (quantity.unit === 'miles') {
    distanceKm = quantity.value * 1.60934;
  } else if (quantity.unit === 'm') {
    distanceKm = quantity.value / 1000;
  }
  
  // Emission factors (kg CO2 per km)
  const transportEmissions = {
    car_gasoline: 0.21,
    car_diesel: 0.17,
    car_electric: 0.05,
    car_hybrid: 0.12,
    bus: 0.08,
    train: 0.04,
    plane_domestic: 0.25,
    plane_international: 0.30,
    motorcycle: 0.15,
    bicycle: 0,
    walking: 0
  };
  
  emissionFactor = transportEmissions[activityDetails?.transportMode] || 0.21; // Default to gasoline car
  const carbonFootprint = distanceKm * emissionFactor;
  
  return { carbonFootprint, emissionFactor };
};

// Energy emissions calculation
activitySchema.methods.calculateEnergyEmissions = function() {
  const { quantity, activityDetails } = this;
  let emissionFactor = 0; // kg CO2 per kWh
  
  // Convert energy to kWh if needed
  let energykWh = quantity.value;
  if (quantity.unit === 'MWh') {
    energykWh = quantity.value * 1000;
  } else if (quantity.unit === 'BTU') {
    energykWh = quantity.value * 0.000293071;
  }
  
  // Emission factors (kg CO2 per kWh)
  const energyEmissions = {
    coal: 0.82,
    natural_gas: 0.49,
    solar: 0.05,
    wind: 0.02,
    hydro: 0.03,
    nuclear: 0.06,
    grid_average: 0.45 // Average grid mix
  };
  
  emissionFactor = energyEmissions[activityDetails?.energySource] || 0.45;
  const carbonFootprint = energykWh * emissionFactor;
  
  return { carbonFootprint, emissionFactor };
};

// Food emissions calculation
activitySchema.methods.calculateFoodEmissions = function() {
  const { quantity, activityDetails } = this;
  let emissionFactor = 0; // kg CO2 per kg or serving
  
  // Convert weight to kg if needed
  let weightKg = quantity.value;
  if (quantity.unit === 'lbs') {
    weightKg = quantity.value * 0.453592;
  } else if (quantity.unit === 'g') {
    weightKg = quantity.value / 1000;
  } else if (quantity.unit === 'servings') {
    // Assume average serving is 0.25kg
    weightKg = quantity.value * 0.25;
  }
  
  // Emission factors (kg CO2 per kg of food)
  const foodEmissions = {
    beef: 27.0,
    pork: 12.1,
    chicken: 6.9,
    fish: 6.1,
    dairy_milk: 3.2,
    dairy_cheese: 13.5,
    vegetables: 2.0,
    fruits: 1.1,
    grains: 1.4,
    processed_food: 3.5
  };
  
  emissionFactor = foodEmissions[activityDetails?.foodType] || 2.0;
  const carbonFootprint = weightKg * emissionFactor;
  
  return { carbonFootprint, emissionFactor };
};

// Waste emissions calculation
activitySchema.methods.calculateWasteEmissions = function() {
  const { quantity, activityDetails } = this;
  let emissionFactor = 0; // kg CO2 per kg of waste
  
  // Convert weight to kg if needed
  let weightKg = quantity.value;
  if (quantity.unit === 'lbs') {
    weightKg = quantity.value * 0.453592;
  } else if (quantity.unit === 'g') {
    weightKg = quantity.value / 1000;
  }
  
  // Emission factors (kg CO2 per kg of waste)
  const wasteEmissions = {
    general_waste: {
      landfill: 0.5,
      incineration: 0.3
    },
    recycling: -0.1, // Negative because it saves emissions
    compost: 0.1,
    hazardous: 2.0
  };
  
  const wasteType = activityDetails?.wasteType || 'general_waste';
  const disposalMethod = activityDetails?.disposalMethod || 'landfill';
  
  if (wasteType === 'general_waste') {
    emissionFactor = wasteEmissions.general_waste[disposalMethod] || 0.5;
  } else {
    emissionFactor = wasteEmissions[wasteType] || 0.5;
  }
  
  const carbonFootprint = weightKg * emissionFactor;
  
  return { carbonFootprint, emissionFactor };
};

// Index for efficient queries
activitySchema.index({ userId: 1, date: -1 });
activitySchema.index({ userId: 1, activityType: 1 });
activitySchema.index({ userId: 1, activityName: 1 });

// Ensure virtual fields are serialized
activitySchema.set('toJSON', { virtuals: true });
activitySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Activity', activitySchema);