const mongoose = require("mongoose");
const MessageSchema = new mongoose.Schema({
  from:      { type: String, required: true }, // email
  to:        { type: String, required: true }, // email
  text:      { type: String, required: true, maxlength: 4000 },
  read:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
MessageSchema.index({ from: 1, to: 1, createdAt: -1 });
module.exports = mongoose.model("Message", MessageSchema);
