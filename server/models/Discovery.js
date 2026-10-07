const mongoose = require('mongoose');
const microMissionSchema = new mongoose.Schema({
  title: String,
  instruction: String,
  estimatedMinutes: Number,
  difficulty: { type: String, enum: ['easy', 'medium'] },
}, { _id: false });
const nextMissionSchema = new mongoose.Schema({
  type: String,
  instruction: String,
}, { _id: false });

module.exports = mongoose.model('Discovery', new mongoose.Schema({
  walkId: { type: mongoose.Schema.Types.ObjectId, ref: 'Walk', required: true },
  missionId: String, image: String, title: String, name: String, confidence: Number,
  category: String, uncertain: Boolean, description: String, interestingFact: String,
  observation: String, whyInteresting: String, lookCloser: String,
  microMission: microMissionSchema, nextMission: nextMissionSchema,
}, { timestamps: true }));
