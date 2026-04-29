const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { buildRequest } = require("./style_applier");

// Mirrors brad-cdn's short-id alphabet: 62^5 = ~916M combos.
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SHORT_ID_LENGTH = 5;
const SHORT_ID_MAX_ATTEMPTS = 8;

function generateShortId() {
  const bytes = crypto.randomBytes(SHORT_ID_LENGTH);
  let id = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return id;
}

// Build "<nick>: <prompt> <url>" trimmed to fit `maxLen` BYTES on a single IRC
// line. We size in bytes (not chars) because irc-framework splits messages
// at byte boundaries — smart quotes, em-dashes, and the trailing ellipsis
// itself are multi-byte UTF-8, so character-based math undershoots and the
// real byte length spills past the limit, causing irc-framework to break
// the URL onto its own line.
function byteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

function formatDeliveryMessage({ nick, prompt, url, maxLen }) {
  const prefix = `${nick}: `;
  const suffix = ` ${url}`;
  const room = maxLen - byteLen(prefix) - byteLen(suffix);
  const body = prompt || "";
  if (room <= 0) {
    return `${prefix}${suffix.trimStart()}`;
  }
  if (byteLen(body) <= room) {
    return `${prefix}${body}${suffix}`;
  }
  const ellipsis = "…";
  const target = room - byteLen(ellipsis);
  if (target <= 0) {
    return `${prefix}${ellipsis}${suffix}`;
  }
  // Iterate by code point so surrogate pairs stay intact.
  let truncated = "";
  let used = 0;
  for (const ch of body) {
    const cb = byteLen(ch);
    if (used + cb > target) break;
    truncated += ch;
    used += cb;
  }
  return `${prefix}${truncated.trimEnd()}${ellipsis}${suffix}`;
}

// Polling pattern mirrors ~/Coding/AI-Horde-Styles-Previews/index.js lines 374-430,
// adapted to push status updates back to the IRC user as they change.
class GenerationManager {
  constructor({ logger, db, hordeClient, r2Uploader, stylesCatalog, ircClient, config }) {
    this.logger = logger;
    this.db = db;
    this.horde = hordeClient;
    this.r2 = r2Uploader;
    this.styles = stylesCatalog;
    this.irc = ircClient;
    this.config = config;
    this.pollIntervalMs = (config.poll_interval_seconds || 10) * 1000;
    this.timeoutMs = (config.request_timeout_seconds || 600) * 1000;
    this.heartbeatIntervalMs =
      (config.heartbeat_interval_seconds || 60) * 1000;
    this.defaultStyle = config.default_style || null;
    this.inFlight = new Map(); // account -> { id, hordeId, nick, cancel }
  }

  isBusy(account) {
    return this.inFlight.has(account);
  }

  getInFlight(account) {
    return this.inFlight.get(account) || null;
  }

  // Cancel an in-flight request: tells the horde to drop it, marks the row
  // failed, and removes the inFlight entry so the user can submit again.
  async cancel(account, reason = "cancelled by user") {
    const entry = this.inFlight.get(account);
    if (!entry) return false;
    entry.cancelled = true;
    if (entry.hordeId) {
      this.horde.cancelGeneration(entry.hordeId).catch(() => {});
    }
    this.db.updateRequest(entry.id, {
      status: "failed",
      error: reason,
      completed_at: Date.now(),
    });
    this.inFlight.delete(account);
    return true;
  }

