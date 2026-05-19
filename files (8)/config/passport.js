const passport   = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const User = require("../models/User");

module.exports = function initPassport() {
  passport.serializeUser((user, done) => done(null, user._id.toString()));
  passport.deserializeUser(async (id, done) => {
    try { done(null, await User.findById(id).select("-password -securityAnswer")); }
    catch (e) { done(e); }
  });

  if (!process.env.GOOGLE_CLIENT_ID) {
    console.log("[Auth] Google OAuth not configured — skipping.");
    return;
  }

  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  "/auth/google/callback",
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value.toLowerCase();
      let user = await User.findOne({ email });

      if (!user) {
        const uniqueId = await User.generateUID();
        user = await User.create({
          email,
          googleId:    profile.id,
          authMethod:  "google",
          uniqueId,
          displayName: profile.displayName || "",
          avatar:      profile.photos?.[0]?.value || null,
          isVerified:  true,
          usernameSet: false,
        });
      } else {
        if (!user.googleId) { user.googleId = profile.id; await user.save(); }
        if (!user.uniqueId) { user.uniqueId = await User.generateUID(); await user.save(); }
      }
      done(null, user);
    } catch (err) {
      done(err);
    }
  }));
};
