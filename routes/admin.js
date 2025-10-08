import express from "express";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";
import db from "../db.js";

const router = express.Router();

router.get("/", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  try {
    // requests per department
    const q1 = await db.query(`
      SELECT d.id, d.name, COUNT(r.*) as total_requests
      FROM departments d
      LEFT JOIN services s ON s.department_id = d.id
      LEFT JOIN requests r ON r.service_id = s.id
      GROUP BY d.id
      ORDER BY total_requests DESC
    `);

    // approved vs rejected vs others
    const q2 = await db.query(`
      SELECT current_status, COUNT(*) as cnt
      FROM requests
      GROUP BY current_status
    `);

    // total money collected
    const q3 = await db.query(`
      SELECT COALESCE(SUM(amount_cents),0) as total_collected 
      FROM payments 
      WHERE status = 'SUCCESS'
    `);

    res.render("admin/dashboard", {
      user: req.session.user,
      deptStats: q1.rows,
      statusStats: q2.rows,
      totalCollected: q3.rows[0].total_collected,
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).send("Server error");
  }
});

// endpoints to manage users, departments, services can be added later
export default router;
