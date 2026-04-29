const axios = require("axios");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// Mirrors ~/Coding/brad-cdn/index.js lines 130-199 — same S3Client + PutObjectCommand
// shape, just pointed at the AI Horde R2 bucket.
class R2Uploader {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    this.prefix = (config.key_prefix || "").replace(/^\/+|\/+$/g, "");
    if (this.prefix) this.prefix += "/";
    this.publicBase = (config.public_base_url || "").replace(/\/+$/, "");
    this.client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.access_key_id,
        secretAccessKey: config.secret_access_key,
      },
    });
  }

  async upload(sourceUrl, requestId) {
    const downloadRes = await axios.get(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    const buffer = Buffer.from(downloadRes.data);
    const contentType = downloadRes.headers["content-type"] || "image/webp";
    const ext = extFromContentType(contentType);
    const key = `${this.prefix}${requestId}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    return `${this.publicBase}/${key}`;
  }
}

function extFromContentType(ct) {
  if (!ct) return ".webp";
  const lower = ct.toLowerCase();
  if (lower.includes("webp")) return ".webp";
  if (lower.includes("png")) return ".png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return ".jpg";
  return ".bin";
}

module.exports = R2Uploader;
