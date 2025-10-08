import express from "express";
import { ensureAuthenticated, ensureRole } from "../middleware/auth.js";
import db from "../db.js";

const router = express.Router();

// Officer dashboard -> list requests for officer's department
router.get(
  "/",
  ensureAuthenticated,
  ensureRole("OFFICER", "DEPT_HEAD"),
  async (req, res) => {
    const user = req.session.user;
    const deptId = user.department_id;
    if (!deptId) return res.status(403).send("No department assigned");

    const { name, request_id, status, service_type, date_from, date_to } =
      req.query;
    let conds = ["d.id = $1"];
    let params = [deptId];
    let idx = params.length;

    if (request_id) {
      idx++;
      params.push(request_id);
      conds.push(`r.id = $${idx}`);
    }
    if (status) {
      idx++;
      params.push(status.toUpperCase());
      conds.push(`r.current_status = $${idx}`);
    }
    if (service_type) {
      idx++;
      params.push(`%${service_type}%`);
      conds.push(`s.name ILIKE $${idx}`);
    }
    if (name) {
      idx++;
      params.push(`%${name}%`);
      conds.push(`u.full_name ILIKE $${idx}`);
    }
    if (date_from) {
      idx++;
      params.push(date_from);
      conds.push(`r.submitted_at::date >= $${idx}`);
    }
    if (date_to) {
      idx++;
      params.push(date_to);
      conds.push(`r.submitted_at::date <= $${idx}`);
    }

    const sql = `
      SELECT r.*, s.name AS service_name, u.full_name AS citizen_name, d.name AS dept_name
      FROM requests r
      JOIN services s ON r.service_id = s.id
      JOIN departments d ON s.department_id = d.id
      JOIN users u ON r.citizen_id = u.id
      WHERE ${conds.join(" AND ")}
      ORDER BY r.submitted_at DESC
      LIMIT 200
    `;

    const result = await db.query(sql, params);
    res.render("officer/dashboard", {
      user: req.session.user,
      requests: result.rows,
      query: req.query,
    });
  }
);

// View request details
router.get(
  "/request/:id",
  ensureAuthenticated,
  ensureRole("OFFICER", "DEPT_HEAD"),
  async (req, res) => {
    const rid = req.params.id;
    const q = await db.query(
      `SELECT r.*, s.name AS service_name, d.id AS dept_id, d.name AS dept_name,
              u.full_name AS citizen_name, u.email
       FROM requests r
       JOIN services s ON r.service_id = s.id
       JOIN departments d ON s.department_id = d.id
       JOIN users u ON r.citizen_id = u.id
       WHERE r.id = $1`,
      [rid]
    );
    const request = q.rows[0];
    if (!request) return res.status(404).send("Request not found");

    const docs = (
      await db.query("SELECT * FROM documents WHERE request_id=$1", [rid])
    ).rows;

    res.render("officer/request_detail", {
      user: req.session.user,
      request,
      documents: docs,
    });
  }
);

// Approve / Reject request
router.post(
  "/request/:id/action",
  ensureAuthenticated,
  ensureRole("OFFICER", "DEPT_HEAD"),
  async (req, res) => {
    const rid = req.params.id;
    const { action, comment } = req.body; // action = 'approve' | 'reject'
    const status = action === "approve" ? "APPROVED" : "REJECTED";

    try {
      // Update request
      await db.query(
        `UPDATE requests 
         SET current_status=$1, reviewed_by=$2, reviewed_at=NOW(), remarks=$3 
         WHERE id=$4`,
        [status, req.session.user.id, comment || null, rid]
      );

      // Insert into request history
      await db.query(
        `INSERT INTO request_history (request_id, from_status, to_status, changed_by, note)
         VALUES ($1, 'UNDER_REVIEW', $2, $3, $4)`,
        [rid, status, req.session.user.id, comment || null]
      );

      // Notify citizen
      const getUser = await db.query(
        "SELECT citizen_id FROM requests WHERE id=$1",
        [rid]
      );
      const uid = getUser.rows[0].citizen_id;

      await db.query(
        "INSERT INTO notifications (user_id, request_id, message) VALUES ($1,$2,$3)",
        [uid, rid, `Your request #${rid} has been ${status}. ${comment || ""}`]
      );

      res.redirect("/officer");
    } catch (err) {
      console.error("Officer action error:", err);
      res.status(500).send("Server error");
    }
  }
);

export default router;
