import express from "express";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";
import db from "../db.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage for uploaded documents
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage });

/* =======================================================
   Citizen Dashboard — With Search & Filter
======================================================= */
router.get(
  "/",
  ensureAuthenticated,
  ensureRole("CITIZEN"),
  async (req, res) => {
    try {
      const uid = req.session.user.id;
      const { search = "", status = "" } = req.query;

      // Build query dynamically
      let query = `
        SELECT 
          r.*, 
          s.name AS service_name, 
          d.name AS dept_name
        FROM requests r
        JOIN services s ON r.service_id = s.id
        JOIN departments d ON s.department_id = d.id
        WHERE r.citizen_id = $1
      `;
      const params = [uid];
      let paramCount = 2;

      if (search) {
        query += ` AND (LOWER(s.name) LIKE LOWER($${paramCount}) OR LOWER(d.name) LIKE LOWER($${
          paramCount + 1
        }))`;
        params.push(`%${search}%`, `%${search}%`);
        paramCount += 2;
      }

      if (status && status !== "All") {
        query += ` AND (r.current_status = $${paramCount} OR r.payment_status = $${paramCount})`;
        params.push(status);
        paramCount++;
      }

      query += " ORDER BY r.submitted_at DESC";

      const { rows } = await db.query(query, params);
      res.render("citizen/dashboard", {
        user: req.session.user,
        requests: rows,
        search,
        status,
      });
    } catch (err) {
      console.error("Dashboard error:", err);
      res.status(500).send("Server error");
    }
  }
);

/* =======================================================
   Apply for Service
======================================================= */
router.get(
  "/apply",
  ensureAuthenticated,
  ensureRole("CITIZEN"),
  async (req, res) => {
    const { rows: services } = await db.query(
      "SELECT s.*, d.name AS department_name FROM services s JOIN departments d ON s.department_id = d.id WHERE s.is_active=true"
    );
    res.render("citizen/apply", { user: req.session.user, services });
  }
);

router.post(
  "/apply",
  ensureAuthenticated,
  ensureRole("CITIZEN"),
  upload.array("documents", 6),
  async (req, res) => {
    try {
      const uid = req.session.user.id;
      const { service_id, ...formData } = req.body;

      // Check service exists
      const { rows } = await db.query("SELECT * FROM services WHERE id=$1", [
        service_id,
      ]);
      if (rows.length === 0) return res.status(400).send("Service not found");
      const service = rows[0];

      // Insert request
      const reqInsert = await db.query(
        `INSERT INTO requests (citizen_id, service_id, current_status, remarks)
         VALUES ($1,$2,'SUBMITTED',$3) RETURNING id`,
        [uid, service_id, formData ? JSON.stringify(formData) : null]
      );
      const requestId = reqInsert.rows[0].id;

      // Handle uploaded documents
      const files = req.files || [];
      for (const f of files) {
        await db.query(
          `INSERT INTO documents (request_id, file_name, file_path, mime_type)
           VALUES ($1,$2,$3,$4)`,
          [requestId, f.originalname, f.path, f.mimetype]
        );
      }

      // --- Fee Generation Logic ---
      let fee = Number(service.base_fee_cents);
      if (!fee || fee <= 0) {
        // Example fallback logic — can be replaced with real rules
        const deptBasedFee = {
          1: 5000, // $50
          2: 7000, // $70
          3: 3000, // $30
        };
        fee =
          deptBasedFee[service.department_id] ||
          Math.floor(Math.random() * 4000 + 2000);
      }

      // Update request with fee and mark payment as PAID for simplicity
      await db.query(
        `UPDATE requests SET fee_cents=$1, payment_status='PAID' WHERE id=$2`,
        [fee, requestId]
      );

      // Insert payment record
      await db.query(
        `INSERT INTO payments (request_id, amount_cents, status) 
         VALUES ($1,$2,'SUCCESS')`,
        [requestId, fee]
      );
      // Save the fee into requests table
      await db.query(
        `UPDATE requests SET fee_cents=$1, payment_status='PAID' WHERE id=$2`,
        [fee, requestId]
      );

      res.redirect(`/citizen/request/${requestId}`);
    } catch (err) {
      console.error("Citizen apply error:", err);
      res.status(500).send("Server error");
    }
  }
);

/* =======================================================
   View Request Details
======================================================= */
router.get(
  "/request/:id",
  ensureAuthenticated,
  ensureRole("CITIZEN"),
  async (req, res) => {
    try {
      const rid = req.params.id;
      const uid = req.session.user.id;

      const q = await db.query(
        `SELECT r.*, s.name AS service_name, d.name AS department_name
         FROM requests r
         JOIN services s ON r.service_id = s.id
         JOIN departments d ON s.department_id = d.id
         WHERE r.id=$1 AND r.citizen_id=$2`,
        [rid, uid]
      );
      const reqRow = q.rows[0];
      if (!reqRow) return res.status(404).send("Not found");

      const docs = (
        await db.query("SELECT * FROM documents WHERE request_id=$1", [rid])
      ).rows;
      const payments = (
        await db.query("SELECT * FROM payments WHERE request_id=$1", [rid])
      ).rows;

      res.render("citizen/request_detail", {
        user: req.session.user,
        request: reqRow,
        documents: docs,
        payments,
      });
    } catch (err) {
      console.error("View request error:", err);
      res.status(500).send("Server error");
    }
  }
);

/* =======================================================
   Notifications
======================================================= */
router.post(
  "/notifications/read",
  ensureAuthenticated,
  ensureRole("CITIZEN"),
  async (req, res) => {
    try {
      await db.query(
        "UPDATE notifications SET is_read = true WHERE user_id = $1",
        [req.session.user.id]
      );
      res.redirect("/citizen");
    } catch (err) {
      console.error(err);
      res.status(500).send("Error marking notifications as read");
    }
  }
);

router.get(
  "/notifications",
  ensureAuthenticated,
  ensureRole("CITIZEN"),
  async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT * FROM notifications 
         WHERE user_id = $1 
         ORDER BY created_at DESC`,
        [req.session.user.id]
      );
      res.render("citizen/notifications", {
        user: req.session.user,
        notifications: rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error fetching notifications");
    }
  }
);

export default router;
