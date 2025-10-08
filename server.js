// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
import session from "express-session";
import expressLayouts from "express-ejs-layouts";
import { setUser } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import citizenRoutes from "./routes/citizen.js";
import officerRoutes from "./routes/officer.js";
import adminRoutes from "./routes/admin.js";
import db from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

app.use(setUser);

// Make user + notifications available in all views
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;

  // show notifications only for citizens
  if (req.session.user && (req.session.user.roles || []).includes("CITIZEN")) {
    try {
      const { rows } = await db.query(
        `SELECT * FROM notifications 
         WHERE user_id = $1 
         ORDER BY is_read ASC, created_at DESC 
         LIMIT 5`,
        [req.session.user.id]
      );
      res.locals.notifications = rows;
    } catch (err) {
      console.error("Notification fetch error:", err);
      res.locals.notifications = [];
    }
  } else {
    res.locals.notifications = [];
  }

  next();
});

// Routes
app.use("/auth", authRoutes);
app.use("/citizen", citizenRoutes);
app.use("/officer", officerRoutes);
app.use("/admin", adminRoutes);

// home route
app.get("/", (req, res) => {
  res.redirect("/auth/login");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
