
const router  = require("express").Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const passport= require("passport");
const User    = require("../models/User");

const JWT_SECRET = () => process.env.JWT_SECRET || "dev_secret_change_in_prod";
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UN_RE      = /^[a-zA-Z0-9_]{3,20}$/;

const SECURITY_QUESTIONS = [
  "What was the name of your first childhood friend?",
  "What is the name of the town where you were born?",
  "What was the make and model of your first car?",
  "What was your childhood nickname?",
  "What is the name of your oldest sibling?",
  "In what city did your parents meet?",
  "What was the name of your first pet?",
  "What was the first concert you attended?",
  "What street did you grow up on?",
  "What was the name of your first school?",
];

function signToken(user) {
  return jwt.sign(
    {
      id:          user._id.toString(),
      email:       user.email,
      uniqueId:    user.uniqueId,
      username:    user.username,
      displayName: user.displayName,
      usernameSet: user.usernameSet,
    },
    JWT_SECRET(),
    { expiresIn: "14d" }
  );
}

function clientUser(user) {
  return {
    uniqueId:    user.uniqueId,
    username:    user.username,
    displayName: user.displayName,
    avatar:      user.avatar,
    usernameSet: user.usernameSet,
  };
}

function logEvent(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  return {
    ip,
    userAgent: req.headers["user-agent"] || "",
    deviceId:  req.body?.deviceId || req.headers["x-device-id"] || "unknown",
    at: new Date(),
  };
}

/* ── Public endpoints ────────────────────────────────── */

router.get("/security-questions", (_req, res) => res.json(SECURITY_QUESTIONS));

router.get("/check-username", async (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  if (!UN_RE.test(q)) return res.json({ available: false, reason: "3–20 characters, letters, numbers and underscore only" });
  const taken = await User.exists({ username: q });
  res.json({ available: !taken, reason: taken ? "Username is already taken" : "Available" });
});

/* ── Register ────────────────────────────────────────── */
router.post("/register", async (req, res) => {
  try {
    const { email, password, username, displayName, securityQuestion, securityAnswer, deviceId } = req.body;

    // Validate
    if (!email || !password || !username || !securityQuestion || !securityAnswer)
      return res.status(400).json({ error: "All fields are required." });
    if (!EMAIL_RE.test(email))
      return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8)
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (!UN_RE.test(username))
      return res.status(400).json({ error: "Username: 3–20 characters, letters, numbers and underscore only." });
    if (!SECURITY_QUESTIONS.includes(securityQuestion))
      return res.status(400).json({ error: "Select a valid security question." });
    if ((securityAnswer || "").trim().length < 2)
      return res.status(400).json({ error: "Security answer is too short." });
    if (await User.exists({ email: email.toLowerCase() }))
      return res.status(409).json({ error: "An account with this email already exists." });
    if (await User.exists({ username: username.toLowerCase() }))
      return res.status(409).json({ error: "This username is already taken." });

    const uniqueId     = await User.generateUID();
    const hashed       = await bcrypt.hash(password, 12);
    const hashedAnswer = await bcrypt.hash(securityAnswer.trim().toLowerCase(), 10);
    const event        = logEvent(req);
    if (deviceId) event.deviceId = deviceId;

    const user = await User.create({
      email: email.toLowerCase(),
      password: hashed,
      username: username.toLowerCase(),
      displayName: (displayName || username).trim(),
      securityQuestion,
      securityAnswer: hashedAnswer,
      authMethod: "local",
      uniqueId,
      isVerified: true,
      usernameSet: true,
      loginEvents: [event],
    });

    res.status(201).json({ token: signToken(user), user: clientUser(user) });
  } catch (err) {
    console.error("[Register]", err.message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

/* ── Login ───────────────────────────────────────────── */
router.post("/login", async (req, res) => {
  try {
    const { email, password, deviceId } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const user = await User.findOne({ email: email.toLowerCase(), isVerified: true });
    if (!user || user.authMethod === "google")
      return res.status(401).json({ error: "Invalid email or password." });
    if (!await bcrypt.compare(password, user.password))
      return res.status(401).json({ error: "Invalid email or password." });

    const event = logEvent(req);
    if (deviceId) event.deviceId = deviceId;
    await User.findByIdAndUpdate(user._id, {
      $push: { loginEvents: { $each: [event], $slice: -30 } },
      lastSeen: new Date(),
    });

    res.json({ token: signToken(user), user: clientUser(user) });
  } catch (err) {
    console.error("[Login]", err.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

/* ── Password recovery ───────────────────────────────── */
router.post("/recovery/question", async (req, res) => {
  try {
    const user = await User.findOne({
      email: (req.body.email || "").toLowerCase(),
      isVerified: true,
      authMethod: "local",
    });
    if (!user || !user.securityQuestion)
      return res.status(404).json({ error: "No account found with this email." });
    res.json({ question: user.securityQuestion });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post("/recovery/reset", async (req, res) => {
  try {
    const { email, securityAnswer, newPassword } = req.body;
    if (!email || !securityAnswer || !newPassword)
      return res.status(400).json({ error: "All fields are required." });
    if (newPassword.length < 8)
      return res.status(400).json({ error: "New password must be at least 8 characters." });

    const user = await User.findOne({ email: email.toLowerCase(), isVerified: true, authMethod: "local" });
    if (!user) return res.status(404).json({ error: "Account not found." });

    const match = await bcrypt.compare(securityAnswer.trim().toLowerCase(), user.securityAnswer);
    if (!match) return res.status(400).json({ error: "Incorrect answer. Please try again." });

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ message: "Password updated successfully. You can now sign in." });
  } catch (err) {
    res.status(500).json({ error: "Reset failed. Please try again." });
  }
});

/* ── Google OAuth ─────────────────────────────────────── */
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get("/google/callback",
  passport.authenticate("google", { failureRedirect: "/?error=google" }),
  (req, res) => {
    const u = req.user;
    const token = signToken(u);
    const params = new URLSearchParams({
      t:   token,
      uid: u.uniqueId || "",
      un:  u.username || "",
      dn:  u.displayName || "",
      us:  u.usernameSet ? "1" : "0",
    });
    res.redirect("/auth-ok.html?" + params.toString());
  }
);

module.exports = { router, signToken, clientUser };
