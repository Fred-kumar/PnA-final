const router = require("express").Router();
const Call   = require("../models/Call");
const User   = require("../models/User");

router.get("/call-history", async (req, res) => {
  try {
    const before = req.query.before ? new Date(req.query.before) : new Date();
    const calls = await Call.find({
      $or: [{ caller: req.user.email }, { receiver: req.user.email }],
      createdAt: { $lt: before },
    }).sort({ createdAt: -1 }).limit(25);

    // Resolve display names
    const emails = [...new Set(calls.flatMap(c => [c.caller, c.receiver]))];
    const users  = await User.find({ email: { $in: emails } }).select("email username displayName avatar");
    const map    = Object.fromEntries(users.map(u => [u.email, u]));

    const result = calls.map(c => ({
      _id:      c._id,
      type:     c.type,
      status:   c.status,
      duration: c.duration,
      at:       c.createdAt,
      isOutgoing: c.caller === req.user.email,
      peer: (() => {
        const pe = c.caller === req.user.email ? c.receiver : c.caller;
        const pu = map[pe];
        return { email: pe, username: pu?.username, displayName: pu?.displayName || pe, avatar: pu?.avatar };
      })(),
    }));

    res.json(result);
  } catch (err) {
    res.json([]);
  }
});

module.exports = router;
