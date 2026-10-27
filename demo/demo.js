import { sharps } from "../dist/index.js";

const params = new URLSearchParams(location.search);
const tour = params.get("tour");
if (tour) document.documentElement.dataset.tour = tour;

// ?api=/pm sends every read through a same-origin proxy that serves /pm/data and /pm/gamma, for networks where
// Polymarket can't be reached directly. Only a path on this site is accepted.
const api = params.get("api");
const base = api && /^\/(?!\/)[\w/-]*$/.test(api) ? api.replace(/\/$/, "") : null;

const KEYS = { view: "view", window: "window", category: "category", wallet: "wallet", flowSort: "sort", minUsd: "min", sharpsOnly: "only" };
const DEFAULTS = { view: "flow", window: "month", category: "overall", wallet: null, flowSort: "wallets", minUsd: 10000, sharpsOnly: false };

function read() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const state = {};
  for (const [key, name] of Object.entries(KEYS)) {
    const value = hash.get(name);
    if (value === null) continue;
    state[key] = key === "minUsd" ? Number(value) : key === "sharpsOnly" ? value === "1" : value;
  }
  return state;
}

function write(state) {
  const hash = new URLSearchParams();
  for (const [key, name] of Object.entries(KEYS)) {
    const value = state[key];
    if (value === DEFAULTS[key] || value === null) continue;
    hash.set(name, key === "sharpsOnly" ? "1" : String(value));
  }
  const text = hash.toString();
  if (text !== location.hash.slice(1)) history.replaceState(null, "", text ? `#${text}` : location.pathname + location.search);
}

// The recording tour replays reads saved from the live API (demo/sample), so every loop shows the same thing.
async function recorded() {
  const response = await fetch("sample/recorded.json.gz");
  const { responses } = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
  return async (url) => {
    const { pathname, search } = new URL(url);
    const body = responses[pathname + search];
    return new Response(JSON.stringify(body ?? { error: "not in the recording" }), { status: body ? 200 : 404, headers: { "content-type": "application/json" } });
  };
}

const app = sharps(document.querySelector("[data-app]"), {
  data: base ? `${base}/data` : undefined,
  gamma: base ? `${base}/gamma` : undefined,
  fetch: tour ? await recorded() : undefined,
  depth: tour ? 30 : undefined,
  state: tour ? {} : read(),
  onStateChange: tour ? undefined : write,
});

if (tour) import("./tour.js").then(({ run }) => run(tour, app));
else addEventListener("hashchange", () => app.setState({ ...DEFAULTS, ...read() }));
