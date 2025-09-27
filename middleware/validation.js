// middleware/validation.js - Input validation middleware
const validateRegistration = (req, res, next) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ 
      error: 'Username, email, and password are required' 
    });
  }

  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ 
      error: 'Username must be between 3 and 30 characters' 
    });
  }

  if (password.length < 6) {
    return res.status(400).json({ 
      error: 'Password must be at least 6 characters long' 
    });
  }

  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      error: 'Please enter a valid email address' 
    });
  }

  next();
};

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required' 
    });
  }

  next();
};

const validateActivity = (req, res, next) => {
  const { activityName, activityType, description, quantity, activityDetails } = req.body;

  // Check required fields
  if (!activityName || !activityType || !description || !quantity) {
    return res.status(400).json({ 
      error: 'Activity name, activity type, description, and quantity are required' 
    });
  }

  // Validate activity name
  if (activityName.trim().length === 0) {
    return res.status(400).json({ 
      error: 'Activity name cannot be empty' 
    });
  }

  if (activityName.length > 100) {
    return res.status(400).json({ 
      error: 'Activity name cannot exceed 100 characters' 
    });
  }

  // Validate activity type
  const validTypes = ['transport', 'energy', 'food', 'waste', 'other'];
  if (!validTypes.includes(activityType)) {
    return res.status(400).json({ 
      error: `Activity type must be one of: ${validTypes.join(', ')}` 
    });
  }

  // Validate description
  if (description.trim().length === 0) {
    return res.status(400).json({ 
      error: 'Description cannot be empty' 
    });
  }

  if (description.length > 500) {
    return res.status(400).json({ 
      error: 'Description cannot exceed 500 characters' 
    });
  }

  // Validate quantity object
  if (!quantity.value || !quantity.unit) {
    return res.status(400).json({ 
      error: 'Quantity must include both value and unit' 
    });
  }

  // Validate quantity value
  if (typeof quantity.value !== 'number' || isNaN(quantity.value)) {
    return res.status(400).json({ 
      error: 'Quantity value must be a valid number' 
    });
  }

  if (quantity.value <= 0) {
    return res.status(400).json({ 
      error: 'Quantity value must be greater than 0' 
    });
  }

  // Validate quantity unit
  const validUnits = [
    'km', 'miles', 'm',           // Distance
    'L', 'gallons', 'ml',         // Volume
    'hours', 'minutes', 'days',   // Time
    'kg', 'lbs', 'g',            // Weight
    'kWh', 'MWh', 'BTU',         // Energy
    'items', 'pieces', 'servings' // Count
  ];

  if (!validUnits.includes(quantity.unit)) {
    return res.status(400).json({ 
      error: `Quantity unit must be one of: ${validUnits.join(', ')}` 
    });
  }

  // Validate activity-specific details based on type
  if (activityDetails) {
    const validationResult = validateActivityDetails(activityType, activityDetails);
    if (!validationResult.isValid) {
      return res.status(400).json({ 
        error: validationResult.error 
      });
    }
  }

  // Validate date if provided
  if (req.body.date) {
    const dateValue = new Date(req.body.date);
    if (isNaN(dateValue.getTime())) {
      return res.status(400).json({ 
        error: 'Date must be a valid date format' 
      });
    }
  }

  next();
};

// Helper function to validate activity-specific details
const validateActivityDetails = (activityType, activityDetails) => {
  switch (activityType) {
    case 'transport':
      return validateTransportDetails(activityDetails);
    case 'energy':
      return validateEnergyDetails(activityDetails);
    case 'food':
      return validateFoodDetails(activityDetails);
    case 'waste':
      return validateWasteDetails(activityDetails);
    default:
      return { isValid: true };
  }
};

const validateTransportDetails = (details) => {
  const validTransportModes = [
    'car_gasoline', 'car_diesel', 'car_electric', 'car_hybrid', 
    'bus', 'train', 'plane_domestic', 'plane_international', 
    'motorcycle', 'bicycle', 'walking'
  ];

  if (details.transportMode && !validTransportModes.includes(details.transportMode)) {
    return {
      isValid: false,
      error: `Transport mode must be one of: ${validTransportModes.join(', ')}`
    };
  }

  if (details.fuelEfficiency && (typeof details.fuelEfficiency !== 'number' || details.fuelEfficiency <= 0)) {
    return {
      isValid: false,
      error: 'Fuel efficiency must be a positive number'
    };
  }

  return { isValid: true };
};

const validateEnergyDetails = (details) => {
  const validEnergySources = [
    'coal', 'natural_gas', 'solar', 'wind', 'hydro', 'nuclear', 'grid_average'
  ];

  if (details.energySource && !validEnergySources.includes(details.energySource)) {
    return {
      isValid: false,
      error: `Energy source must be one of: ${validEnergySources.join(', ')}`
    };
  }

  return { isValid: true };
};

const validateFoodDetails = (details) => {
  const validFoodTypes = [
    'beef', 'pork', 'chicken', 'fish', 'dairy_milk', 'dairy_cheese',
    'vegetables', 'fruits', 'grains', 'processed_food'
  ];

  if (details.foodType && !validFoodTypes.includes(details.foodType)) {
    return {
      isValid: false,
      error: `Food type must be one of: ${validFoodTypes.join(', ')}`
    };
  }

  return { isValid: true };
};

const validateWasteDetails = (details) => {
  const validWasteTypes = ['general_waste', 'recycling', 'compost', 'hazardous'];
  const validDisposalMethods = ['landfill', 'incineration', 'recycling', 'composting'];

  if (details.wasteType && !validWasteTypes.includes(details.wasteType)) {
    return {
      isValid: false,
      error: `Waste type must be one of: ${validWasteTypes.join(', ')}`
    };
  }

  if (details.disposalMethod && !validDisposalMethods.includes(details.disposalMethod)) {
    return {
      isValid: false,
      error: `Disposal method must be one of: ${validDisposalMethods.join(', ')}`
    };
  }

  return { isValid: true };
};

module.exports = {
  validateRegistration,
  validateLogin,
  validateActivity
};