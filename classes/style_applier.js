const { baseRequest, styleCopyParams } = require("./base_request");

// Port of ~/Coding/dreamers-guild/vue_client/src/components/generator/composables/useGeneratorSubmit.js
// lines 62-99 — `{p}` / `{np}` template substitution with `###` separator handling.
function buildPromptWithStyle({ prompt, negativePrompt, style }) {
  const userPrompt = prompt || "";
  const userNeg = negativePrompt || "";

  if (!style || !style.prompt) {
    if (userPrompt && userNeg) {
      return `${userPrompt} ### ${userNeg}`;
    }
    return userPrompt;
  }

  let text = style.prompt.replace(/\{p\}/g, userPrompt);

  if (userNeg === "") {
    text = text.replace(/\{np\},/g, "");
    text = text.replace(/\{np\}/g, "");
  } else if (text.includes("###")) {
    text = text.replace(/\{np\}/g, userNeg);
  } else {
    text = text.replace(/\{np\}/g, ` ### ${userNeg}`);
  }

  return text;
}

// Port of buildRequestParams from useGeneratorSubmit.js lines 204-355,
// trimmed to what we need: prompt, optional style, optional negative.
// When `style` is null/undefined, returns a MINIMAL payload — just the prompt
// and basic worker filters — and lets the horde pick model/sampler/dims.
function buildRequest({ prompt, negativePrompt, style }) {
  const finalPrompt = buildPromptWithStyle({ prompt, negativePrompt, style });

  if (!style) {
    return {
      prompt: finalPrompt,
      r2: true,
      nsfw: true,
      censor_nsfw: true,
      replacement_filter: true,
      trusted_workers: true,
      shared: false,
      slow_workers: false,
    };
  }

  const params = JSON.parse(JSON.stringify(baseRequest));
  params.prompt = finalPrompt;

  for (const key of styleCopyParams) {
    const value = style[key];
    if (
      value !== undefined &&
      value !== null &&
      !(Array.isArray(value) && value.length === 0)
    ) {
      params.params[key] = value;
    }
  }

  if (style.model) {
    params.models = [style.model];
  }

  return params;
}

module.exports = { buildPromptWithStyle, buildRequest };
