const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPromptWithStyle,
  buildRequest,
} = require("../classes/style_applier");

test("no style, no negative: prompt unchanged", () => {
  const out = buildPromptWithStyle({ prompt: "a cat", negativePrompt: null, style: null });
  assert.equal(out, "a cat");
});

test("no style, with negative: ### separator", () => {
  const out = buildPromptWithStyle({
    prompt: "a cat",
    negativePrompt: "blurry",
    style: null,
  });
  assert.equal(out, "a cat ### blurry");
});

test("style with {p}{np} template, no negative: empty np cleaned", () => {
  const style = { prompt: "{p}{np}" };
  const out = buildPromptWithStyle({ prompt: "a cat", negativePrompt: "", style });
  assert.equal(out, "a cat");
});

test("style with {p}{np} and a negative: appends ### negative", () => {
  const style = { prompt: "{p}{np}" };
  const out = buildPromptWithStyle({
    prompt: "a cat",
    negativePrompt: "blurry",
    style,
  });
  assert.equal(out, "a cat ### blurry");
});

test("style with {p}###{np} template + negative: substitutes", () => {
  const style = { prompt: "{p}###{np}" };
  const out = buildPromptWithStyle({
    prompt: "a cat",
    negativePrompt: "blurry",
    style,
  });
  assert.equal(out, "a cat###blurry");
});

test("style with {p}###{np} template + no negative: empty np", () => {
  const style = { prompt: "{p}###{np}" };
  const out = buildPromptWithStyle({ prompt: "a cat", negativePrompt: "", style });
  assert.equal(out, "a cat###");
});

test("buildRequest: no style returns minimal payload", () => {
  const req = buildRequest({ prompt: "a cat", negativePrompt: null, style: null });
  assert.equal(req.prompt, "a cat");
  assert.equal(req.r2, true);
  assert.equal(req.params, undefined, "no params block when no style");
  assert.equal(req.models, undefined, "no models override when no style");
});

test("buildRequest: with style copies whitelisted params and overrides model", () => {
  const style = {
    name: "aam xl",
    prompt: "{p}###{np}",
    model: "AAM XL",
    sampler_name: "k_euler_a",
    steps: 25,
    width: 832,
    height: 1216,
    clip_skip: 2,
    cfg_scale: 7,
  };
  const req = buildRequest({ prompt: "a cat", negativePrompt: null, style });
  assert.deepEqual(req.models, ["AAM XL"]);
  assert.equal(req.params.steps, 25);
  assert.equal(req.params.width, 832);
  assert.equal(req.params.height, 1216);
  assert.equal(req.params.cfg_scale, 7);
  assert.equal(req.params.clip_skip, 2);
  assert.equal(req.params.sampler_name, "k_euler_a");
  assert.equal(req.prompt, "a cat###");
});

test("buildRequest: empty loras array does not override base", () => {
  const style = { prompt: "{p}", loras: [] };
  const req = buildRequest({ prompt: "x", negativePrompt: null, style });
  assert.equal(req.params.loras, undefined, "empty loras array ignored");
});
