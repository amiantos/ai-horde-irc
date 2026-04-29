const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseDmCommand,
  parseImageRequest,
} = require("../classes/command_router");

test("LOGIN with key", () => {
  const cmd = parseDmCommand("LOGIN abc-def-123");
  assert.deepEqual(cmd, { type: "LOGIN", apiKey: "abc-def-123" });
});

test("LOGIN without key reports error", () => {
  const cmd = parseDmCommand("LOGIN");
  assert.equal(cmd.type, "LOGIN");
  assert.equal(cmd.error, "missing api key");
});

test("login is case-insensitive", () => {
  const cmd = parseDmCommand("login mykey");
  assert.equal(cmd.type, "LOGIN");
  assert.equal(cmd.apiKey, "mykey");
});

test("LOGOUT, USERINFO, HELP recognized", () => {
  assert.equal(parseDmCommand("LOGOUT").type, "LOGOUT");
  assert.equal(parseDmCommand("USERINFO").type, "USERINFO");
  assert.equal(parseDmCommand("help").type, "HELP");
});

test("STATUS and CANCEL recognized", () => {
  assert.equal(parseDmCommand("STATUS").type, "STATUS");
  assert.equal(parseDmCommand("status").type, "STATUS");
  assert.equal(parseDmCommand("CANCEL").type, "CANCEL");
  assert.equal(parseDmCommand("cancel").type, "CANCEL");
});

test("STYLES requires a query", () => {
  const a = parseDmCommand("STYLES");
  assert.equal(a.type, "STYLES");
  assert.equal(a.error, "missing query");
  const b = parseDmCommand("styles aam");
  assert.equal(b.type, "STYLES");
  assert.equal(b.query, "aam");
  // SEARCH alias works too
  const c = parseDmCommand("SEARCH dark fantasy");
  assert.equal(c.type, "STYLES");
  assert.equal(c.query, "dark fantasy");
});

test("unknown verb returns null", () => {
  assert.equal(parseDmCommand("DANCE"), null);
  assert.equal(parseDmCommand(""), null);
});

test("image request: bare prompt", () => {
  const r = parseImageRequest("AIHorde: a cat on a roof", "AIHorde");
  assert.equal(r.prompt, "a cat on a roof");
  assert.equal(r.style, null);
  assert.equal(r.negative, null);
  assert.deepEqual(r.unknown, []);
});

test("image request: --style with multi-word name", () => {
  const r = parseImageRequest(
    "AIHorde: a cat on a roof --style aam xl",
    "AIHorde"
  );
  assert.equal(r.prompt, "a cat on a roof");
  assert.equal(r.style, "aam xl");
});

test("image request: --negative flag", () => {
  const r = parseImageRequest(
    "AIHorde: a cat --negative blurry, text",
    "AIHorde"
  );
  assert.equal(r.prompt, "a cat");
  assert.equal(r.negative, "blurry, text");
});

test("image request: --style and --negative together", () => {
  const r = parseImageRequest(
    "AIHorde: a cat --style aam xl --negative blurry",
    "AIHorde"
  );
  assert.equal(r.prompt, "a cat");
  assert.equal(r.style, "aam xl");
  assert.equal(r.negative, "blurry");
});

test("image request: trigger with comma", () => {
  const r = parseImageRequest("AIHorde, hello world", "AIHorde");
  assert.equal(r.prompt, "hello world");
});

test("image request: case-insensitive trigger", () => {
  const r = parseImageRequest("aihorde: hi there", "AIHorde");
  assert.equal(r.prompt, "hi there");
});

test("image request: non-trigger returns null", () => {
  assert.equal(parseImageRequest("hello AIHorde", "AIHorde"), null);
  assert.equal(parseImageRequest("just chatting", "AIHorde"), null);
});

test("image request: unknown flag captured separately", () => {
  const r = parseImageRequest("AIHorde: cat --width 1024 --style aam xl", "AIHorde");
  assert.equal(r.prompt, "cat");
  assert.equal(r.style, "aam xl");
  assert.deepEqual(r.unknown, [{ flag: "width", value: "1024" }]);
});
