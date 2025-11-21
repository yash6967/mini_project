const express = require('express');
const router = express.Router();
const { 
  startConversation, 
  sendMessage, 
  endConversation,
  analyzeConversation,
  getConversationHistory,
  getHighestOverallScore,
  getLastConversationScore
} = require('../controllers/conversationController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Conversation routes
router.post('/start', startConversation);
router.post('/:id/message', sendMessage);
router.post('/:id/end', endConversation);
router.post('/:id/analyze', analyzeConversation);
router.get('/history', getConversationHistory);
router.get('/highest-score', getHighestOverallScore);
router.get('/last-score', getLastConversationScore);

module.exports = router;
