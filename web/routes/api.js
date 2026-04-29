const express = require("express");
const router = express.Router();

router.get("/stats", (req, res) => {
  try {
    const s = req.db.stats();
    res.json(s);
  } catch (err) {
    req.logger.error(`stats error: ${err.message}`);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/users", (req, res) => {
  try {
    res.json(req.db.listUsers());
  } catch (err) {
    req.logger.error(`users error: ${err.message}`);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/users/:account/requests", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(req.db.listRequestsByAccount(req.params.account, limit));
  } catch (err) {
    req.logger.error(`user requests error: ${err.message}`);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/requests", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    res.json(req.db.listRequests(limit));
  } catch (err) {
    req.logger.error(`requests error: ${err.message}`);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/requests/:id", (req, res) => {
  try {
    const row = req.db.getRequest(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (err) {
    req.logger.error(`request detail error: ${err.message}`);
    res.status(500).json({ error: "internal error" });
  }
});

module.exports = router;
