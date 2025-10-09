import express from "express";
import db from "../db.js";

const router = express.Router();

// Middleware
function ensureAuthenticated(req, res, next) {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
}

// GET /profile
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const { rows: userRows } = await db.query(`
      SELECT u.*, d.name AS department_name, ur.role_id, r.name AS role_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN users_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1
    `, [userId]);

    if (!userRows.length) throw new Error("User not found");

    const user = userRows[0];
    const roles = userRows.map(r => r.role_name).filter(Boolean);

    res.render("profile", {
      user: { ...user, roles },
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.render("profile", {
      user: req.session.user,
      roles: [],
      error: "Failed to fetch profile"
    });
  }
});

// POST /profile/update
router.post("/update", ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    let { full_name, phone, date_of_birth, job_title } = req.body;

    // Fix date issue (keep only YYYY-MM-DD)
    if (date_of_birth) date_of_birth = date_of_birth.split("T")[0];

    const updates = [];
    const values = [];
    let idx = 1;

    if (full_name) { updates.push(`full_name=$${idx++}`); values.push(full_name); }
    if (phone !== undefined) { updates.push(`phone=$${idx++}`); values.push(phone || null); }
    if (date_of_birth !== undefined) { updates.push(`date_of_birth=$${idx++}`); values.push(date_of_birth || null); }
    if (job_title !== undefined) { updates.push(`job_title=$${idx++}`); values.push(job_title || null); }

    if (updates.length) {
      values.push(userId);
      const query = `UPDATE users SET ${updates.join(", ")}, updated_at=NOW() WHERE id=$${idx}`;
      await db.query(query, values);
    }

    // Update session data
    if (full_name) req.session.user.full_name = full_name;
    if (phone !== undefined) req.session.user.phone = phone;
    if (date_of_birth !== undefined) req.session.user.date_of_birth = date_of_birth;
    if (job_title !== undefined) req.session.user.job_title = job_title;

    // Redirect with success message
    res.redirect("/profile?success=Profile updated successfully");
  } catch (err) {
    console.error("Profile update error:", err);
    res.redirect("/profile?error=Failed to update profile");
  }
});

export default router;
