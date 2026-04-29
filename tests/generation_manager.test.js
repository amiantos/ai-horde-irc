const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatDeliveryMessage,
  generateShortId,
} = require("../classes/generation_manager");

test("short id is 5 chars in the alphanumeric alphabet", () => {
  for (let i = 0; i < 50; i++) {
    const id = generateShortId();
    assert.equal(id.length, 5);
    assert.match(id, /^[A-Za-z0-9]{5}$/);
  }
});

test("delivery: short prompt fits without truncation", () => {
  const out = formatDeliveryMessage({
    nick: "amiantos",
    prompt: "an idyllic babbling brook",
    url: "https://irc.aislingeach.com/HnJuX.webp",
    maxLen: 350,
  });
  assert.equal(
    out,
    "amiantos: an idyllic babbling brook https://irc.aislingeach.com/HnJuX.webp"
  );
  assert.ok(out.length <= 350);
});

test("delivery: long prompt is truncated with ellipsis to fit max line", () => {
  const long = "a ".repeat(400);
  const out = formatDeliveryMessage({
    nick: "amiantos",
    prompt: long,
    url: "https://irc.aislingeach.com/HnJuX.webp",
    maxLen: 350,
  });
  assert.ok(out.length <= 350, `got ${out.length} chars: ${out}`);
  assert.ok(out.startsWith("amiantos: "));
  assert.ok(out.endsWith(" https://irc.aislingeach.com/HnJuX.webp"));
  assert.ok(out.includes("…"));
});

test("delivery: empty prompt produces compact form", () => {
  const out = formatDeliveryMessage({
    nick: "x",
    prompt: "",
    url: "https://example.com/a.webp",
    maxLen: 350,
  });
  assert.equal(out, "x:  https://example.com/a.webp");
});
