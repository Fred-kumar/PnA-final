const mongoose = require("mongoose");
const CallSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true, sparse: true },
  caller:    { type: String, required: true }, // email
  receiver:  { type: String, required: true }, // email
  type:      { type: String, enum: ["voice","video"], default: "voice" },
  status:    { type: String, enum: ["ringing","completed","missed","rejected","cancelled"], default: "ringing" },
  duration:  { type: Number, default: 0 }, // seconds
  createdAt: { type: Date, default: Date.now },
});
CallSchema.index({ caller: 1, receiver: 1, createdAt: -1 });
module.exports = mongoose.model("Call", CallSchema);
