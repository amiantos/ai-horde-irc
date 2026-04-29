const path = require("path");
const Logger = require("./classes/logger");
const DB = require("./classes/database");
const IrcClient = require("./classes/irc_client");
const NickServVerifier = require("./classes/nickserv");
const HordeClient = require("./classes/horde_client");
const StylesCatalog = require("./classes/styles_catalog");
const R2Uploader = require("./classes/r2_uploader");
const {
  GenerationManager,
  BusyError,
  InvalidStyleError,
} = require("./classes/generation_manager");
const {
  parseDmCommand,
  parseImageRequest,
} = require("./classes/command_router");
const WebServer = require("./web/server");

const HELP_LINES = [
  "AIHorde — DM commands: LOGIN <api-key>, LOGOUT, USERINFO, STYLES <query>, STATUS, CANCEL, HELP",
  "Image request (channel or DM): \"AIHorde: <prompt> [--style <name>] [--negative <text>]\"",
  "Anyone can request images — anonymous requests use the horde's shared pool (slower). LOGIN with your own API key for priority + kudos tracking. LOGIN requires NickServ identification.",
  "STYLES searches available style names with preview images. STATUS shows your in-flight request. CANCEL aborts your in-flight request. Status updates are DM-only; final image URL goes back to the channel where you asked.",
];