  async start({ account, apiKey, nick, channel, source, prompt, negative, styleName }) {
    if (this.isBusy(account)) {
      throw new BusyError("you already have a generation in progress");
    }

    let effectiveStyleName = styleName;
    if (!effectiveStyleName && this.defaultStyle) {
      effectiveStyleName = this.defaultStyle;
    }

    let style = null;
    if (effectiveStyleName) {
      style = this.styles.get(effectiveStyleName);
      if (!style) {
        // If the user explicitly asked for an unknown style, error out.
        // If we got here via the configured default and that's missing,
        // log a warning and proceed with no style rather than blocking.
        if (styleName) {
          const hints = this.styles.suggest(styleName);
          const suggestion = hints.length ? ` Did you mean: ${hints.join(", ")}?` : "";
          throw new InvalidStyleError(`unknown style "${styleName}".${suggestion}`);
        }
        this.logger.warn(
          `Configured default_style "${this.defaultStyle}" not found in catalog — falling back to no style`
        );
      }
    }

    const id = uuidv4();
    const shortId = this.allocShortId();
    const payload = buildRequest({
      prompt,
      negativePrompt: negative,
      style,
    });

    this.db.insertRequest({
      id,
      short_id: shortId,
      account,
      channel,
      source,
      prompt,
      negative_prompt: negative || null,
      style: style ? style.name : null,
      status: "submitted",
      created_at: Date.now(),
    });
    const entry = { id, account, hordeId: null, nick, prompt, cancelled: false };
    this.inFlight.set(account, entry);

    // Run async — caller doesn't await
    this.run({ id, shortId, account, apiKey, nick, channel, source, prompt, payload, style, entry }).catch(
      (err) => {
        this.logger.error(`Generation ${id} crashed: ${err.message}`);
        this.fail(id, account, nick, `internal error: ${err.message}`);
      }
    );

    return { id, shortId };
  }

  allocShortId() {
    for (let i = 0; i < SHORT_ID_MAX_ATTEMPTS; i++) {
      const candidate = generateShortId();
      if (!this.db.shortIdExists(candidate)) return candidate;
    }
    // Extremely unlikely. Fall back to a 6-char id to widen the space.
    return generateShortId() + ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }

  async run({ id, shortId, account, apiKey, nick, channel, source, prompt, payload, style, entry }) {
    let submitRes;
    try {
      submitRes = await this.horde.submitGeneration(payload, apiKey);
    } catch (err) {
      const detail = errorDetail(err);
      this.logger.warn(`Submit failed for ${id}: ${detail}`);
      return this.fail(id, account, nick, `horde rejected request: ${detail}`);
    }

    const hordeId = submitRes.id;
    if (!hordeId) {
      return this.fail(id, account, nick, "horde returned no generation id");
    }

    entry.hordeId = hordeId;
    this.db.updateRequest(id, { horde_id: hordeId, status: "processing" });
    this.dm(
      nick,
      `queued: ${describeRequest(style, payload.prompt)} (id ${(hordeId || "").split("-")[0]})`
    );

    const start = Date.now();
    let lastStatus = null;
    let lastDmAt = Date.now();
    let consecutiveCheckFailures = 0;

    while (true) {
      if (entry.cancelled) {
        this.logger.info(`Generation ${id} cancelled mid-poll`);
        return; // cancel() already cleaned up DB + inFlight
      }

      if (Date.now() - start > this.timeoutMs) {
        this.logger.warn(`Generation ${id} hit ${Math.round(this.timeoutMs / 1000)}s timeout`);
        await this.horde.cancelGeneration(hordeId);
        return this.fail(id, account, nick, `timed out after ${Math.round(this.timeoutMs / 1000)}s`);
      }

      await sleep(this.pollIntervalMs);

      let check;
      try {
        check = await this.horde.checkGeneration(hordeId);
        consecutiveCheckFailures = 0;
      } catch (err) {
        consecutiveCheckFailures++;
        this.logger.warn(
          `Check failed for ${id} (attempt ${consecutiveCheckFailures}): ${err.message}`
        );
        if (consecutiveCheckFailures >= 12) {
          return this.fail(
            id,
            account,
            nick,
            `lost contact with horde after ${consecutiveCheckFailures} failed polls (last error: ${err.message})`
          );
        }
        continue;
      }

      this.logger.debug(
        `Poll ${id.slice(0, 8)} done=${check.done} proc=${check.processing} wait=${check.waiting} q=${check.queue_position} possible=${check.is_possible} faulted=${check.faulted}`
      );

      if (check.faulted) {
        return this.fail(id, account, nick, "generation faulted on horde");
      }

      if (check.done) break;

      if (!check.processing && !check.waiting && !check.is_possible) {
        return this.fail(id, account, nick, "generation impossible (no available workers)");
      }

      const sig = `q=${check.queue_position}|p=${check.processing}|w=${check.waiting}`;
      const now = Date.now();
      const heartbeatDue = now - lastDmAt >= this.heartbeatIntervalMs;
      if (sig !== lastStatus || heartbeatDue) {
        lastStatus = sig;
        lastDmAt = now;
        const elapsed = Math.round((now - start) / 1000);
        this.dm(nick, `${formatStatus(check)} | ${elapsed}s elapsed`);
      }
    }

    if (entry.cancelled) return;

    let statusRes;
    try {
      statusRes = await this.horde.getGenerationStatus(hordeId);
    } catch (err) {
      return this.fail(id, account, nick, `failed to fetch result: ${err.message}`);
    }

    if (entry.cancelled) return;

    const gen = (statusRes.generations || [])[0];
    if (!gen || !gen.img) {
      return this.fail(id, account, nick, "no image returned by horde");
    }

    if (gen.censored) {
      this.db.updateRequest(id, {
        status: "censored",
        kudos: statusRes.kudos || 0,
        horde_image_url: gen.img,
        completed_at: Date.now(),
      });
      this.inFlight.delete(account);
      this.dm(nick, "your image was censored by the horde and discarded.");
      return;
    }

    let r2Url;
    try {
      r2Url = await this.r2.upload(gen.img, shortId);
    } catch (err) {
      this.logger.error(`R2 upload failed for ${id}: ${err.message}`);
      if (entry.cancelled) return;
      this.db.updateRequest(id, {
        status: "failed",
        error: `r2 upload failed: ${err.message}`,
        horde_image_url: gen.img,
        completed_at: Date.now(),
      });
      this.inFlight.delete(account);
      this.dm(nick, `image generated but R2 upload failed; raw URL: ${gen.img}`);
      return;
    }

    if (entry.cancelled) return;

    this.db.updateRequest(id, {
      status: "done",
      kudos: statusRes.kudos || 0,
      horde_image_url: gen.img,
      r2_image_url: r2Url,
      completed_at: Date.now(),
    });
    this.inFlight.delete(account);

    const maxLen = (this.irc && this.irc.maxLineLength) || 350;
    const deliveryMsg = formatDeliveryMessage({
      nick,
      prompt,
      url: r2Url,
      maxLen,
    });
    const deliveryTarget = source === "channel" ? channel : nick;
    this.irc.send(deliveryTarget, deliveryMsg);
    if (source === "channel") {
      const kudosNote = statusRes.kudos ? ` (${Math.round(statusRes.kudos)} kudos)` : "";
      this.dm(nick, `done: ${r2Url}${kudosNote}`);
    }
  }

