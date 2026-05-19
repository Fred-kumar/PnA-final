
const webpush = require("web-push");
const User    = require("../models/User");

let _ready = false;

function initWebPush() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      "mailto:" + (process.env.ADMIN_EMAIL || "admin@paconnect.app"),
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    _ready = true;
    console.log("[Push] Web Push (VAPID) ready");
  } else {
    console.log("[Push] VAPID keys not set — push notifications disabled");
  }
}

async function sendPush(email, payload) {
  if (!_ready) return;
  try {
    const user = await User.findOne({ email }).select("pushSubscription");
    if (!user?.pushSubscription) return;
    await webpush.sendNotification(user.pushSubscription, JSON.stringify({
      title: payload.title || "P&A Connect",
      body:  payload.body  || "You have a notification",
      icon:  "/logo.png",
      badge: "/logo.png",
      tag:   payload.tag   || "pa-notification",
      url:   payload.url   || "/app.html",
    }));
  } catch (err) {
    if (err.statusCode === 410) {
      // Subscription expired — clean up
      await User.findOneAndUpdate({ email }, { pushSubscription: null });
    }
  }
}

module.exports = { initWebPush, sendPush };