async function main() {
  const logger = new Logger(process.env.NODE_ENV !== "production");
  const config = require(path.join(__dirname, "conf", "config.json"));

  const db = new DB(path.join(__dirname, "data", "ai-horde-irc.db"), logger);
  const orphaned = db.cleanupOrphanedRequests();
  if (orphaned > 0) {
    logger.info(`Marked ${orphaned} orphaned in-flight request${orphaned === 1 ? "" : "s"} as failed`);
  }
  const irc = new IrcClient(logger, config);
  const nickserv = new NickServVerifier(irc.client, logger);
  const horde = new HordeClient(logger, config.horde || {});
  const styles = new StylesCatalog(
    logger,
    path.join(__dirname, "data", "styles_cache.json")
  );
  const r2 = new R2Uploader(logger, config.r2);

  await styles.load();

  const genManager = new GenerationManager({
    logger,
    db,
    hordeClient: horde,
    r2Uploader: r2,
    stylesCatalog: styles,
    ircClient: irc,
    config: config.horde || {},
  });

  irc.onPrivmsg(async (msg) => {
    try {
      await dispatch({
        msg,
        irc,
        db,
        nickserv,
        horde,
        styles,
        genManager,
        botNick: irc.botNick,
        logger,
      });
    } catch (err) {
      logger.error(`dispatch error: ${err.message}\n${err.stack}`);
    }
  });

  let webServer = null;
  if (config.web && config.web.enabled) {
    webServer = new WebServer(logger, config, db);
    webServer.start();
  }

  irc.connect();

  const shutdown = (sig) => {
    logger.info(`Received ${sig}, shutting down`);
    irc.shutdown();
    styles.stop();
    if (webServer) webServer.stop();
    setTimeout(() => {
      try { db.close(); } catch (_) {}
      process.exit(0);
    }, 500);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function dispatch({ msg, irc, db, nickserv, horde, styles, genManager, botNick, logger }) {
  // DM-only command verbs (LOGIN/LOGOUT/USERINFO/STYLES/STATUS/CANCEL/HELP)
  if (msg.isPrivate) {
    const cmd = parseDmCommand(msg.message);
    if (cmd) {
      return handleDmCommand({ cmd, msg, irc, db, nickserv, horde, styles, genManager, logger });
    }
    // Image-request trigger works in DMs too (with the explicit prefix).
    const req = parseImageRequest(msg.message, botNick);
    if (req && req.prompt) {
      return handleImageRequest({ req, msg, irc, db, nickserv, genManager, logger });
    }
    // Anything else: respond with the chanserv-style "unknown command" hint.
    irc.send(msg.nick, `Invalid ${irc.botNick} command.`);
    irc.send(msg.nick, `Use /msg ${irc.botNick} HELP for a command listing.`);
    return;
  }

  // Channel: only respond to image-request triggers and explicit help mentions.
  const req = parseImageRequest(msg.message, botNick);
  if (req && req.prompt) {
    return handleImageRequest({ req, msg, irc, db, nickserv, genManager, logger });
  }
  if (new RegExp(`\\b${escapeRe(botNick)}\\b`, "i").test(msg.message) && /\bhelp\b/i.test(msg.message)) {
    HELP_LINES.forEach((l) => irc.send(msg.target, l));
  }
}

async function handleDmCommand({ cmd, msg, irc, db, nickserv, horde, styles, genManager, logger }) {
  const replyTo = msg.nick;
  switch (cmd.type) {
    case "HELP":
      HELP_LINES.forEach((l) => irc.send(replyTo, l));
      return;
    case "LOGIN": {
      if (cmd.error) {
        irc.send(replyTo, `usage: LOGIN <api-key>`);
        return;
      }
      const account = await nickserv.getAccount(msg.nick);
      if (!account) {
        irc.send(
          replyTo,
          "you must be identified with NickServ first. Try /msg NickServ identify <password>, then retry LOGIN."
        );
        return;
      }
      // Validate the key by hitting find_user before storing.
      let userInfo;
      try {
        userInfo = await horde.findUser(cmd.apiKey);
      } catch (err) {
        irc.send(replyTo, `that key was rejected by the horde: ${apiErr(err)}`);
        return;
      }
      db.upsertUser(account.toLowerCase(), cmd.apiKey, msg.nick);
      const username = (userInfo && userInfo.username) || account;
      irc.send(replyTo, `logged in as ${account} (horde user: ${username}). Your key is stored against your NickServ account.`);
      return;
    }
    case "LOGOUT": {
      const account = await nickserv.getAccount(msg.nick);
      if (!account) {
        irc.send(replyTo, "you must be identified with NickServ to LOGOUT.");
        return;
      }
      db.deleteUser(account.toLowerCase());
      irc.send(replyTo, `logged out (account ${account}).`);
      return;
    }
    case "USERINFO": {
      const account = await nickserv.getAccount(msg.nick);
      if (!account) {
        irc.send(replyTo, "you must be identified with NickServ.");
        return;
      }
      const user = db.getUser(account.toLowerCase());
      if (!user) {
        irc.send(replyTo, "no API key stored. Use LOGIN <api-key> first.");
        return;
      }
      try {
        const info = await horde.findUser(user.api_key);
        const kudos = info && info.kudos != null ? Math.round(info.kudos) : "?";
        const username = (info && info.username) || account;
        const reqs = info && info.records && info.records.request ? sumRequestRecords(info.records.request) : "?";
        const workers = info && info.worker_ids ? info.worker_ids.length : 0;
        irc.send(replyTo, `${username} | kudos: ${kudos} | total requests: ${reqs} | workers: ${workers}`);
      } catch (err) {
        irc.send(replyTo, `find_user failed: ${apiErr(err)}`);
      }
      return;
    }
    case "STATUS": {
      // Find the user's in-flight request via either NickServ account or anon key.
      const account = await nickserv.getAccount(msg.nick);
      const candidates = [];
      if (account) candidates.push(account.toLowerCase());
      candidates.push(`anon:${msg.nick.toLowerCase()}`);
      let entry = null;
      let matchedKey = null;
      for (const key of candidates) {
        const e = genManager.getInFlight(key);
        if (e) { entry = e; matchedKey = key; break; }
      }
      if (!entry) {
        irc.send(replyTo, "no in-flight request.");
        return;
      }
      const row = db.getRequest(entry.id);
      const elapsed = row ? Math.round((Date.now() - row.created_at) / 1000) : "?";
      const hordeIdShort = entry.hordeId ? entry.hordeId.split("-")[0] : "(submitting)";
      irc.send(
        replyTo,
        `in-flight: ${row ? row.status : "?"} | id ${hordeIdShort} | ${elapsed}s elapsed | account ${matchedKey}`
      );
      return;
    }
    case "CANCEL": {
      const account = await nickserv.getAccount(msg.nick);
      const candidates = [];
      if (account) candidates.push(account.toLowerCase());
      candidates.push(`anon:${msg.nick.toLowerCase()}`);
      let cancelled = false;
      for (const key of candidates) {
        if (genManager.isBusy(key)) {
          await genManager.cancel(key);
          cancelled = true;
          break;
        }
      }
      irc.send(
        replyTo,
        cancelled ? "request cancelled." : "no in-flight request to cancel."
      );
      return;
    }
    case "STYLES": {
      if (cmd.error) {
        irc.send(replyTo, "usage: STYLES <query> — searches style/category names");
        return;
      }
      const matches = styles.search(cmd.query, 8);
      if (!matches.length) {
        irc.send(replyTo, `no styles found matching "${cmd.query}".`);
        return;
      }
      irc.send(replyTo, `${matches.length} match${matches.length === 1 ? "" : "es"} for "${cmd.query}":`);
      for (const m of matches) {
        if (m.kind === "category") {
          irc.send(replyTo, `  ${m.name} (category — picks a random style from this set)`);
        } else if (m.preview) {
          irc.send(replyTo, `  ${m.name} — ${m.preview}`);
        } else {
          irc.send(replyTo, `  ${m.name}`);
        }
      }
      return;
    }
  }
}

async function handleImageRequest({ req, msg, irc, db, nickserv, genManager, logger }) {
  const replyTarget = msg.isPrivate ? msg.nick : msg.target;

  // Try to resolve a logged-in user via NickServ account; fall back to the
  // horde anonymous key (`0000000000`) so anyone in-channel can generate.
  let apiKey = null;
  let accountKey = null;
  const account = await nickserv.getAccount(msg.nick);
  if (account) {
    const user = db.getUser(account.toLowerCase());
    if (user) {
      apiKey = user.api_key;
      accountKey = account.toLowerCase();
      db.touchUserNick(accountKey, msg.nick);
    }
  }
  if (!apiKey) {
    apiKey = "0000000000";
    accountKey = `anon:${msg.nick.toLowerCase()}`;
  }

  if (req.unknown && req.unknown.length) {
    const names = req.unknown.map((u) => `--${u.flag}`).join(", ");
    irc.send(msg.nick, `(ignoring unknown flag${req.unknown.length > 1 ? "s" : ""}: ${names})`);
  }

  try {
    await genManager.start({
      account: accountKey,
      apiKey,
      nick: msg.nick,
      channel: msg.isPrivate ? msg.nick : msg.target,
      source: msg.isPrivate ? "dm" : "channel",
      prompt: req.prompt,
      negative: req.negative,
      styleName: req.style,
    });
  } catch (err) {
    if (err instanceof BusyError) {
      irc.send(replyTarget, `${msg.nick}: ${err.message}`);
    } else if (err instanceof InvalidStyleError) {
      irc.send(replyTarget, `${msg.nick}: ${err.message}`);
    } else {
      logger.error(`start failed: ${err.message}`);
      irc.send(replyTarget, `${msg.nick}: failed to submit (${err.message})`);
    }
  }
}

function sumRequestRecords(req) {
  if (typeof req !== "object" || !req) return 0;
  return Object.values(req).reduce((acc, v) => acc + (typeof v === "number" ? v : 0), 0);
}

function apiErr(err) {
  if (err.response && err.response.data && err.response.data.message) {
    return err.response.data.message;
  }
  return err.message;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
