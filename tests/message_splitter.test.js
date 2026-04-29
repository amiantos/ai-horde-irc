const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitMessage } = require("../classes/message_splitter");

test("returns the input unchanged when it fits", () => {
  assert.deepEqual(splitMessage("hello world", 100), ["hello world"]);
});

test("splits at word boundary at or before maxLen", () => {
  const text = "alpha beta gamma delta epsilon zeta eta";
  const lines = splitMessage(text, 20);
  for (const line of lines) {
    assert.ok(line.length <= 20, `line too long: ${line}`);
  }
  assert.equal(lines.join(" "), text);
});

test("does not split a URL across lines", () => {
  const url = "https://example.com/some/very/long/path/here";
  const text = `look at this ${url} cool right`;
  const lines = splitMessage(text, 30);
  const joined = lines.join(" ");
  assert.ok(joined.includes(url), "url survived intact");
});

test("returns an empty-string array for blank input", () => {
  assert.deepEqual(splitMessage("", 100), [""]);
});
