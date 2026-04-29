const axios = require("axios");

class HordeClient {
  constructor(logger, config) {
    this.logger = logger;
    this.baseUrl = config.base_url || "https://aihorde.net/api/v2";
    this.clientAgent = config.client_agent || "AIHorde-IRC:0.1:unknown";
  }

  headers(apiKey) {
    return {
      apikey: apiKey || "0000000000",
      "Client-Agent": this.clientAgent,
      "Content-Type": "application/json",
    };
  }

  async submitGeneration(payload, apiKey) {
    const res = await axios.post(`${this.baseUrl}/generate/async`, payload, {
      headers: this.headers(apiKey),
      timeout: 30000,
    });
    return res.data;
  }

  async checkGeneration(id) {
    const res = await axios.get(`${this.baseUrl}/generate/check/${id}`, {
      timeout: 15000,
    });
    return res.data;
  }

  async getGenerationStatus(id) {
    const res = await axios.get(`${this.baseUrl}/generate/status/${id}`, {
      timeout: 30000,
    });
    return res.data;
  }

  async cancelGeneration(id) {
    try {
      await axios.delete(`${this.baseUrl}/generate/status/${id}`, {
        timeout: 15000,
      });
    } catch (err) {
      this.logger.warn(`Cancel failed for ${id}: ${err.message}`);
    }
  }

  async findUser(apiKey) {
    const res = await axios.get(`${this.baseUrl}/find_user`, {
      headers: this.headers(apiKey),
      timeout: 15000,
    });
    return res.data;
  }
}

module.exports = HordeClient;
