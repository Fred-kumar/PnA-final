
const Message    = require("../models/Message");
const Friendship = require("../models/Friendship");
const { sendPush } = require("./pushHelper");

module.exports = function registerMessageHandlers(socket, io, emailToSock) {
  const { email, username } = socket.user;

  socket.on("send-message", async ({ to, text }) => {
    try {
      if (!text?.trim() || !to) return;
      if (text.trim().length > 4000) return;

      // Block check
      const blocked = await Friendship.findOne({
        status: "blocked",
        $or: [
          { requester: email, recipient: to },
          { requester: to,   recipient: email },
        ],
      });
      if (blocked) return;

      const msg = await Message.create({ from: email, to, text: text.trim() });
      socket.emit("message-sent", msg);

      const receiverSock = emailToSock[to];
      if (receiverSock) {
        io.to(receiverSock).emit("new-message", msg);
      } else {
        // Offline — send push
        await sendPush(to, {
          title: `New message from ${username || email}`,
          body:  text.trim().substring(0, 80),
          tag:   "msg-" + email,
          url:   "/app.html",
        });
      }
    } catch (err) {
      console.error("[Message]", err.message);
    }
  });
};
