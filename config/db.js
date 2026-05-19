const mongoose = require("mongoose");

module.exports = async function connectDB() {
  if (!process.env.MONGODB_URI) {
    console.error("[DB] MONGODB_URI is not set — exiting.");
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log("[DB] Connected to MongoDB");
  } catch (err) {
    console.error("[DB] Connection failed:", err.message);
    process.exit(1);
  }
};
