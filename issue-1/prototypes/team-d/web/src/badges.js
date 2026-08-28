/**
 * Node badges — the at-a-glance indicator strip.
 *
 * Spec: issue-1/node-badges-and-relation-details.md
 *
 * Design constraint that shapes everything here: node text renders at ~6.8 px
 * at fit zoom, so a badge made of words is unreadable exactly when it is most
 * useful. Badges are therefore a glyph plus a colour, with the text tail only
 * appearing once the zoom makes it legible.
 */

export const GROUPS = {
  health: { label: 'health', on: true },
  policy: { label: 'annex policy', on: true },
  storage: { label: 'storage', on: false },
  topology: { label: 'topology', on: true },
  form: { label: 'form', on: false },
};

const PRIORITY = ['health', 'policy', 'storage', 'topology', 'form'];
const MAX = 4;

export function humanBytes(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return null;
  const u = ['B', 'K', 'M', 'G', 'T', 'P'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + u[i];
}

/**
 * @param n     node record
 * @param ctx   { findingsFor:Set, walked:Set, collapsedHidden:number,
 *                ignoredByAll:boolean }
 * @returns [{group, glyph, text, tone, title}]
 */
export function badgesFor(n, ctx = {}) {
  const out = [];
  const rc = n.rel_counts || {};

  // health -------------------------------------------------------------
  if (ctx.severity === 'error') out.push({ group: 'health', glyph: '!', tone: 'error', title: 'error finding on this node' });
  else if (ctx.severity === 'warning') out.push({ group: 'health', glyph: '⚠', tone: 'warn', title: 'warning finding on this node' });
  if (n.probed === false && n.type === 'distribution') {
    out.push({ group: 'health', glyph: '?', tone: 'muted', title: 'never probed — known only by reference' });
  }
  if (n.unreachable) out.push({ group: 'health', glyph: '⨯', tone: 'error', title: 'did not answer' });

  // annex policy -------------------------------------------------------
  if (ctx.ignoredByAll) {
    out.push({ group: 'policy', glyph: '⊘*', tone: 'warn',
      title: 'annex-ignore’d by every clone that knows it — no route to content here' });
  } else if (n.annex_ignored_by) {
    out.push({ group: 'policy', glyph: '⊘', tone: 'muted',
      title: `annex-ignore’d by ${n.annex_ignored_by} clone(s)` });
  }
  if (n.annex_incapable_assumed) {
    out.push({ group: 'policy', glyph: '⊘?', tone: 'muted',
      title: 'assumed unable to carry annexed content (forge default, not observed)' });
  }
  if (n.trust === 'dead') out.push({ group: 'policy', glyph: '†', tone: 'error', title: 'marked dead in trust.log' });
  else if (n.trust === 'untrusted') out.push({ group: 'policy', glyph: '↓', tone: 'warn', title: 'untrusted' });

  // storage ------------------------------------------------------------
  const b = humanBytes(n.annex_bytes);
  if (b) out.push({ group: 'storage', glyph: b, tone: 'info', text: '', title: 'annexed data held here (believed)' });
  else if (n.annex_mode && n.annex_mode !== 'none' && n.annex_bytes === 0) {
    out.push({ group: 'storage', glyph: '∅', tone: 'muted', title: 'annexed repo holding no content' });
  }

  // topology -----------------------------------------------------------
  let out_n = 0; let in_n = 0;
  for (const [k, v] of Object.entries(rc)) {
    const [rel, dir] = k.split(':');
    if (rel === 'contains') continue;
    if (rel.includes('@')) continue;        // scoped counts are subsets of their kind
    if (ctx.walked && ctx.walked.has(k)) continue;
    if (dir === 'out') out_n += v; else in_n += v;
  }
  // The remotes actually in use, called out separately: on a busy checkout
  // most remotes are configuration nobody touches, and lumping them into one
  // arrow count makes the useful ones unfindable.
  const cur = rc['remote@current:out'] || 0;
  const trk = rc['remote@tracked:out'] || 0;
  if (cur) {
    out.push({ group: 'topology', glyph: `⇄${cur}`, tone: 'good',
      title: `${cur} remote(s) tracked by the checked-out branch` });
  } else if (trk) {
    out.push({ group: 'topology', glyph: `⇄${trk}`, tone: 'info',
      title: `${trk} tracked remote(s), none on the current branch` });
  }
  if (out_n) out.push({ group: 'topology', glyph: `↗${out_n}`, tone: 'info', title: `${out_n} outgoing relation(s) not yet walked` });
  if (in_n) out.push({ group: 'topology', glyph: `↙${in_n}`, tone: 'info', title: `${in_n} incoming relation(s) not yet walked` });
  if (ctx.collapsedHidden) out.push({ group: 'topology', glyph: `⊙${ctx.collapsedHidden}`, tone: 'muted', title: 'children hidden by collapse' });

  // form ---------------------------------------------------------------
  const FORM = { bare: 'B', worktree: 'W', 'linked-worktree': 'L', 'ria-store': 'R', 'export-tree': 'E', archive: 'A', bundle: 'U' };
  if (FORM[n.layout]) out.push({ group: 'form', glyph: FORM[n.layout], tone: 'muted', title: n.layout });
  if (n.special_remote_type) out.push({ group: 'form', glyph: n.special_remote_type.slice(0, 3), tone: 'muted', title: `special remote: ${n.special_remote_type}` });

  return out;
}

/** Apply the group toggles, priority order and the overflow cap. */
export function visibleBadges(all, enabled) {
  const kept = all.filter((x) => enabled[x.group]);
  kept.sort((a, b) => PRIORITY.indexOf(a.group) - PRIORITY.indexOf(b.group));
  if (kept.length <= MAX) return kept;
  return kept.slice(0, MAX).concat([{
    group: 'more', glyph: `+${kept.length - MAX}`, tone: 'muted',
    title: kept.slice(MAX).map((x) => x.title).join('\n'),
  }]);
}
