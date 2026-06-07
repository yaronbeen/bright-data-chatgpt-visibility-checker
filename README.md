# 🤖 chatgpt-visibility-checker

**Ask ChatGPT — live — whether it knows your brand exists.**

ChatGPT is where your buyers now ask *"what's the best tool for X?"*. It names a
few brands and (when it searches) cites a few pages. If you're not in that
answer, you're invisible at the exact moment of decision.

Type your brand and a buyer question. This tool runs a **real, live ChatGPT
session** (via Bright Data's ChatGPT scraper), then tells you whether you were:

- **Named** in the answer,
- **Cited** as a source (and at what rank), or
- **Invisible** — with the list of competitor pages ChatGPT leaned on instead.

> Part of a 3-tool series on AI brand visibility. See also the
> [Perplexity checker](https://github.com/yaronbeen/perplexity-visibility-checker)
> and the combined [invisible-to-ai](https://github.com/yaronbeen/invisible-to-ai).
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
2. The Worker calls the ChatGPT scraper (`gd_m7aof0k82r803d5bjm`) with web search
   on, via the synchronous `/scrape` endpoint. Fast runs return the result inline;
   long ones return a snapshot ID the page then polls (~60–90s total).
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

> This is an independent project — not affiliated with or endorsed by Bright Data,
> OpenAI, or Perplexity.

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

The app calls the **synchronous** `/scrape` endpoint. Fast jobs return the record
inline; long ChatGPT jobs return a `snapshot_id` to poll.

```bash
# synchronous: returns the record, or { "snapshot_id": "sd_..." } when it runs long
curl -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"input":[{"url":"https://chatgpt.com/","prompt":"best AI tools for Meta media buying","country":"","web_search":true,"additional_prompt":""}]}' \
  "https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_m7aof0k82r803d5bjm&notify=false&include_errors=true"

# if you got a snapshot_id, poll then download:
curl -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN" "https://api.brightdata.com/datasets/v3/progress/sd_..."
curl -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN" "https://api.brightdata.com/datasets/v3/snapshot/sd_...?format=json"
```

---

## Structure

```
chatgpt-visibility-checker/
├── public/
│   ├── index.html     # the whole front-end (neo-brutalist, vanilla JS)
│   └── sample.json    # a real sample result for the no-key demo
├── src/
│   └── worker.js      # stateless BYOK proxy
├── wrangler.jsonc
└── package.json
```

---

Built with love by **[Yaron · nofluff.online](https://nofluff.online)** · powered by **Bright Data**. MIT licensed.
