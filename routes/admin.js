import express from "express";
import bcrypt from "bcrypt";
import db from "../db.js";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";

const router = express.Router();

// --- Admin Dashboard ---
router.get("/", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  try {
    const { request_id, status, service_id, date } = req.query;

    // --- Department stats ---
    const q1 = await db.query(`
      SELECT d.id, d.name, COUNT(r.*) as total_requests
      FROM departments d
      LEFT JOIN services s ON s.department_id = d.id
      LEFT JOIN requests r ON r.service_id = s.id
      GROUP BY d.id
      ORDER BY total_requests DESC
    `);

    // --- Status stats ---
    const q2 = await db.query(`
      SELECT current_status, COUNT(*) as cnt
      FROM requests
      GROUP BY current_status
    `);

    // --- Total collected ---
    const q3 = await db.query(`
      SELECT COALESCE(SUM(amount_cents),0) as total_collected 
      FROM payments 
      WHERE status = 'SUCCESS'
    `);

    // --- Requests (only if filters applied) ---
    let requests = [];
    if (request_id || status || service_id || date) {
      let query = `
        SELECT r.id, r.current_status, r.submitted_at,
               u.full_name AS citizen_name, s.name AS service_name
        FROM requests r
        JOIN users u ON r.citizen_id = u.id
        JOIN services s ON r.service_id = s.id
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;

      if (request_id) {
        query += ` AND r.id::text ILIKE $${idx}`;
        params.push(`%${request_id}%`);
        idx++;
      }

      if (status) {
        query += ` AND r.current_status = $${idx}`;
        params.push(status);
        idx++;
      }

      if (service_id) {
        query += ` AND s.id = $${idx}`;
        params.push(service_id);
        idx++;
      }

      if (date) {
        query += ` AND DATE(r.submitted_at) = $${idx}`;
        params.push(date);
        idx++;
      }

      query += ` ORDER BY r.submitted_at DESC`;
      const resRequests = await db.query(query, params);
      requests = resRequests.rows;
    }

    // --- Services for dropdown ---
    const { rows: services } = await db.query(`SELECT * FROM services ORDER BY name`);

    res.render("admin/dashboard", {
      user: req.session.user,
      deptStats: q1.rows,
      statusStats: q2.rows,
      totalCollected: q3.rows[0].total_collected,
      requests,
      services,
      request_id: request_id || "",
      status: status || "",
      selectedService: service_id || "",
      date: date || "",
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).send("Server error");
  }
});

// --- Add Officer or Department Head Page ---
router.get("/add-user", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  try {
    const depts = await db.query("SELECT id, name FROM departments ORDER BY name ASC");
    res.render("admin/add_user", {
      user: req.session.user,
      depts: depts.rows,
      success: null,
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// --- Handle Officer/Dept Head Registration ---
router.post("/add-user", ensureAuthenticated, ensureRole("ADMIN"), async (req, res) => {
  const { full_name, email, password, department_id, role } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (full_name, email, password_hash, department_id, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [full_name, email, hash, department_id || null]
    );

    const userId = result.rows[0].id;

    // Ensure role exists (OFFICER or DEPT_HEAD)
    let roleRes = await db.query("SELECT id FROM roles WHERE name = $1", [role]);
    let roleId;
    if (roleRes.rows.length === 0) {
      const ins = await db.query("INSERT INTO roles (name) VALUES ($1) RETURNING id", [role]);
      roleId = ins.rows[0].id;
    } else {
      roleId = roleRes.rows[0].id;
    }

    await db.query("INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)", [userId, roleId]);

    const depts = await db.query("SELECT id, name FROM departments ORDER BY name ASC");
    res.render("admin/add_user", {
      user: req.session.user,
      depts: depts.rows,
      success: `${role} added successfully!`,
      error: null,
    });
  } catch (err) {
    console.error("Error adding user:", err);
    const depts = await db.query("SELECT id, name FROM departments ORDER BY name ASC");
    res.render("admin/add_user", {
      user: req.session.user,
      depts: depts.rows,
      success: null,
      error: "Could not add user",
    });
  }
});

export default router;
