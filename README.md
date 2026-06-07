# 🤖 chatgpt-visibility-checker

**Ask ChatGPT — live — whether it knows your brand exists.**

ChatGPT is where your buyers now ask *"what's the best tool for X?"*. It names a
few brands and (when it searches) cites a few pages. If you're not in that
answer, you're invisible at the exact moment of decision.

Type your brand and a buyer question. This tool runs your question through
ChatGPT live (via Bright Data's ChatGPT dataset), then tells you whether you were:

- **Named** in the answer,
- **Cited** as a source (and at what rank), or
- **Invisible** — with the list of competitor pages ChatGPT leaned on instead.

> Part of a 3-tool series on AI brand visibility. See also the
> [Perplexity checker](https://github.com/yaronbeen/bright-data-perplexity-visibility-checker)
> and the combined [invisible-to-ai](https://github.com/yaronbeen/bright-data-invisible-to-ai).
>
> Inspired by *["My SaaS Was Invisible to ChatGPT"](https://medium.com/@yaron.been/my-saas-was-invisible-to-chatgpt-i-built-a-scraping-pipeline-to-fix-it-4703bbed2345)*.

---

## How it works

```
Browser ──► Cloudflare Worker (same-origin proxy) ──► Bright Data ChatGPT scraper
   ▲                                                          │
   └──────────  answer + citations + verdict  ◄───────────────┘
```

1. You enter a **brand**, a **buyer question**, and **your own Bright Data token**.
2. The Worker triggers the ChatGPT scraper (`gd_m7aof0k82r803d5bjm`) with web
   search on via the asynchronous `/datasets/v3/trigger` endpoint, which returns
   a `snapshot_id` immediately (no held-open connection, so no edge timeouts).
   The page then polls `/api/status` until the job is ready and fetches the
   record from `/api/result` (typically ~60–90s total).
3. It renders the answer, the sources ChatGPT actually cited, and a result.
4. Export as Markdown, JSON, or CSV.

| Engine | Dataset ID | Key inputs |
| --- | --- | --- |
| ChatGPT | `gd_m7aof0k82r803d5bjm` | `url, prompt, country, web_search, additional_prompt` |

> **Note on citations:** ChatGPT only returns live citations when it actually
> triggers a web search. The tool defaults `web_search` on (a checkbox you can
> turn off), but the model still decides. When it answers from memory, you'll
> still get the all-important *"named / not named"* signal.

---

## Bring Your Own Key (BYOK) — zero secrets

**There is no API token in this repo or in the deployed Worker.** Each visitor
pastes their **own** Bright Data token; it's forwarded per request to Bright Data
and **not stored anywhere** — the Worker keeps no database, doesn't log the token,
and the page does not save it in your browser (no `localStorage`, no cookies).
Your key, your credits — each check uses about **US$0.0015 per record** of **your
own** Bright Data pay-as-you-go balance, and the `/api/*` endpoints are
rate-limited per IP. (A proxy is needed only because Bright Data's API doesn't
send CORS headers, so a browser can't call it directly.)

Create a Bright Data account at [brightdata.com](https://brightdata.com); the API
token lives in your account settings under *API keys*.

---

## Run it yourself

```bash
npm install
npm run dev        # http://localhost:8787
npm run deploy     # deploy to your Cloudflare account
```

No secrets to configure. Click **"See a real sample"** to view a real result for
*ROASPIG* without using a token.

### Raw API example

The app uses the **asynchronous** flow: trigger a job, get a `snapshot_id` back
immediately, poll progress, then download the snapshot.

```bash
# 1. trigger — returns { "snapshot_id": "sd_..." }
curl -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"input":[{"url":"https://chatgpt.com/","prompt":"best AI tools for Meta media buying","country":"","web_search":true,"additional_prompt":""}]}' \
  "https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m7aof0k82r803d5bjm&notify=false&include_errors=true"

# 2. poll until status is "ready"
curl -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN" "https://api.brightdata.com/datasets/v3/progress/sd_..."

# 3. download the record
curl -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN" "https://api.brightdata.com/datasets/v3/snapshot/sd_...?format=json"
```

---

## Tests

The pure logic (brand matching, citation parsing, CSV/HTML escaping) lives in
`public/lib.js`, which the page imports as a module **and** the tests import
directly — so the suite exercises the exact code that ships. The Worker is tested
by driving its `fetch` handler with mock requests and a stubbed `fetch`/`env`
(no network, no token needed).

```bash
npm test        # node --test — zero dependencies
```

CI runs the same command on every push and pull request
(`.github/workflows/ci.yml`).

---

## Structure

```
chatgpt-visibility-checker/
├── public/
│   ├── index.html     # the front-end (neo-brutalist, vanilla JS module)
│   ├── lib.js         # pure helpers — shared by the page AND the tests
│   └── sample.json    # a real sample result for the no-key demo
├── src/
│   └── worker.js      # stateless BYOK proxy
├── test/
│   ├── lib.test.js    # unit tests for the helpers
│   └── worker.test.js # integration tests for the Worker
├── .github/workflows/ci.yml
├── wrangler.jsonc
└── package.json
```

---

Built with love by **[Yaron · nofluff.online](https://nofluff.online)** · powered by **Bright Data**. MIT licensed.
