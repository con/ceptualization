/**
 * Two extra canvases around sigma's stack:
 *   - HULL layer (behind everything): the containment discs. This is what
 *     stands in for compound nodes.
 *   - BADGE layer (in front of everything): group labels, aheadness balloons,
 *     error rings, collapsed-group counts, alias warnings.
 * Both are redrawn from sigma's own `afterRender` event, so they are always
 * in lockstep with the camera.
 */
import { TOK, hostColor } from "./palette.js";

export class Overlay {
  constructor(renderer, container, state) {
    this.r = renderer;
    this.state = state;
    this.hull = mk(container, 0, true);
    this.badge = mk(container, 40, false);
    // keep sigma's own canvases sandwiched between the two
    const cv = renderer.getCanvases();
    let z = 5;
    for (const k of ["edges", "edgeLabels", "nodes", "labels", "hovers", "hoverNodes", "mouse"]) {
      if (cv[k]) cv[k].style.zIndex = String(z++);
    }
    this.t0 = performance.now();
    renderer.on("afterRender", () => this.draw());
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.hull, this.badge]) {
      const w = c.parentElement.clientWidth, h = c.parentElement.clientHeight;
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = w + "px"; c.style.height = h + "px";
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  px(x, y) { return this.r.graphToViewport({ x, y }); }

  draw() {
    if (window.__noOverlay) return;
    const st = this.state, T = TOK();
    const hc = this.hull.getContext("2d"), bc = this.badge.getContext("2d");
    const W = this.hull.parentElement.clientWidth, H = this.hull.parentElement.clientHeight;
    hc.clearRect(0, 0, W, H); bc.clearRect(0, 0, W, H);
    const g = st.graph;
    if (!g.order) return;

    // scale: graph units -> px
    const o = this.px(0, 0), u = this.px(100, 0);
    const scale = Math.abs(u.x - o.x) / 100 || 1;

    // A hull is drawn around what is actually VISIBLE inside it, so collapsing
    // a store shrinks its host's disc instead of leaving a crater. Positions
    // never move; only the drawn radius adapts.
    const memo = new Map();
    const effR = (gr) => {
      if (memo.has(gr.id)) return memo.get(gr.id);
      memo.set(gr.id, gr.r);
      let r = 0;
      for (const m of gr.items) {
        if (!g.hasNode(m)) continue;
        const a = g.getNodeAttributes(m);
        if (a._collapsedInto) continue;
        const sub = st.groups.get(m);
        let mr;
        if (sub && !st.collapsed.has(m)) mr = effR(sub);
        else { const dd = this.r.getNodeDisplayData(m); mr = dd ? dd.size : 9; }
        const d = Math.hypot(a.x - gr.cx, a.y - gr.cy);
        r = Math.max(r, d + mr);
      }
      const out = r > 0 ? Math.min(gr.r, r + 12) : Math.min(gr.r, 22);
      memo.set(gr.id, out);
      return out;
    };

    // ---------------- hull layer ----------------
    const groups = [...st.groups.values()]
      .filter((gr) => !st.collapsed.has(gr.id) && g.hasNode(gr.id))
      .sort((a, b) => (a.depth || 0) - (b.depth || 0));
    if (st.hulls) {
      for (const gr of groups) {
        const c = this.px(gr.cx, gr.cy);
        const R = effR(gr) * scale;
        if (R < 6) continue;
        if (c.x + R < -50 || c.x - R > W + 50 || c.y + R < -50 || c.y - R > H + 50) continue;
        const col = hostColor(gr.id);
        const depth = gr.depth || 0;
        hc.beginPath();
        hc.arc(c.x, c.y, R, 0, Math.PI * 2);
        hc.fillStyle = tint(col, depth === 0 ? 0.085 : 0.14);
        hc.fill();
        hc.lineWidth = depth === 0 ? 1.4 : 1.1;
        hc.setLineDash(depth === 0 ? [] : [5, 4]);
        hc.strokeStyle = tint(col, depth === 0 ? 0.55 : 0.75);
        hc.stroke();
        hc.setLineDash([]);
      }
    }

    // ---------------- badge layer ----------------
    bc.textBaseline = "middle";
    // group labels
    if (st.hulls) {
      for (const gr of groups) {
        const c = this.px(gr.cx, gr.cy);
        const R = effR(gr) * scale;
        if (R < 26) continue;
        if (c.x < -200 || c.x > W + 200 || c.y < -200 || c.y > H + 200) continue;
        const col = hostColor(gr.id);
        const n = gr.members.length;
        const txt = gr.label + "  " + n;
        bc.font = "600 " + Math.min(14, Math.max(10, R / 9)) + "px ui-sans-serif, system-ui, sans-serif";
        const w = bc.measureText(txt).width;
        const y = c.y - R - 9;
        bc.fillStyle = tint(col, 0.16);
        roundRect(bc, c.x - w / 2 - 7, y - 9, w + 14, 18, 9);
        bc.fill();
        bc.strokeStyle = tint(col, 0.5); bc.lineWidth = 1; bc.stroke();
        bc.fillStyle = col;
        bc.textAlign = "center";
        bc.fillText(txt, c.x, y);
      }
    }

    // per-node badges
    const sev = st._sev || new Map();
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin((now - this.t0) / 320);
    const balloons = [];
    g.forEachNode((n, a) => {
      const d = this.r.getNodeDisplayData(n);
      // NOTE: display data x/y are sigma's *framed* (normalised) coordinates.
      // graphToViewport expects RAW graph coordinates, so badges must be
      // positioned from the node attributes, not from the display data.
      if (!d || d.hidden || !Number.isFinite(a.x)) return;
      const p = this.px(a.x, a.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) return;
      const rpx = Math.max(2, d.size * scale);
      const s = sev.get(n);
      if (s === "error") {
        bc.beginPath();
        bc.arc(p.x, p.y, rpx + 5 + pulse * 3.5, 0, Math.PI * 2);
        bc.strokeStyle = T.err; bc.lineWidth = 2; bc.setLineDash([4, 3]);
        bc.stroke(); bc.setLineDash([]);
      } else if (s === "warning") {
        bc.beginPath();
        bc.arc(p.x, p.y, rpx + 4, 0, Math.PI * 2);
        bc.strokeStyle = T.warn; bc.lineWidth = 1.6; bc.setLineDash([3, 3]);
        bc.stroke(); bc.setLineDash([]);
      }
      if (n === st.selected) {
        bc.beginPath();
        bc.arc(p.x, p.y, rpx + 7, 0, Math.PI * 2);
        bc.strokeStyle = T.accent; bc.lineWidth = 2; bc.stroke();
      }
      if (a.is_seed) {
        bc.beginPath();
        bc.arc(p.x, p.y, rpx + 3, 0, Math.PI * 2);
        bc.strokeStyle = T.ok; bc.lineWidth = 1.6; bc.stroke();
      }
      if (a._meta) {
        bc.font = "700 " + Math.min(15, Math.max(9, rpx * 0.62)) + "px ui-sans-serif, system-ui, sans-serif";
        bc.textAlign = "center"; bc.fillStyle = T.stage;
        bc.fillText("x" + a._metaCount, p.x, p.y);
      }
      if (rpx > 4 && (a._ahead > 0 || a._aliasCount > 1)) {
        balloons.push({ n, a, p, rpx });
      }
    });

    // aheadness balloons: LOD-capped, biggest first
    balloons.sort((x, y2) => (y2.a._ahead || 0) - (x.a._ahead || 0));
    const cap = 70;
    for (let i = 0; i < Math.min(cap, balloons.length); i++) {
      const b = balloons[i];
      let txt = null, col = T.ok;
      if (b.a._ahead > 0) txt = "▲" + b.a._ahead;
      if (b.a._aliasCount > 1) {
        txt = (txt ? txt + " " : "") + b.a._aliasCount + " names";
        col = T.warn;
      }
      if (!txt) continue;
      bc.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      const w = bc.measureText(txt).width;
      const x = b.p.x + b.rpx + 4, y = b.p.y - b.rpx - 4;
      bc.fillStyle = T.panel; bc.globalAlpha = 0.92;
      roundRect(bc, x, y - 7, w + 9, 14, 7); bc.fill();
      bc.globalAlpha = 1;
      bc.strokeStyle = col; bc.lineWidth = 1; bc.stroke();
      bc.fillStyle = col; bc.textAlign = "left";
      bc.fillText(txt, x + 4.5, y);
    }
    if (balloons.length > cap) {
      bc.font = "11px ui-sans-serif, system-ui, sans-serif";
      bc.fillStyle = T.fg3; bc.textAlign = "left";
      bc.fillText("+" + (balloons.length - cap) + " more ahead-badges hidden (LOD cap)", 12, H - 16);
    }
  }
}

function mk(container, z, first) {
  const c = document.createElement("canvas");
  c.style.position = "absolute";
  c.style.inset = "0";
  c.style.pointerEvents = "none";
  c.style.zIndex = String(z);
  if (first && container.firstChild) container.insertBefore(c, container.firstChild);
  else container.appendChild(c);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
}
