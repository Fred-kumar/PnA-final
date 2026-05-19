const mongoose = require("mongoose");

const LoginEventSchema = new mongoose.Schema({
  ip:        String,
  userAgent: String,
  deviceId:  String,
  country:   String,
  at: { type: Date, default: Date.now },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  // Identity
  uniqueId:    { type: String, unique: true, sparse: true },
  username:    { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  displayName: { type: String, default: "", trim: true, maxlength: 40 },
  avatar:      { type: String, default: null }, // base64 data URI or external URL

  // Auth
  email:       { type: String, required: true, unique: true, lowercase: true },
  password:    { type: String, default: null },
  googleId:    { type: String, default: null },
  authMethod:  { type: String, enum: ["local", "google"], default: "local" },

  // Recovery
  securityQuestion: { type: String, default: null },
  securityAnswer:   { type: String, default: null }, // bcrypt hashed

  // Flags
  isVerified:  { type: Boolean, default: false },
  usernameSet: { type: Boolean, default: false },

  // Push
  pushSubscription: { type: Object, default: null },

  // Security log
  loginEvents: { type: [LoginEventSchema], default: [] },

  // Presence
  lastSeen: { type: Date, default: Date.now },
  createdAt:{ type: Date, default: Date.now },
});

// Generate PA-XXXXXX unique id
UserSchema.statics.generateUID = async function () {
  const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id;
  do {
    id = "PA-" + Array.from({ length: 6 },
      () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
  } while (await this.exists({ uniqueId: id }));
  return id;
};

// Safe public projection (no sensitive fields)
UserSchema.statics.publicFields = "uniqueId username displayName avatar";

module.exports = mongoose.model("User", UserSchema);
