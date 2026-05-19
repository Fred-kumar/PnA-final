
const crypto     = require("crypto");
const Call       = require("../models/Call");
const Friendship = require("../models/Friendship");
const { sendPush } = require("./pushHelper");

const RING_TIMEOUT = 45000; // 45 seconds

// sessionId -> { callId, caller, receiver, callerSock, receiverSock, answered, timer }
const sessions = {};

module.exports = function registerCallHandlers(socket, io, emailToSock) {
  const { email, username } = socket.user;

  /* ── Outgoing call ──────────────────────────────── */
  socket.on("call-user", async ({ targetEmail, offer, callType }) => {
    try {
      // Block check
      const blocked = await Friendship.findOne({
        status: "blocked",
        $or: [
          { requester: email, recipient: targetEmail },
          { requester: targetEmail, recipient: email },
        ],
      });
      if (blocked) return socket.emit("call-failed", { reason: "You cannot call this user." });

      const receiverSock = emailToSock[targetEmail];

      // Create call record first (always)
      const sessionId  = crypto.randomUUID();
      const callRecord = await Call.create({
        sessionId, caller: email, receiver: targetEmail,
        type: callType || "voice", status: "ringing",
      });

      if (!receiverSock) {
        // Receiver offline — immediately mark missed + push
        await Call.findByIdAndUpdate(callRecord._id, { status: "missed" });
        await sendPush(targetEmail, {
          title: `Missed ${callType === "video" ? "video" : "voice"} call`,
          body:  `${username || email} tried to call you`,
          tag:   "missed-call",
          url:   "/app.html",
        });
        return socket.emit("call-failed", { reason: "User is currently offline." });
      }

      sessions[sessionId] = {
        callId:       callRecord._id.toString(),
        caller:       email,
        receiver:     targetEmail,
        callerSock:   socket.id,
        receiverSock: receiverSock,
        answered:     false,
      };

      socket.emit("call-session", { sessionId });
      io.to(receiverSock).emit("incoming-call", {
        from:      email,
        fromName:  username || email,
        offer,
        callType:  callType || "voice",
        sessionId,
        callId:    callRecord._id,
      });

      // Auto-expire if no answer in 45s
      sessions[sessionId].timer = setTimeout(async () => {
        const sess = sessions[sessionId];
        if (!sess || sess.answered) return;
        delete sessions[sessionId];

        await Call.findByIdAndUpdate(sess.callId, { status: "missed" });

        // Notify both sides
        const cs = emailToSock[sess.caller];
        const rs = emailToSock[sess.receiver];
        if (cs) io.to(cs).emit("call-ended", { reason: "No answer." });
        if (rs) io.to(rs).emit("call-auto-ended");

        // Push to receiver
        await sendPush(sess.receiver, {
          title: "Missed call",
          body:  `${sess.caller} called — no answer`,
          tag:   "missed-call",
        });
      }, RING_TIMEOUT);

    } catch (err) {
      console.error("[call-user]", err.message);
      socket.emit("call-failed", { reason: "Call failed. Please try again." });
    }
  });

  /* ── Accept call ────────────────────────────────── */
  socket.on("call-answer", async ({ targetEmail, answer, sessionId }) => {
    try {
      const sess = sessions[sessionId];
      if (sess) {
        sess.answered = true;
        clearTimeout(sess.timer);
        await Call.findByIdAndUpdate(sess.callId, { status: "completed" });
      }
      const callerSock = emailToSock[targetEmail];
      if (callerSock) io.to(callerSock).emit("call-answered", { answer });
    } catch (err) {
      console.error("[call-answer]", err.message);
    }
  });

  /* ── Reject call ────────────────────────────────── */
  socket.on("call-reject", async ({ targetEmail, sessionId }) => {
    try {
      const sess = sessions[sessionId];
      if (sess) {
        clearTimeout(sess.timer);
        await Call.findByIdAndUpdate(sess.callId, { status: "rejected" });
        delete sessions[sessionId];
      }
      const callerSock = emailToSock[targetEmail];
      if (callerSock) io.to(callerSock).emit("call-rejected");
    } catch (err) {
      console.error("[call-reject]", err.message);
    }
  });

  /* ── Cancel outgoing (before answer) ───────────── */
  socket.on("call-cancel", async ({ targetEmail, sessionId }) => {
    try {
      const sess = sessions[sessionId];
      if (sess) {
        clearTimeout(sess.timer);
        await Call.findByIdAndUpdate(sess.callId, { status: "cancelled" });
        delete sessions[sessionId];
      }
      const receiverSock = emailToSock[targetEmail];
      if (receiverSock) io.to(receiverSock).emit("call-cancelled", { from: email });
    } catch (err) {
      console.error("[call-cancel]", err.message);
    }
  });

  /* ── End active call (both sides) ──────────────── */
  socket.on("call-end", async ({ targetEmail, duration, sessionId }) => {
    try {
      const sess = sessions[sessionId];
      if (sess) {
        clearTimeout(sess.timer);
        await Call.findByIdAndUpdate(sess.callId, {
          status: "completed",
          duration: Math.max(0, Math.round(duration || 0)),
        });
        delete sessions[sessionId];
      }

      const targetSock = emailToSock[targetEmail];
      // Force end on the other side
      if (targetSock) io.to(targetSock).emit("call-ended", { from: email });
      // Also confirm end to caller (handles self-hangup)
      socket.emit("call-ended", { from: targetEmail });
    } catch (err) {
      console.error("[call-end]", err.message);
    }
  });

  /* ── ICE candidates ─────────────────────────────── */
  socket.on("ice-candidate", ({ targetEmail, candidate }) => {
    const ts = emailToSock[targetEmail];
    if (ts) io.to(ts).emit("ice-candidate", { candidate });
  });
};
