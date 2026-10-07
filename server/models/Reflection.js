const mongoose = require('mongoose');
module.exports = mongoose.model('Reflection', new mongoose.Schema({
  walkId: { type: mongoose.Schema.Types.ObjectId, ref: 'Walk', required: true },
  feeling: String, moodBefore: String, moodAfter: String, notes: String, score: Number,
}, { timestamps: true }));
