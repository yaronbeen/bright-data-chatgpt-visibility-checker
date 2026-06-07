/**
 * chatgpt-visibility-checker — Cloudflare Worker
 * ----------------------------------------------------------------------------
 * A thin, stateless proxy in front of Bright Data's "ChatGPT Search" scraper
 * (dataset gd_m7aof0k82r803d5bjm).
 *
 * Why a proxy? Bright Data's API sends no CORS headers, so a browser can't call
 * it directly. This Worker forwards the request server-side, on the same origin.
 *
 * Bring Your Own Key (BYOK): the visitor pastes THEIR OWN Bright Data token in
 * the UI. It is sent as `Authorization: Bearer <token>`, forwarded to Bright
 * Data, and never persisted by this Worker (no KV, no logging of the token).
 * The Worker forwards only the Authorization header it receives.
 *
 * Abuse protection: POST /api/check is rate-limited per client IP via a
 * Cloudflare rate-limiting binding (CHECK_RL).
 */

const DATASET_ID = "gd_m7aof0k82r803d5bjm"; // ChatGPT Search - search by prompt
const BD_BASE = "https://api.brightdata.com";
const scrapeUrl = (id) =>
  `${BD_BASE}/datasets/v3/scrape?dataset_id=${id}&notify=false&include_errors=true`;
const progressUrl = (sid) => `${BD_BASE}/datasets/v3/progress/${sid}`;
const snapshotUrl = (sid) => `${BD_BASE}/datasets/v3/snapshot/${sid}?format=json`;
const SNAPSHOT_RE = /^s[dn]_[a-z0-9]+$/i;

const corsHeaders = (extra = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Max-Age": "86400",
  ...extra,
});

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(), ...extra },
  });

function getToken(request) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : "";
  return token.length >= 8 ? token : null;
}

function humanError(data, text, status) {
  if (status === 401 || /token expired|unauthorized/i.test(text))
    return "Your Bright Data token was rejected (expired or invalid). Check it and try again.";
  if (data && typeof data.error === "string") return data.error;
  if (Array.isArray(data?.errors) && data.errors.length)
    return data.errors.map((e) => (Array.isArray(e) ? e.join(": ") : String(e))).join("; ");
  return text?.slice(0, 300) || `Bright Data error (HTTP ${status}).`;
}

// Returns true when the request should be blocked. Fails open if the binding
// is unavailable (e.g. local dev) so the tool still works.
async function rl(env, request, binding) {
  try {
    const b = env && env[binding];
    if (b && typeof b.limit === "function") {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      const { success } = await b.limit({ key: ip });
      return !success;
    }
  } catch {
    /* fail open */
  }
  return false;
}

function looksLikeRecord(rec) {
  return !!rec && typeof rec === "object" && !Array.isArray(rec) &&
    ("answer_text" in rec || "answer" in rec || "answer_text_markdown" in rec ||
     "citations" in rec || "sources" in rec || "search_sources" in rec);
}

async function handleCheck(request, env) {
  const token = getToken(request);
  if (!token) return json({ error: "Missing Bright Data API token." }, 401);

  if (await rl(env, request, "CHECK_RL")) {
    return json(
      { error: "Too many checks from your network. Please wait a minute and try again." },
      429,
      { "Retry-After": "60" }
    );
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }

  const prompt = String(body.prompt || "").trim();
  const brand = String(body.brand || "").trim();
  const webSearch = body.web_search !== false; // default on

  if (!prompt) return json({ error: "Please enter a buyer question to ask ChatGPT." }, 400);
  if (prompt.length > 500) return json({ error: "Question is too long (max 500 characters)." }, 400);
  if (brand.length > 120) return json({ error: "Brand name is too long." }, 400);

  // ChatGPT scraper rejects an explicit country -> always send empty.
  const input = { url: "https://chatgpt.com/", prompt, country: "", web_search: webSearch, additional_prompt: "" };

  // Sync-first: /scrape returns the data directly for fast jobs, or a 202 +
  // snapshot_id for long jobs (ChatGPT usually exceeds the threshold) which the
  // client then polls.
  try {
    const r = await fetch(scrapeUrl(DATASET_ID), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: [input] }),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // Long-running job: either a 202, or a 200 that returns a {snapshot_id} wrapper.
    const snapId = (data && !Array.isArray(data) && data.snapshot_id) || null;
    if ((r.status === 202 || (r.ok && snapId && !looksLikeRecord(data))) && snapId) {
      return json({ ok: true, brand, prompt, done: false, snapshot_id: snapId });
    }
    if (!r.ok) return json({ error: humanError(data, text, r.status) }, r.status);

    const record = Array.isArray(data) ? data[0] : data;
    if (!looksLikeRecord(record)) {
      return json({ error: "Bright Data returned an unexpected response. Please try again." }, 502);
    }
    return json({ ok: true, brand, prompt, done: true, record });
  } catch (e) {
    return json({ error: e?.message || "Failed to reach Bright Data." }, 502);
  }
}

async function passthrough(request, url, kind, env) {
  const token = getToken(request);
  if (!token) return json({ error: "Missing Bright Data API token." }, 401);
  if (await rl(env, request, "POLL_RL")) return json({ error: "Too many requests — please slow down." }, 429, { "Retry-After": "30" });
  const id = url.searchParams.get("id") || "";
  if (!SNAPSHOT_RE.test(id)) return json({ error: "Invalid snapshot id." }, 400);
  const target = kind === "status" ? progressUrl(id) : snapshotUrl(id);
  try {
    const r = await fetch(target, { headers: { Authorization: `Bearer ${token}` } });
    const text = await r.text();
    if (kind === "status") {
      let data; try { data = JSON.parse(text); } catch { data = { status: "unknown", raw: text }; }
      return json(data, r.ok ? 200 : r.status);
    }
    return new Response(text, {
      status: r.ok ? 200 : r.status,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
    });
  } catch (e) {
    return json({ error: e?.message || "Upstream request failed.", status: "unknown" }, kind === "status" ? 200 : 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/"))
      return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/check" && request.method === "POST") return handleCheck(request, env);
    if (url.pathname === "/api/status" && request.method === "GET") return passthrough(request, url, "status", env);
    if (url.pathname === "/api/result" && request.method === "GET") return passthrough(request, url, "result", env);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
