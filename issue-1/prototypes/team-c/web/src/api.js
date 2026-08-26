const BASE = "";   // same origin (python server) or Vite proxy in dev

async function j(url, init) {
  const r = await fetch(BASE + url, init);
  if (!r.ok) throw new Error(url + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

export const listScenarios = () => j("/api/scenarios");
export const getSeed = (id) => j("/api/seed/" + id);
export const getFull = (id) => j("/api/full/" + id);
export const getSynthetic = (n) => j("/api/synthetic?n=" + n);
export const expand = (scenario, node_id, relation, known) =>
  j("/api/expand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, node_id, relation, known }),
  });
