// Categorical, reasonably colour-blind-tolerant. Same hues in both themes;
// the light theme darkens them so they survive on a white stage.
const HUES = [
  "#4cc2ff", "#ffb454", "#3fd68b", "#c792ea", "#ff8f6b",
  "#63d9d2", "#e0d264", "#ff7ab6", "#8ea9ff", "#b0d060",
  "#d99a5c", "#7fd0ff",
];
const HUES_LIGHT = [
  "#0a6ebd", "#a5620a", "#0d7a4c", "#7038a8", "#b8451f",
  "#0f7a75", "#7a6a08", "#b02866", "#3f52b5", "#4f7a10",
  "#8a5a12", "#1f6f9e",
];

export const KIND_COLOR = {
  remote:              ["#4cc2ff", "#0a6ebd"],
  contains:            ["#4a5866", "#a9b6c4"],
  part:                ["#63d9d2", "#0f7a75"],
  subdataset:          ["#c792ea", "#7038a8"],
  worktree_of:         ["#ffb454", "#a5620a"],
  fork_of:             ["#7f8fa3", "#95a3b3"],
  shares_history_with: ["#e0d264", "#7a6a08"],
  candidate_same_as:   ["#ff7ab6", "#b02866"],
  same_annex_uuid:     ["#ff5f56", "#c0271c"],
};

export const KIND_LABEL = {
  remote: "remote", contains: "contains (parent)", part: "part of store",
  subdataset: "subdataset", worktree_of: "worktree of", fork_of: "fork of",
  shares_history_with: "shares history", candidate_same_as: "candidate same-as",
  same_annex_uuid: "SAME ANNEX UUID",
};

let light = false;
export function setPaletteTheme(isLight) { light = isLight; }
export function isLight() { return light; }

const cache = new Map();
export function hostColor(id) {
  if (!cache.has(id)) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    cache.set(id, h % HUES.length);
  }
  const i = cache.get(id);
  return light ? HUES_LIGHT[i] : HUES[i];
}
export function kindColor(kind) {
  const p = KIND_COLOR[kind] || ["#7f8fa3", "#7f8fa3"];
  return light ? p[1] : p[0];
}
export const TOK = () => (light
  ? { fg: "#16202b", fg2: "#4a5b6c", fg3: "#7b8b9c", grey: "#97a4b2",
      err: "#c0271c", warn: "#9a6205", ok: "#17794f", accent: "#0a6ebd",
      stage: "#f7f9fb", panel: "#ffffff", line: "#d5dde6",
      hullFill: "rgba(24,86,140,0.055)", hullLine: "rgba(40,90,140,0.34)" }
  : { fg: "#e6edf3", fg2: "#9fb0c3", fg3: "#6b7f95", grey: "#5d6b7a",
      err: "#ff5f56", warn: "#ffb454", ok: "#3fd68b", accent: "#4cc2ff",
      stage: "#0a0e14", panel: "#161d27", line: "#26303d",
      hullFill: "rgba(120,180,235,0.05)", hullLine: "rgba(120,170,220,0.32)" });
