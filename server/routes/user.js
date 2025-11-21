const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/auth');

// Update user difficulty
router.put('/users/:userId/difficulty', protect, userController.updateDifficulty);
// Update user level (and optionally difficulty)
router.put('/users/:userId/level', protect, userController.updateLevel);

module.exports = router;
