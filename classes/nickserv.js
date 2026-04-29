const POSITIVE_TTL_MS = 5 * 60 * 1000;
const WHOIS_TIMEOUT_MS = 5000;

class NickServVerifier {
  constructor(ircClient, logger) {
    this.client = ircClient;
    this.logger = logger;
    this.cache = new Map(); // nick(lowercased) -> { account, expires }
  }

  // Returns NickServ account name for a given nick, or null if unidentified.
  async getAccount(nick) {
    const key = nick.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.account;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (account) => {
        if (settled) return;
        settled = true;
        if (account) {
          this.cache.set(key, {
            account,
            expires: Date.now() + POSITIVE_TTL_MS,
          });
        }
        resolve(account);
      };

      const timer = setTimeout(() => finish(null), WHOIS_TIMEOUT_MS);

      try {
        this.client.whois(nick, (event) => {
          clearTimeout(timer);
          // event.account is set when the user is identified with services
          finish(event && event.account ? event.account : null);
        });
      } catch (err) {
        clearTimeout(timer);
        this.logger.warn(`WHOIS failed for ${nick}: ${err.message}`);
        finish(null);
      }
    });
  }

  invalidate(nick) {
    this.cache.delete(nick.toLowerCase());
  }
}

module.exports = NickServVerifier;
