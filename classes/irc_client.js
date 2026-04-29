const IRC = require("irc-framework");
const { splitMessage } = require("./message_splitter");

// Connect / SASL / channel-join / reconnect-backoff pattern lifted from
// ~/Coding/impostor/classes/impostor_client.js lines 132-175.
class IrcClient {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    this.botNick = config.irc.nick;
    this.maxLineLength = config.irc.max_line_length || 350;
    this.client = new IRC.Client();
    this.shuttingDown = false;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;
    this.privmsgHandler = null;

    this.client.on("registered", () => {
      this.reconnectDelay = 1000;
      this.logger.info(`Connected to IRC as ${this.botNick}`);
      for (const channel of config.irc.channels) {
        this.client.join(channel);
        this.logger.info(`Joining ${channel}`);
      }
    });

    this.client.on("join", (event) => {
      if (event.nick === this.botNick) {
        this.logger.info(`Joined ${event.channel}`);
      }
    });

    this.client.on("privmsg", (event) => {
      if (event.nick.toLowerCase() === this.botNick.toLowerCase()) return;
      const isPrivate = !event.target.startsWith("#");
      if (this.privmsgHandler) {
        this.privmsgHandler({
          nick: event.nick,
          target: event.target,
          message: event.message || "",
          isPrivate,
          channel: isPrivate ? null : event.target,
        });
      }
    });

    this.client.on("nick", (event) => {
      if (event.nick === this.botNick) {
        this.logger.info(`Nick changed from ${this.botNick} to ${event.new_nick}`);
        this.botNick = event.new_nick;
      }
    });

    this.client.on("close", () => {
      this.logger.info("IRC connection closed");
      this._scheduleReconnect();
    });

    this.client.on("irc error", (event) => {
      this.logger.error(`IRC error: ${JSON.stringify(event)}`);
    });
  }

  onPrivmsg(handler) {
    this.privmsgHandler = handler;
  }

  connect() {
    const irc = this.config.irc;
    this.logger.info(
      `Connecting to ${irc.host}:${irc.port || 6697} (TLS: ${irc.tls !== false}) as ${irc.nick}`
    );
    const opts = {
      host: irc.host,
      port: irc.port || 6697,
      tls: irc.tls !== false,
      nick: irc.nick,
      username: irc.username || irc.nick.toLowerCase(),
      gecos: irc.realname || irc.nick,
      auto_reconnect: false,
    };
    if (irc.sasl && irc.password) {
      opts.account = { account: irc.nick, password: irc.password };
      this.logger.info("SASL authentication enabled");
    }
    this.connectOptions = opts;
    this.client.connect(opts);
  }

  _scheduleReconnect() {
    if (this.shuttingDown || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.logger.info(`Reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
      try {
        this.client.connect(this.connectOptions);
      } catch (err) {
        this.logger.error(`Reconnect failed: ${err.message}`);
        this._scheduleReconnect();
      }
    }, delay);
  }

  send(target, text) {
    if (!target || !text) return;
    const lines = splitMessage(text, this.maxLineLength);
    for (const line of lines) {
      this.client.say(target, line);
    }
  }

  whois(nick, cb) {
    return this.client.whois(nick, cb);
  }

  shutdown() {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.client.quit("shutting down");
    } catch (_) {
      // ignore
    }
  }
}

module.exports = IrcClient;
