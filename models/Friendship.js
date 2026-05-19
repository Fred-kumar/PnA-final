const mongoose = require("mongoose");
const FriendshipSchema = new mongoose.Schema({
  requester:  { type: String, required: true }, // email
  recipient:  { type: String, required: true }, // email
  status:     { type: String, enum: ["pending","accepted","blocked"], default: "pending" },
  createdAt:  { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
});
FriendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
module.exports = mongoose.model("Friendship", FriendshipSchema);
