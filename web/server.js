const express = require("express");
const path = require("path");
const apiRoutes = require("./routes/api");

// Mirrors ~/Coding/impostor/web/server.js — basic-auth-gated dashboard with /api routes.
class WebServer {
  constructor(logger, config, db) {
    this.logger = logger;
    this.config = config;
    this.db = db;
    this.app = express();
    this.server = null;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    const auth = this.config.web && this.config.web.auth;
    if (auth && auth.username && auth.password) {
      this.app.use((req, res, next) => {
        if (req.path === "/health") return next();
        const header = req.headers.authorization;
        if (!header || !header.startsWith("Basic ")) {
          res.setHeader("WWW-Authenticate", 'Basic realm="AI Horde IRC"');
          return res.status(401).send("Authentication required");
        }
        const creds = Buffer.from(header.slice(6), "base64").toString();
        const [user, pass] = creds.split(":");
        if (user === auth.username && pass === auth.password) return next();
        res.setHeader("WWW-Authenticate", 'Basic realm="AI Horde IRC"');
        return res.status(401).send("Invalid credentials");
      });
    }

    this.app.use((req, _res, next) => {
      req.db = this.db;
      req.logger = this.logger;
      next();
    });
  }

  setupRoutes() {
    this.app.use("/api", apiRoutes);
    this.app.get("/", (_req, res) => {
      res.sendFile(path.join(__dirname, "views", "dashboard.html"));
    });
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });
  }

  start() {
    const port = (this.config.web && this.config.web.port) || 3000;
    this.server = this.app.listen(port, () => {
      this.logger.info(`Web dashboard running at http://localhost:${port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close(() => this.logger.info("Web server stopped"));
    }
  }
}

module.exports = WebServer;