  fail(id, account, nick, reason) {
    // If cancel() (or a prior fail) has already cleaned up this account, or
    // a new request has taken its slot, this call is a stale follow-up from
    // a polling loop that didn't notice — skip silently to avoid duplicate
    // DMs and DB writes.
    const entry = this.inFlight.get(account);
    if (!entry || entry.id !== id || entry.cancelled) return;
    entry.cancelled = true;
    this.db.updateRequest(id, {
      status: "failed",
      error: reason,
      completed_at: Date.now(),
    });
    this.inFlight.delete(account);
    this.dm(nick, `request failed: ${reason}`);
  }

  dm(nick, text) {
    if (!nick) return;
    this.irc.send(nick, text);
  }
}

class BusyError extends Error {}
class InvalidStyleError extends Error {}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function describeRequest(style, prompt) {
  const promptSnippet = prompt.length > 80 ? prompt.slice(0, 77) + "..." : prompt;
  return style ? `[${style.name}] ${promptSnippet}` : promptSnippet;
}

function formatStatus(check) {
  const parts = [];
  if (typeof check.queue_position === "number") {
    parts.push(`queue ${check.queue_position}`);
  }
  if (typeof check.wait_time === "number" && check.wait_time > 0) {
    parts.push(`eta ${check.wait_time}s`);
  }
  if (check.processing) parts.push(`processing on ${check.processing} worker(s)`);
  if (typeof check.kudos === "number") parts.push(`${Math.round(check.kudos)} kudos`);
  return parts.length ? parts.join(" | ") : "still working...";
}

function errorDetail(err) {
  if (err.response && err.response.data) {
    const data = err.response.data;
    if (typeof data === "object" && data.message) return data.message;
    return JSON.stringify(data).slice(0, 200);
  }
  return err.message;
}

module.exports = {
  GenerationManager,
  BusyError,
  InvalidStyleError,
  formatDeliveryMessage,
  generateShortId,
};
