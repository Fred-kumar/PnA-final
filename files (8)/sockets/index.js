
const jwt        = require("jsonwebtoken");
const Friendship = require("../models/Friendship");
const User       = require("../models/User");
const registerCallHandlers    = require("./callHandler");
const registerMessageHandlers = require("./messageHandler");

const emailToSock = {}; // email -> socketId
global._onlineEmails = {};

// Expose notifyUser so routes can push events
global.notifyUser = (email, event, data) => {
  const sid = emailToSock[email];
  if (global._io && sid) global._io.to(sid).emit(event, data);
};

module.exports = function initSockets(io) {
  global._io = io;

  // Auth middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));
      socket.user = require("jsonwebtoken").verify(
        token, process.env.JWT_SECRET || "dev_secret_change_in_prod"
      );
      next();
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", async (socket) => {
    const { email } = socket.user;

    // Kill any ghost socket for same user
    const prevSid = emailToSock[email];
    if (prevSid && prevSid !== socket.id) {
      const prevSock = io.sockets.sockets.get(prevSid);
      if (prevSock) prevSock.disconnect(true);
    }

    emailToSock[email] = socket.id;
    global._onlineEmails[email] = true;

    // Tell this user which of their friends are currently online
    await syncOnlineStatus(socket, email, emailToSock);
    // Tell all friends this user just came online
    await broadcastStatus(email, true, emailToSock, io);

    registerCallHandlers(socket, io, emailToSock);
    registerMessageHandlers(socket, io, emailToSock);

    // Lightweight heartbeat
    socket.on("hb", () => socket.emit("hb-ack"));

    socket.on("disconnect", async () => {
      if (emailToSock[email] === socket.id) {
        delete emailToSock[email];
        delete global._onlineEmails[email];
        await User.findOneAndUpdate({ email }, { lastSeen: new Date() });
        await broadcastStatus(email, false, emailToSock, io);
      }
    });
  });

  return emailToSock;
};

async function syncOnlineStatus(socket, myEmail, emailToSock) {
  try {
    const fs = await Friendship.find({
      status: "accepted",
      $or: [{ requester: myEmail }, { recipient: myEmail }],
    });
    const statusMap = {};
    fs.forEach(f => {
      const friendEmail = f.requester === myEmail ? f.recipient : f.requester;
      statusMap[friendEmail] = !!emailToSock[friendEmail];
    });
    socket.emit("status-sync", statusMap);
  } catch (err) {}
}

async function broadcastStatus(email, online, emailToSock, io) {
  try {
    const user = await User.findOne({ email }).select("username displayName");
    const fs = await Friendship.find({
      status: "accepted",
      $or: [{ requester: email }, { recipient: email }],
    });
    fs.forEach(f => {
      const friendEmail = f.requester === email ? f.recipient : f.requester;
      const sid = emailToSock[friendEmail];
      if (sid) {
        io.to(sid).emit("friend-status", { email, online, username: user?.username });
      }
    });
  } catch (err) {}
}
