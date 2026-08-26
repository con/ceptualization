const BASE = '/api';

async function jget(url) {
  const r = await fetch(BASE + url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export const api = {
  scenarios: () => jget('/scenarios'),
  seed: (id) => jget(`/scenario/${id}/seed`),
  full: (id) => jget(`/scenario/${id}/full`),
  async expand({ scenario, node_id, relation, known_nodes, known_edges }) {
    const r = await fetch(`${BASE}/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, node_id, relation, known_nodes, known_edges })
    });
    if (!r.ok) throw new Error(`expand -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
};
