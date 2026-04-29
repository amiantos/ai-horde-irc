const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  account TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_nick TEXT
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  short_id TEXT,
  account TEXT NOT NULL,
  channel TEXT NOT NULL,
  source TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  style TEXT,
  horde_id TEXT,
  status TEXT NOT NULL,
  kudos REAL,
  error TEXT,
  horde_image_url TEXT,
  r2_image_url TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_requests_account ON requests(account);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
`;

class DB {
  constructor(dbPath, logger = null) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.logger = logger;
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.runMigrations();
    this.prepare();
  }

  runMigrations() {
    const log = (msg) => (this.logger ? this.logger.info(msg) : console.log(msg));
    const cols = this.db.prepare(`PRAGMA table_info(requests)`).all();
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("short_id")) {
      log("DB migration: adding requests.short_id column");
      this.db.exec("ALTER TABLE requests ADD COLUMN short_id TEXT");
    }
    // Always idempotently ensure the supporting index exists.
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_requests_short_id ON requests(short_id)"
    );
  }

  prepare() {
    this.q = {
      upsertUser: this.db.prepare(
        `INSERT INTO users (account, api_key, created_at, updated_at, last_seen_nick)
         VALUES (@account, @api_key, @now, @now, @nick)
         ON CONFLICT(account) DO UPDATE SET
           api_key = excluded.api_key,
           updated_at = excluded.updated_at,
           last_seen_nick = excluded.last_seen_nick`
      ),
      getUser: this.db.prepare(`SELECT * FROM users WHERE account = ?`),
      deleteUser: this.db.prepare(`DELETE FROM users WHERE account = ?`),
      touchUserNick: this.db.prepare(
        `UPDATE users SET last_seen_nick = ?, updated_at = ? WHERE account = ?`
      ),
      listUsers: this.db.prepare(
        `SELECT u.account, u.created_at, u.updated_at, u.last_seen_nick,
                (SELECT COUNT(*) FROM requests r WHERE r.account = u.account) AS request_count,
                (SELECT MAX(created_at) FROM requests r WHERE r.account = u.account) AS last_request_at
         FROM users u
         ORDER BY (last_request_at IS NULL), last_request_at DESC`
      ),
      insertRequest: this.db.prepare(
        `INSERT INTO requests (id, short_id, account, channel, source, prompt, negative_prompt, style, horde_id, status, created_at)
         VALUES (@id, @short_id, @account, @channel, @source, @prompt, @negative_prompt, @style, @horde_id, @status, @created_at)`
      ),
      shortIdExists: this.db.prepare(
        `SELECT 1 FROM requests WHERE short_id = ? LIMIT 1`
      ),
      updateRequest: this.db.prepare(
        `UPDATE requests SET
           horde_id = COALESCE(@horde_id, horde_id),
           status = COALESCE(@status, status),
           kudos = COALESCE(@kudos, kudos),
           error = COALESCE(@error, error),
           horde_image_url = COALESCE(@horde_image_url, horde_image_url),
           r2_image_url = COALESCE(@r2_image_url, r2_image_url),
           completed_at = COALESCE(@completed_at, completed_at)
         WHERE id = @id`
      ),
      getRequest: this.db.prepare(`SELECT * FROM requests WHERE id = ?`),
      listRequests: this.db.prepare(
        `SELECT * FROM requests ORDER BY created_at DESC LIMIT ?`
      ),
      listRequestsByAccount: this.db.prepare(
        `SELECT * FROM requests WHERE account = ? ORDER BY created_at DESC LIMIT ?`
      ),
      orphanedRequests: this.db.prepare(
        `UPDATE requests
         SET status = 'failed',
             error = 'orphaned: bot restarted while request was in flight',
             completed_at = ?
         WHERE status IN ('submitted', 'processing')`
      ),
      stats: this.db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM users) AS user_count,
           (SELECT COUNT(*) FROM requests) AS request_count_total,
           (SELECT COUNT(*) FROM requests WHERE created_at >= ?) AS request_count_today,
           (SELECT COALESCE(SUM(kudos), 0) FROM requests WHERE created_at >= ?) AS kudos_today,
           (SELECT COALESCE(SUM(kudos), 0) FROM requests) AS kudos_total,
           (SELECT COUNT(*) FROM requests WHERE status = 'done') AS done_count,
           (SELECT COUNT(*) FROM requests WHERE status = 'failed') AS failed_count`
      ),
    };
  }

  upsertUser(account, apiKey, nick) {
    const now = Date.now();
    this.q.upsertUser.run({ account, api_key: apiKey, now, nick: nick || null });
  }

  getUser(account) {
    return this.q.getUser.get(account);
  }

  deleteUser(account) {
    this.q.deleteUser.run(account);
  }

  touchUserNick(account, nick) {
    this.q.touchUserNick.run(nick, Date.now(), account);
  }

  listUsers() {
    return this.q.listUsers.all();
  }

  insertRequest(row) {
    this.q.insertRequest.run({
      short_id: null,
      negative_prompt: null,
      style: null,
      horde_id: null,
      ...row,
    });
  }

  shortIdExists(shortId) {
    return !!this.q.shortIdExists.get(shortId);
  }

  updateRequest(id, fields) {
    this.q.updateRequest.run({
      id,
      horde_id: null,
      status: null,
      kudos: null,
      error: null,
      horde_image_url: null,
      r2_image_url: null,
      completed_at: null,
      ...fields,
    });
  }

  getRequest(id) {
    return this.q.getRequest.get(id);
  }

  listRequests(limit = 100) {
    return this.q.listRequests.all(limit);
  }

  listRequestsByAccount(account, limit = 50) {
    return this.q.listRequestsByAccount.all(account, limit);
  }

  cleanupOrphanedRequests() {
    const result = this.q.orphanedRequests.run(Date.now());
    return result.changes;
  }

  stats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const ts = startOfDay.getTime();
    return this.q.stats.get(ts, ts);
  }

  close() {
    this.db.close();
  }
}

module.exports = DB;
