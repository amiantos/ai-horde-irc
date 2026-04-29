const fs = require("fs");
const path = require("path");
const axios = require("axios");

const STYLES_URL =
  "https://raw.githubusercontent.com/Haidra-Org/AI-Horde-Styles/main/styles.json";
const CATEGORIES_URL =
  "https://raw.githubusercontent.com/Haidra-Org/AI-Horde-Styles/main/categories.json";
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

class StylesCatalog {
  constructor(logger, cachePath) {
    this.logger = logger;
    this.cachePath = cachePath;
    this.styles = {};
    this.categories = {};
    this.refreshTimer = null;
  }

  async load() {
    try {
      await this.refresh();
    } catch (err) {
      this.logger.warn(`Failed to fetch styles from GitHub: ${err.message}`);
      if (fs.existsSync(this.cachePath)) {
        try {
          const cached = JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
          this.styles = cached.styles || {};
          this.categories = cached.categories || {};
          this.logger.info(
            `Loaded ${Object.keys(this.styles).length} styles from disk cache`
          );
        } catch (cacheErr) {
          this.logger.error(`Disk cache also unreadable: ${cacheErr.message}`);
        }
      }
    }

    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) =>
        this.logger.warn(`Style refresh failed: ${err.message}`)
      );
    }, REFRESH_INTERVAL_MS);
  }

  async refresh() {
    const [stylesRes, catsRes] = await Promise.all([
      axios.get(STYLES_URL, { timeout: 15000 }),
      axios.get(CATEGORIES_URL, { timeout: 15000 }),
    ]);
    this.styles = stylesRes.data || {};
    this.categories = catsRes.data || {};
    this.logger.info(
      `Loaded ${Object.keys(this.styles).length} styles, ${Object.keys(this.categories).length} categories`
    );
    this.persistCache();
  }

  persistCache() {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.cachePath,
        JSON.stringify({ styles: this.styles, categories: this.categories })
      );
    } catch (err) {
      this.logger.warn(`Could not persist styles cache: ${err.message}`);
    }
  }

  // Mirrors AI-Horde-Discord/src/classes/client.ts:104-125 — try style first,
  // fall back to picking a random style from a matching category.
  get(name) {
    if (!name) return null;
    const lower = name.toLowerCase().trim();

    if (this.styles[lower]) {
      return { ...this.styles[lower], name: lower, type: "style" };
    }

    const catList = this.categories[lower];
    if (Array.isArray(catList) && catList.length > 0) {
      const pick = catList[Math.floor(Math.random() * catList.length)];
      const styleData = this.styles[pick.toLowerCase()];
      if (styleData) {
        return { ...styleData, name: pick.toLowerCase(), type: "category-style" };
      }
    }

    return null;
  }

  suggest(name, limit = 3) {
    const lower = (name || "").toLowerCase().trim();
    if (!lower) return [];
    const allNames = Object.keys(this.styles).concat(Object.keys(this.categories));
    const seen = new Set();
    const scored = [];
    for (const n of allNames) {
      if (seen.has(n)) continue;
      seen.add(n);
      const score = similarity(lower, n);
      if (score > 0.4) scored.push({ name: n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.name);
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}

function similarity(a, b) {
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.85;
  const aSet = new Set(a.split(""));
  const bSet = new Set(b.split(""));
  let inter = 0;
  for (const ch of aSet) if (bSet.has(ch)) inter++;
  return inter / Math.max(aSet.size, bSet.size);
}

module.exports = StylesCatalog;
