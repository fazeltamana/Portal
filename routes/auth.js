// routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import db from "../db.js";

const router = express.Router();

// Show login page
router.get("/login", (req, res) => {
  const success = req.query.success
    ? "Account created successfully! Please log in."
    : null;

  res.render("auth/login", {
    user: req.session.user,
    error: null,
    success,
  });
});

// Handle login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    // Find active user
    const result = await db.query(
      "SELECT * FROM users WHERE email = $1 AND is_active = true",
      [email]
    );
    const user = result.rows[0];

    if (!user) {
      return res.render("auth/login", { user: null, error: "Invalid credentials", success: null });
    }

    // Check password
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.render("auth/login", { user: null, error: "Invalid credentials", success: null });
    }

    // Fetch roles
    const rolesRes = await db.query(
      `SELECT r.name
       FROM users_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [user.id]
    );
    const roles = rolesRes.rows.map(r => r.name);

    // Store minimal user in session
    req.session.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name, // <--- changed from "name" to full_name
      department_id: user.department_id,
      roles,
    };

    // Redirect based on role priority
    if (roles.includes("ADMIN")) return res.redirect("/admin");
    if (roles.includes("OFFICER") || roles.includes("DEPT_HEAD")) return res.redirect("/officer");
    if (roles.includes("CITIZEN")) return res.redirect("/citizen");

    return res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    return res.render("auth/login", { user: null, error: "Server error", success: null });
  }
});

// Show registration page (citizen only)
router.get("/register", (req, res) => {
  res.render("auth/register", { user: req.session.user, error: null });
});

// Handle registration
router.post("/register", async (req, res) => {
  const { name, email, password, national_id, dob, contact } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);

    // Create user
    const result = await db.query(
      `INSERT INTO users (full_name, email, password_hash, national_id, date_of_birth, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, email, hashed, national_id || null, dob || null, contact || null]
    );

    const userId = result.rows[0].id;

    // Ensure CITIZEN role exists
    let roleRes = await db.query("SELECT id FROM roles WHERE name = 'CITIZEN'");
    let citizenRoleId;
    if (roleRes.rows.length === 0) {
      const ins = await db.query("INSERT INTO roles (name) VALUES ('CITIZEN') RETURNING id");
      citizenRoleId = ins.rows[0].id;
    } else {
      citizenRoleId = roleRes.rows[0].id;
    }

    // Link user to role
    await db.query("INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)", [userId, citizenRoleId]);

    // Redirect with success message
    return res.redirect("/auth/login?success=1");
  } catch (err) {
    console.error("Registration error:", err);
    return res.render("auth/register", { user: null, error: "Could not create user" });
  }
});


router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/auth/login"));
});

export default router;
