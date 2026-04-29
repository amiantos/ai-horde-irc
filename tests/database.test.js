const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const DB = require("../classes/database");

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-horde-irc-test-"));
  return new DB(path.join(dir, "test.db"));
}

test("cleanupOrphanedRequests marks submitted+processing rows failed", () => {
  const db = tmpDb();
  const now = Date.now();
  db.insertRequest({ id: "a", account: "u", channel: "#x", source: "channel", prompt: "p", status: "submitted", created_at: now });
  db.insertRequest({ id: "b", account: "u", channel: "#x", source: "channel", prompt: "p", status: "processing", created_at: now });
  db.insertRequest({ id: "c", account: "u", channel: "#x", source: "channel", prompt: "p", status: "done", created_at: now });
  db.insertRequest({ id: "d", account: "u", channel: "#x", source: "channel", prompt: "p", status: "failed", created_at: now });

  const cleaned = db.cleanupOrphanedRequests();
  assert.equal(cleaned, 2);

  assert.equal(db.getRequest("a").status, "failed");
  assert.equal(db.getRequest("a").error, "orphaned: bot restarted while request was in flight");
  assert.ok(db.getRequest("a").completed_at);
  assert.equal(db.getRequest("b").status, "failed");
  // already-terminal rows untouched
  assert.equal(db.getRequest("c").status, "done");
  assert.equal(db.getRequest("d").status, "failed");
  assert.equal(db.getRequest("d").error, null);

  // running again is a no-op since no rows are in submitted/processing
  assert.equal(db.cleanupOrphanedRequests(), 0);
  db.close();
});
