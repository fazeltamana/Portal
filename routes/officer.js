import express from "express";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";
import db from "../db.js";

const router = express.Router();

// Officer Dashboard - list requests for officer's department
router.get("/", ensureAuthenticated, ensureRole("OFFICER", "DEPT_HEAD"), async (req, res) => {
  try {
    const user = req.session.user;
    const deptId = user.department_id;

    // Get filter params from query string
    const { name, request_id, status, service_id, date } = req.query;

    let query = `
      SELECT r.id, r.current_status, r.submitted_at, 
             u.full_name AS citizen_name, s.name AS service_name, d.name AS department_name
      FROM requests r
      JOIN users u ON r.citizen_id = u.id
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      WHERE s.department_id = $1
    `;
    const params = [deptId];

    // Name filter
    if (name) {
      params.push(`%${name}%`);
      query += ` AND u.full_name ILIKE $${params.length}`;
    }

    // Request ID filter
    if (request_id) {
      params.push(`%${request_id}%`);
      query += ` AND r.id::text ILIKE $${params.length}`;
    }

    // Status filter
    if (status) {
      params.push(status);
      query += ` AND r.current_status = $${params.length}`;
    }

    // Service filter
    if (service_id) {
      params.push(service_id);
      query += ` AND s.id = $${params.length}`;
    }

    // Date filter (only single date)
    if (date) {
      params.push(date);
      query += ` AND r.submitted_at::date = $${params.length}`;
    }

    query += ` ORDER BY r.submitted_at DESC`;

    const { rows: requests } = await db.query(query, params);

    // Fetch services for dropdown
    const { rows: services } = await db.query(`SELECT id, name FROM services WHERE department_id = $1`, [deptId]);

    const formattedRequests = requests.map(r => ({
      ...r,
      status: r.current_status.charAt(0).toUpperCase() + r.current_status.slice(1).toLowerCase()
    }));

    res.render("officer/dashboard", {
      user,
      requests: formattedRequests,
      services,
      filters: { name, request_id, status, service_id, date }
    });

  } catch (err) {
    console.error("Officer dashboard error:", err);
    res.sendStatus(500);
  }
});

// Review a single request
router.get("/request/:id", ensureAuthenticated, ensureRole("OFFICER", "DEPT_HEAD"), async (req, res) => {
  const requestId = req.params.id;
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.current_status, r.submitted_at,
             u.full_name AS citizen_name, s.name AS service_name,
             d.name AS dept_name
      FROM requests r
      JOIN users u ON r.citizen_id = u.id
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      WHERE r.id = $1
    `, [requestId]);

    if (rows.length === 0) return res.sendStatus(404);
    const request = rows[0];

    const { rows: documents } = await db.query(`
      SELECT file_name AS filename
      FROM documents
      WHERE request_id = $1
    `, [requestId]);

    res.render("officer/review_request", { user: req.session.user, request, documents });
  } catch (err) {
    console.error("Officer review error:", err);
    res.sendStatus(500);
  }
});

// Approve or Reject a request
router.post("/request/:id/action", ensureAuthenticated, ensureRole("OFFICER","DEPT_HEAD"), async (req, res) => {
  const requestId = req.params.id;
  const action = req.body.action;

  const statusMap = {
    approve: "APPROVED",
    reject: "REJECTED"
  };

  const status = statusMap[action];
  if (!status) return res.status(400).send("Invalid action");

  try {
    await db.query(
      `UPDATE requests SET current_status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [status, req.session.user.id, requestId]
    );

    const { rows } = await db.query(`SELECT citizen_id FROM requests WHERE id = $1`, [requestId]);
    const citizenId = rows[0].citizen_id;

    await db.query(
      `INSERT INTO notifications (user_id, message, created_at, is_read)
       VALUES ($1, $2, NOW(), false)`,
      [citizenId, `Your request #${requestId} has been ${status.toLowerCase()}.`]
    );

    res.redirect("/officer");
  } catch (err) {
    console.error("Error updating request status:", err);
    res.status(500).send("Server error");
  }
});

export default router;
