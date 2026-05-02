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

test("delivery: long prompt is truncated with ellipsis to fit max bytes", () => {
  const long = "a ".repeat(400);
  const out = formatDeliveryMessage({
    nick: "amiantos",
    prompt: long,
    url: "https://irc.aislingeach.com/HnJuX.webp",
    maxLen: 350,
  });
  assert.ok(
    Buffer.byteLength(out, "utf8") <= 350,
    `got ${Buffer.byteLength(out, "utf8")} bytes: ${out}`
  );
  assert.ok(out.startsWith("amiantos: "));
  assert.ok(out.endsWith(" https://irc.aislingeach.com/HnJuX.webp"));
  assert.ok(out.includes("…"));
});

test("delivery: prompt with smart quotes / em-dashes still fits in byte limit", () => {
  // "'" U+2019 (3 bytes), "—" U+2014 (3 bytes). A char-based truncator
  // that counts these as 1 char each will silently overshoot the byte limit.
  const tricky = "the hill’s grass — lush, green — ".repeat(20);
  const out = formatDeliveryMessage({
    nick: "amiantos",
    prompt: tricky,
    url: "https://irc.aislingeach.com/HnJuX.webp",
    maxLen: 350,
  });
  assert.ok(
    Buffer.byteLength(out, "utf8") <= 350,
    `got ${Buffer.byteLength(out, "utf8")} bytes`
  );
  assert.ok(out.endsWith(" https://irc.aislingeach.com/HnJuX.webp"));
});

test("delivery: emoji (surrogate pairs) don't get split mid-codepoint", () => {
  const emoji = "🎨".repeat(200);
  const out = formatDeliveryMessage({
    nick: "amiantos",
    prompt: emoji,
    url: "https://irc.aislingeach.com/HnJuX.webp",
    maxLen: 350,
  });
  assert.ok(Buffer.byteLength(out, "utf8") <= 350);
  // No lone surrogate halves
  assert.doesNotMatch(out, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
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

test("delivery: style name appears in brackets before the prompt", () => {
  const out = formatDeliveryMessage({
    nick: "amiantos",
    style: "sdxl-landscape",
    prompt: "an idyllic babbling brook",
    url: "https://files.catbox.moe/abc123.webp",
    maxLen: 350,
  });
  assert.equal(
    out,
    "amiantos: [sdxl-landscape] an idyllic babbling brook https://files.catbox.moe/abc123.webp"
  );
});

test("delivery: style label survives prompt truncation", () => {
  const long = "a ".repeat(400);
  const out = formatDeliveryMessage({
    nick: "amiantos",
    style: "sdxl-landscape",
    prompt: long,
    url: "https://files.catbox.moe/abc123.webp",
    maxLen: 350,
  });
  assert.ok(Buffer.byteLength(out, "utf8") <= 350);
  assert.ok(out.startsWith("amiantos: [sdxl-landscape] "));
  assert.ok(out.endsWith(" https://files.catbox.moe/abc123.webp"));
  assert.ok(out.includes("…"));
});
