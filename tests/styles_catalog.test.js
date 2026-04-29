const { test } = require("node:test");
const assert = require("node:assert/strict");
const StylesCatalog = require("../classes/styles_catalog");

function makeCatalog() {
  const cat = new StylesCatalog({ info: () => {}, warn: () => {}, error: () => {} }, "/tmp/none");
  cat.styles = {
    "aam xl": { prompt: "{p}{np}", model: "AAM XL" },
    "aam classic": { prompt: "{p}{np}", model: "AAM" },
    "flux": { prompt: "{p}{np}" },
    "dark fantasy": { prompt: "{p}{np}" },
    "raw": { prompt: "{p}" },
  };
  cat.categories = {
    "anime": ["aam xl", "aam classic"],
    "realistic": ["flux"],
  };
  cat.previews = {
    "aam xl": {
      person: "https://example/aam_xl_person.webp",
      place: "https://example/aam_xl_place.webp",
    },
    "flux": {
      person: "https://example/flux_person.webp",
    },
  };
  return cat;
}

test("getPreviewUrl returns person URL by default, falls back when missing", () => {
  const c = makeCatalog();
  assert.equal(c.getPreviewUrl("aam xl"), "https://example/aam_xl_person.webp");
  assert.equal(c.getPreviewUrl("aam xl", "place"), "https://example/aam_xl_place.webp");
  assert.equal(c.getPreviewUrl("aam xl", "thing"), "https://example/aam_xl_person.webp");
  assert.equal(c.getPreviewUrl("dark fantasy"), null);
  assert.equal(c.getPreviewUrl("does-not-exist"), null);
});

test("search ranks exact match first, then prefix, then substring", () => {
  const c = makeCatalog();
  const results = c.search("aam");
  const names = results.map((r) => r.name);
  assert.ok(names.includes("aam xl"));
  assert.ok(names.includes("aam classic"));
  // Prefix matches should come before unrelated styles
  assert.equal(names[0].startsWith("aam"), true);
});

test("search returns categories with kind=category", () => {
  const c = makeCatalog();
  const results = c.search("anime");
  assert.equal(results[0].name, "anime");
  assert.equal(results[0].kind, "category");
});

test("search includes preview URL on style results", () => {
  const c = makeCatalog();
  const results = c.search("aam xl");
  const aamxl = results.find((r) => r.name === "aam xl");
  assert.equal(aamxl.preview, "https://example/aam_xl_person.webp");
});

test("search returns empty for blank or no-match queries", () => {
  const c = makeCatalog();
  assert.deepEqual(c.search(""), []);
  assert.deepEqual(c.search("zzzzzzzz"), []);
});

test("search caps results at limit", () => {
  const c = makeCatalog();
  const results = c.search("a", 2);
  assert.ok(results.length <= 2);
});
