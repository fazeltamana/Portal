const express = require("express");
const router = express.Router();
const { ensureAuthenticated } = require("../middlewares/authMiddleware");
const db = require("../db"); // your Postgres connection

// View Profile
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT u.*, d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = $1
    `,
      [req.user.id]
    );

    const user = result.rows[0];
    res.render("profile", { user });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// Update Profile
router.post("/update", ensureAuthenticated, async (req, res) => {
  try {
    const { full_name, phone, date_of_birth, department_id } = req.body;
    await db.query(
      `
      UPDATE users
      SET full_name=$1, phone=$2, date_of_birth=$3, department_id=$4, updated_at=NOW()
      WHERE id=$5
    `,
      [full_name, phone, date_of_birth, department_id || null, req.user.id]
    );

    res.redirect("/profile");
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

module.exports = router;
