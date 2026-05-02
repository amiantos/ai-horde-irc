const axios = require("axios");

const CATBOX_API = "https://catbox.moe/user/api.php";

// urlupload was the obvious choice but catbox 412s on presigned R2 URLs
// (the horde hands out auth-in-query-string links to its own R2 bucket,
// and catbox blocks raw S3/R2 hosts as a hotlink-abuse measure). So we
// download the bytes and POST them as a regular fileupload instead.
class CatboxUploader {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config || {};
    this.userhash = this.config.userhash || "";
  }

  async upload(sourceUrl, requestId) {
    const downloadRes = await axios.get(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    const buffer = Buffer.from(downloadRes.data);
    const contentType = downloadRes.headers["content-type"] || "image/webp";
    const filename = `${requestId}${extFromContentType(contentType)}`;

    const form = new FormData();
    form.append("reqtype", "fileupload");
    if (this.userhash) form.append("userhash", this.userhash);
    form.append(
      "fileToUpload",
      new Blob([buffer], { type: contentType }),
      filename
    );

    const res = await axios.post(CATBOX_API, form, { timeout: 60000 });
    const body = String(res.data || "").trim();
    if (!/^https?:\/\//i.test(body)) {
      throw new Error(`catbox unexpected response: ${body.slice(0, 200)}`);
    }
    return body;
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

module.exports = CatboxUploader;
