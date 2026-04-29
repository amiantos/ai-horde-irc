// Mirrors ~/Coding/dreamers-guild/vue_client/src/config/baseRequest.js
// Used as the foundation when a user requests an image WITH a style.
// For styleless requests we send a much smaller payload (see style_applier.js).
const baseRequest = {
  models: ["stable_diffusion"],
  prompt: "",
  censor_nsfw: true,
  shared: false,
  replacement_filter: true,
  dry_run: false,
  r2: true,
  nsfw: true,
  trusted_workers: true,
  slow_workers: false,
  params: {
    steps: 30,
    cfg_scale: 7.5,
    sampler_name: "k_euler",
    n: 1,
    width: 512,
    height: 512,
    post_processing: [],
    karras: false,
    tiling: false,
    hires_fix: false,
    hires_fix_denoising_strength: 0.5,
    clip_skip: 1,
  },
};

const styleCopyParams = [
  "steps",
  "width",
  "height",
  "cfg_scale",
  "clip_skip",
  "hires_fix",
  "hires_fix_denoising_strength",
  "karras",
  "sampler_name",
  "loras",
  "tis",
];

module.exports = { baseRequest, styleCopyParams };
