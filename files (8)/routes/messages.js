const router  = require("express").Router();
const Message = require("../models/Message");

// Get messages with a peer (cursor-based, 30 per page)
router.get("/messages/:peerEmail", async (req, res) => {
  try {
    const me   = req.user.email;
    const peer = req.params.peerEmail;
    const before = req.query.before ? new Date(req.query.before) : new Date();

    const msgs = await Message.find({
      $or: [
        { from: me,   to: peer },
        { from: peer, to: me   },
      ],
      createdAt: { $lt: before },
    }).sort({ createdAt: -1 }).limit(30);

    // Mark as read
    await Message.updateMany({ from: peer, to: me, read: false }, { read: true });

    res.json(msgs.reverse());
  } catch (err) {
    res.json([]);
  }
});

// Unread count per peer
router.get("/unread", async (req, res) => {
  try {
    const counts = await Message.aggregate([
      { $match: { to: req.user.email, read: false } },
      { $group: { _id: "$from", count: { $sum: 1 } } },
    ]);
    const map = {};
    counts.forEach(c => { map[c._id] = c.count; });
    res.json(map);
  } catch (err) {
    res.json({});
  }
});

module.exports = router;
