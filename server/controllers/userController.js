const User = require('../models/User');

// Update user difficulty
exports.updateDifficulty = async (req, res) => {
  try {
    const { userId } = req.params;
    const { difficulty } = req.body;
    if (!['easy', 'hard'].includes(difficulty)) {
      return res.status(400).json({ message: 'Invalid difficulty value' });
    }
    const user = await User.findByIdAndUpdate(userId, { difficulty }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Update user level and (optionally) difficulty
exports.updateLevel = async (req, res) => {
  try {
    const { userId } = req.params;
    const { level, difficulty } = req.body;
    const update = { level };
    if (difficulty) update.difficulty = difficulty;
    const user = await User.findByIdAndUpdate(userId, update, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
