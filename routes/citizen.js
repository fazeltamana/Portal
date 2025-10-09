import express from "express";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";
import db from "../db.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------- Multer -----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

// ----------------- Citizen Dashboard -----------------
router.get("/", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const search = req.query.search || "";
    const status = req.query.status || "All";

    // Filter and Search Query
    let query = `
      SELECT r.id, s.name AS service_name, d.name AS dept_name,
             r.current_status, r.payment_status, r.fee_cents, r.created_at
      FROM requests r
      JOIN services s ON s.id = r.service_id
      JOIN departments d ON s.department_id = d.id
      WHERE r.citizen_id = $1
    `;
    const params = [userId];

    if (search) {
      query += ` AND (s.name ILIKE $2 OR d.name ILIKE $2)`;
      params.push(`%${search}%`);
    }

    if (status && status !== "All") {
      // Status filter fix
      if (status === "PROCESSING") {
        query += ` AND r.current_status IN ('PROCESSING', 'UNDER_REVIEW')`;
      } else if (status === "COMPLETED") {
        query += ` AND r.current_status IN ('APPROVED', 'REJECTED')`;
      } else {
        query += ` AND (r.current_status = $${params.length + 1} OR r.payment_status = $${params.length + 1})`;
        params.push(status);
      }
    }

    query += ` ORDER BY r.created_at DESC`;
    const requestsRes = await db.query(query, params);

    // Fetch unread notifications (limit 10)
    const notificationsRes = await db.query(
      `SELECT id, message, created_at, is_read
       FROM notifications
       WHERE user_id = $1 AND is_read = false
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    res.render("citizen/dashboard", {
      user: req.session.user,
      requests: requestsRes.rows,
      notifications: notificationsRes.rows,
      search,
      status
    });
  } catch (err) {
    console.error("Citizen dashboard error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Apply for Service -----------------
router.get("/apply", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    const { rows: services } = await db.query(`
      SELECT s.*, d.name AS department_name 
      FROM services s
      JOIN departments d ON s.department_id = d.id 
      WHERE s.is_active=true
    `);
    res.render("citizen/apply", { user: req.session.user, services });
  } catch (err) {
    console.error("GET /citizen/apply error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Submit Application -----------------
router.post("/apply", ensureAuthenticated, ensureRole("CITIZEN"), upload.array("documents", 6), async (req, res) => {
  try {
    const citizenId = req.session.user.id;
    const { service_id, details } = req.body;

    if (!service_id) return res.status(400).send("Service not selected");

    const { rows: serviceRows } = await db.query("SELECT * FROM services WHERE id=$1", [service_id]);
    if (!serviceRows.length) return res.status(400).send("Service not found");

    const insertRes = await db.query(
      `INSERT INTO requests (citizen_id, service_id, current_status, remarks, created_at)
       VALUES ($1, $2, 'SUBMITTED', $3, NOW())
       RETURNING id`,
      [citizenId, service_id, details || null]
    );
    const requestId = insertRes.rows[0].id;

    const files = req.files || [];
    for (const file of files) {
      await db.query(
        `INSERT INTO documents (request_id, file_name, file_path, mime_type)
         VALUES ($1, $2, $3, $4)`,
        [requestId, file.originalname, file.path, file.mimetype]
      );
    }

    const service = serviceRows[0];
    const fee = Number(service.base_fee_cents) || Math.floor(Math.random() * 5000 + 2000);
    await db.query(`UPDATE requests SET fee_cents=$1, payment_status='PAID' WHERE id=$2`, [fee, requestId]);
    await db.query(`INSERT INTO payments (request_id, amount_cents, status) VALUES ($1, $2, 'SUCCESS')`, [requestId, fee]);

    res.redirect(`/citizen/request/${requestId}`);
  } catch (err) {
    console.error("POST /citizen/apply error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Request Details -----------------
router.get("/request/:id", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    const rid = req.params.id;
    const uid = req.session.user.id;

    const reqRes = await db.query(`
      SELECT r.*, s.name AS service_name, d.name AS dept_name
      FROM requests r
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      WHERE r.id=$1 AND r.citizen_id=$2
    `, [rid, uid]);

    if (!reqRes.rows[0]) return res.status(404).send("Not found");

    const request = reqRes.rows[0];
    const docs = (await db.query("SELECT * FROM documents WHERE request_id=$1", [rid])).rows;
    const payments = (await db.query("SELECT * FROM payments WHERE request_id=$1", [rid])).rows;

    res.render("citizen/request_detail", { user: req.session.user, request, documents: docs, payments });
  } catch (err) {
    console.error("GET /request/:id error:", err);
    res.status(500).send("Server error");
  }
});

// ----------------- Notifications -----------------
router.post("/notifications/read", ensureAuthenticated, ensureRole("CITIZEN"), async (req, res) => {
  try {
    await db.query(`
      UPDATE notifications 
      SET is_read = true 
      WHERE user_id = $1 AND is_read = false
    `, [req.session.user.id]);
    res.redirect("/citizen");
  } catch (err) {
    console.error("POST /notifications/read error:", err);
    res.status(500).send("Server error");
  }
});

export default router;
