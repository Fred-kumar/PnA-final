
const router  = require("express").Router();
const User    = require("../models/User");
const webpush = require("web-push");
const { signToken, clientUser } = require("./auth");

/* ── Get my profile ──────────────────────────────────── */
router.get("/me", async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -securityAnswer -loginEvents");
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json(clientUser(user));
  } catch (err) {
    res.status(500).json({ error: "Failed." });
  }
});

/* ── Set username (one-time for Google users) ─────── */
router.put("/username", async (req, res) => {
  try {
    const { username, displayName } = req.body;
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username))
      return res.status(400).json({ error: "Invalid username format." });
    const taken = await User.exists({ username: username.toLowerCase(), _id: { $ne: req.user.id } });
    if (taken) return res.status(409).json({ error: "Username is already taken." });

    const update = { username: username.toLowerCase(), usernameSet: true };
    if (displayName?.trim()) update.displayName = displayName.trim();

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true });
    res.json({ token: signToken(user), user: clientUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Failed." });
  }
});

/* ── Update display name ─────────────────────────────── */
router.put("/display-name", async (req, res) => {
  try {
    const { displayName } = req.body;
    if (!displayName?.trim() || displayName.trim().length > 40)
      return res.status(400).json({ error: "Display name must be 1–40 characters." });
    const user = await User.findByIdAndUpdate(
      req.user.id, { displayName: displayName.trim() }, { new: true }
    );
    res.json({ token: signToken(user), user: clientUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Failed." });
  }
});

/* ── Update avatar (base64 image) ───────────────────── */
router.put("/avatar", async (req, res) => {
  try {
    const { avatarData } = req.body; // base64 data URI
    if (!avatarData) return res.status(400).json({ error: "No image provided." });
    // Limit: ~150KB base64
    if (avatarData.length > 200000) return res.status(400).json({ error: "Image too large. Max 150KB." });
    if (!avatarData.startsWith("data:image/")) return res.status(400).json({ error: "Invalid image format." });
    const user = await User.findByIdAndUpdate(req.user.id, { avatar: avatarData }, { new: true });
    res.json({ avatar: user.avatar, message: "Profile picture updated." });
  } catch (err) {
    res.status(500).json({ error: "Failed to update avatar." });
  }
});

/* ── Check username availability (authed) ────────────── */
router.get("/check-username", async (req, res) => {
  try {
    const q = (req.query.q || "").toLowerCase().trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(q))
      return res.json({ available: false, reason: "3–20 characters, letters, numbers and underscore only." });
    const taken = await User.exists({ username: q, _id: { $ne: req.user.id } });
    res.json({ available: !taken, reason: taken ? "Username is already taken" : "Available" });
  } catch (err) {
    res.status(500).json({ available: false });
  }
});

/* ── Login history (security log) ───────────────────── */
router.get("/login-history", async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("loginEvents");
    res.json((user?.loginEvents || []).slice(-20).reverse());
  } catch (err) {
    res.json([]);
  }
});

/* ── Web Push subscription ───────────────────────────── */
router.post("/push-subscribe", async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ error: "Subscription required." });
    await User.findByIdAndUpdate(req.user.id, { pushSubscription: subscription });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed." });
  }
});

/* ── VAPID public key ────────────────────────────────── */
router.get("/vapid-key", (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

/* ── Ping (keep lastSeen fresh, every 5 min) ────────── */
router.post("/ping", async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { lastSeen: new Date() });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

/* ── Missed calls since last seen ───────────────────── */
router.get("/missed-calls", async (req, res) => {
  try {
    const Call = require("../models/Call");
    const user = await User.findById(req.user.id).select("lastSeen");
    const since = user.lastSeen || new Date(Date.now() - 86400000);
    const missed = await Call.find({
      receiver: req.user.email,
      status: { $in: ["missed", "ringing"] },
      createdAt: { $gt: since },
    }).sort({ createdAt: -1 }).limit(20);

    // Resolve caller display names
    const callerEmails = [...new Set(missed.map(c => c.caller))];
    const callers = await User.find({ email: { $in: callerEmails } })
      .select("email username displayName avatar");
    const callerMap = Object.fromEntries(callers.map(u => [u.email, u]));

    const result = missed.map(c => ({
      _id:      c._id,
      type:     c.type,
      status:   c.status,
      at:       c.createdAt,
      caller: {
        email:       c.caller,
        username:    callerMap[c.caller]?.username,
        displayName: callerMap[c.caller]?.displayName || callerMap[c.caller]?.username || c.caller,
        avatar:      callerMap[c.caller]?.avatar,
      },
    }));

    await User.findByIdAndUpdate(req.user.id, { lastSeen: new Date() });
    res.json(result);
  } catch (err) {
    res.json([]);
  }
});

/* ── Dynamic TURN credentials ────────────────────────── */
router.get("/turn-credentials", (_req, res) => {
  const ttl = 3600;
  res.json({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "turn:openrelay.metered.ca:80",              username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443",             username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    ],
    expiresAt: Math.floor(Date.now() / 1000) + ttl,
  });
});

module.exports = router;
