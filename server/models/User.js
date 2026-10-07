const mongoose = require('mongoose');
module.exports = mongoose.model('User', new mongoose.Schema({
  name: { type: String, default: 'Roamly walker' },
  email: String,
}, { timestamps: true }));
