
const router     = require("express").Router();
const User       = require("../models/User");
const Friendship = require("../models/Friendship");

/* Helper: resolve user email from username */
async function emailFromUsername(username) {
  const u = await User.findOne({ username: username.toLowerCase() }).select("email");
  return u ? u.email : null;
}

/* ── Search users (by username or displayName) ─────── */
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json([]);
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re  = { $regex: esc, $options: "i" };

    const users = await User.find({
      isVerified:  true,
      usernameSet: true,
      email:       { $ne: req.user.email },
      $or: [{ username: re }, { displayName: re }, { uniqueId: re }],
    }).limit(12).select("uniqueId username displayName avatar");

    const results = await Promise.all(users.map(async (u) => {
      const target = await User.findOne({ username: u.username }).select("email");
      if (!target) return null;
      const f = await Friendship.findOne({
        $or: [
          { requester: req.user.email, recipient: target.email },
          { requester: target.email,   recipient: req.user.email },
        ],
      });
      if (f?.status === "blocked") return null;
      return {
        uniqueId:    u.uniqueId,
        username:    u.username,
        displayName: u.displayName,
        avatar:      u.avatar,
        status:      f?.status || "none",
        isRequester: f ? f.requester === req.user.email : false,
        requestId:   f?._id,
      };
    }));

    res.json(results.filter(Boolean));
  } catch (err) {
    console.error("[Search]", err.message);
    res.json([]);
  }
});

/* ── Send friend request (by username) ──────────────── */
router.post("/friend-request", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username is required." });

    const targetEmail = await emailFromUsername(username);
    if (!targetEmail) return res.status(404).json({ error: "User not found." });
    if (targetEmail === req.user.email) return res.status(400).json({ error: "You cannot add yourself." });

    const existing = await Friendship.findOne({
      $or: [
        { requester: req.user.email, recipient: targetEmail },
        { requester: targetEmail,    recipient: req.user.email },
      ],
    });
    if (existing?.status === "accepted") return res.status(400).json({ error: "You are already friends." });
    if (existing?.status === "pending")  return res.status(400).json({ error: "Request already sent." });
    if (existing?.status === "blocked")  return res.status(403).json({ error: "Unable to send request." });

    await Friendship.create({ requester: req.user.email, recipient: targetEmail });

    // Notify via socket if online
    if (global.notifyUser) global.notifyUser(targetEmail, "friend-request", {
      from: req.user.username || req.user.email,
    });
    res.json({ message: "Friend request sent." });
  } catch (err) {
    console.error("[FriendRequest]", err.message);
    res.status(500).json({ error: "Failed to send request." });
  }
});

/* ── Respond to request ──────────────────────────────── */
router.put("/friend-request/:id", async (req, res) => {
  try {
    const { action } = req.body;
    const f = await Friendship.findOne({ _id: req.params.id, recipient: req.user.email, status: "pending" });
    if (!f) return res.status(404).json({ error: "Request not found." });

    if (action === "accept") {
      f.status = "accepted"; f.acceptedAt = new Date(); await f.save();
      if (global.notifyUser) global.notifyUser(f.requester, "friend-accepted", {
        by: req.user.username || req.user.email,
      });
      return res.json({ message: "Friend added." });
    } else {
      await Friendship.deleteOne({ _id: f._id });
      return res.json({ message: "Request declined." });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed." });
  }
});

/* ── Friends list ────────────────────────────────────── */
router.get("/friends", async (req, res) => {
  try {
    const friendships = await Friendship.find({
      status: "accepted",
      $or: [{ requester: req.user.email }, { recipient: req.user.email }],
    });

    const emails = friendships.map(f =>
      f.requester === req.user.email ? f.recipient : f.requester
    );

    const users = await User.find({ email: { $in: emails } })
      .select("email uniqueId username displayName avatar");

    const result = users.map(u => {
      const f = friendships.find(fs =>
        fs.requester === u.email || fs.recipient === u.email
      );
      return {
        email:       u.email, // needed internally for socket calls
        uniqueId:    u.uniqueId,
        username:    u.username,
        displayName: u.displayName,
        avatar:      u.avatar,
        friendSince: f?.acceptedAt || f?.createdAt,
      };
    });

    res.json(result);
  } catch (err) {
    res.json([]);
  }
});

/* ── Pending requests ────────────────────────────────── */
router.get("/requests", async (req, res) => {
  try {
    const reqs = await Friendship.find({
      recipient: req.user.email, status: "pending",
    }).sort({ createdAt: -1 });

    const result = await Promise.all(reqs.map(async r => {
      const u = await User.findOne({ email: r.requester }).select("username displayName avatar uniqueId");
      return {
        _id:       r._id,
        createdAt: r.createdAt,
        from: {
          email:       r.requester,
          username:    u?.username,
          displayName: u?.displayName || u?.username || r.requester,
          avatar:      u?.avatar,
          uniqueId:    u?.uniqueId,
        },
      };
    }));

    res.json(result);
  } catch (err) {
    res.json([]);
  }
});

/* ── Block / Unblock ─────────────────────────────────── */
router.post("/block/:username", async (req, res) => {
  try {
    const targetEmail = await emailFromUsername(req.params.username);
    if (!targetEmail) return res.status(404).json({ error: "User not found." });

    await Friendship.deleteMany({
      $or: [
        { requester: req.user.email, recipient: targetEmail },
        { requester: targetEmail,    recipient: req.user.email },
      ],
    });
    await Friendship.create({ requester: req.user.email, recipient: targetEmail, status: "blocked" });

    if (global.notifyUser) global.notifyUser(targetEmail, "force-disconnect", {});
    res.json({ message: "User blocked." });
  } catch (err) {
    res.status(500).json({ error: "Failed." });
  }
});

router.delete("/block/:username", async (req, res) => {
  try {
    const targetEmail = await emailFromUsername(req.params.username);
    if (!targetEmail) return res.status(404).json({ error: "User not found." });
    await Friendship.deleteMany({ requester: req.user.email, recipient: targetEmail, status: "blocked" });
    res.json({ message: "User unblocked." });
  } catch (err) {
    res.status(500).json({ error: "Failed." });
  }
});

router.get("/blocked", async (req, res) => {
  try {
    const list = await Friendship.find({ requester: req.user.email, status: "blocked" });
    const users = await User.find({ email: { $in: list.map(b => b.recipient) } })
      .select("uniqueId username displayName avatar");
    res.json(users);
  } catch (err) {
    res.json([]);
  }
});

module.exports = router;
