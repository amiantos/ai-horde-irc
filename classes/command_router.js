// Command parsing for the AI Horde IRC bot.
//
// DM commands (case-insensitive):
//   LOGIN <api-key>
//   LOGOUT
//   USERINFO
//   HELP
//
// Image-request trigger (channel or DM):
//   AIHorde: <prompt> [--style <name>] [--negative <text>]
//
// The image-request flag tokenizer is generic: any `--<name>` is treated
// as a flag whose value runs to the next `--flag` or end of line. Unknown
// flags are returned in `unknown` so the caller can warn the user.

const FLAG_RE = /(^|\s)--([a-zA-Z][\w-]*)\s+/;
const KNOWN_FLAGS = new Set(["style", "negative"]);

function parseDmCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(" ");
  const verb = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toUpperCase();
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  switch (verb) {
    case "LOGIN":
      if (!rest) return { type: "LOGIN", error: "missing api key" };
      return { type: "LOGIN", apiKey: rest };
    case "LOGOUT":
      return { type: "LOGOUT" };
    case "USERINFO":
      return { type: "USERINFO" };
    case "STYLES":
    case "SEARCH":
      if (!rest) return { type: "STYLES", error: "missing query" };
      return { type: "STYLES", query: rest };
    case "HELP":
      return { type: "HELP" };
    default:
      return null;
  }
}

// Returns null if `text` is not an image-request trigger; otherwise
// { prompt, style: string|null, negative: string|null, unknown: [{flag, value}] }
function parseImageRequest(text, botNick) {
  if (!text) return null;
  // Match "AIHorde: " or "AIHorde, " (case-insensitive) at the start.
  const escapedNick = botNick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const triggerRe = new RegExp(`^\\s*${escapedNick}\\s*[:,]\\s*(.+)$`, "i");
  const m = text.match(triggerRe);
  if (!m) return null;
  return parseFlags(m[1]);
}

function parseFlags(tail) {
  const tokens = tokenize(tail);
  const flags = {};
  const unknown = [];
  const promptParts = [];

  for (const tok of tokens) {
    if (tok.kind === "flag") {
      if (KNOWN_FLAGS.has(tok.name)) {
        flags[tok.name] = tok.value;
      } else {
        unknown.push({ flag: tok.name, value: tok.value });
      }
    } else {
      promptParts.push(tok.text);
    }
  }

  const prompt = promptParts.join(" ").trim();
  return {
    prompt,
    style: flags.style ? flags.style.trim() : null,
    negative: flags.negative ? flags.negative.trim() : null,
    unknown,
  };
}

// Tokenize into prompt-text segments and `--flag value` segments.
// Flag values run greedily to the next `--flag` or end of input.
function tokenize(s) {
  const out = [];
  let rest = s.trim();
  while (rest.length > 0) {
    const m = rest.match(FLAG_RE);
    if (!m) {
      out.push({ kind: "text", text: rest.trim() });
      break;
    }
    const before = rest.slice(0, m.index).trim();
    if (before) out.push({ kind: "text", text: before });
    const flagName = m[2].toLowerCase();
    const afterFlagStart = m.index + m[0].length;
    const remainder = rest.slice(afterFlagStart);
    // Find next `--flag` boundary; lookahead-style: match against FLAG_RE again.
    const next = remainder.match(FLAG_RE);
    const value = next
      ? remainder.slice(0, next.index + (next[1] ? 0 : 0)).trim()
      : remainder.trim();
    out.push({ kind: "flag", name: flagName, value });
    rest = next ? remainder.slice(next.index + (next[1] ? 1 : 0)) : "";
  }
  return out.filter((t) => t.kind === "flag" || t.text);
}

module.exports = { parseDmCommand, parseImageRequest, parseFlags };
