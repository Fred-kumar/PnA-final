
try { require("dotenv").config(); } catch (_) {}

const express   = require("express");
const http      = require("http");
const { Server }= require("socket.io");
const session   = require("express-session");
const passport  = require("passport");
const cors      = require("cors");
const jwt       = require("jsonwebtoken");
const path      = require("path");

const connectDB    = require("./config/db");
const initPassport = require("./config/passport");
const initSockets  = require("./sockets");
const { initWebPush } = require("./sockets/pushHelper");

const { router: authRouter } = require("./routes/auth");
const friendsRouter  = require("./routes/friends");
const messagesRouter = require("./routes/messages");
const callsRouter    = require("./routes/calls");
const profileRouter  = require("./routes/profile");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 25000,
  pingInterval: 15000,
});

const PORT = process.env.PORT || 3000;

/* ── Startup ────────────────────────────────────────── */
connectDB();
initPassport();
initWebPush();

/* ── Auth middleware ────────────────────────────────── */
function authMW(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized." });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || "dev_secret_change_in_prod");
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

/* ── Express middleware ─────────────────────────────── */
app.use(cors());
app.use(express.json({ limit: "2mb" }));  // allow base64 avatar uploads
app.use(session({
  secret: process.env.SESSION_SECRET || "dev_session_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 86400000 },
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, "public")));

/* ── Public routes (no auth) ────────────────────────── */
// Google OAuth
app.get("/auth/google",          passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "/?error=google" }),
  (req, res) => {
    const u = req.user;
    const { signToken } = require("./routes/auth");
    const token = signToken(u);
    const params = new URLSearchParams({
      t:   token,
      uid: u.uniqueId  || "",
      un:  u.username  || "",
      dn:  u.displayName|| "",
      us:  u.usernameSet ? "1" : "0",
    });
    res.redirect("/auth-ok.html?" + params.toString());
  }
);

// Auth endpoints accessible at both /auth/* and /api/*
app.use("/auth", authRouter);
app.use("/api",  authRouter);

/* ── Protected routes ───────────────────────────────── */
app.use("/api", authMW, friendsRouter);
app.use("/api", authMW, messagesRouter);
app.use("/api", authMW, callsRouter);
app.use("/api", authMW, profileRouter);

/* ── Health check ───────────────────────────────────── */
app.get("/health", (_, res) => res.json({ status: "ok", ts: Date.now() }));

/* ── Sockets ────────────────────────────────────────── */
initSockets(io);

/* ── Start ──────────────────────────────────────────── */
server.listen(PORT, () => {
  console.log(`\n[Server] P&A Connect running → http://localhost:${PORT}`);
  console.log("[Server] Environment:", process.env.NODE_ENV || "development");
});
