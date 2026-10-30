# Deploying Digiteq Studio on Railway

One Railway service runs everything: the web app, the API, ffmpeg (logo placement) and the login. Files and the company profile live on a Railway volume so they survive redeploys.

## 1. Create the service

1. Sign in at https://railway.com with GitHub.
2. **New Project → Deploy from GitHub repo →** `infodigiteq00-hue/Video-generator-gemini`.
   Railway finds `railway.json` and builds the `Dockerfile` automatically.

## 2. Add a volume (keeps posts, logos and the company profile)

Service → **Settings → Volumes → Add volume**, mount path **`/data`**.

## 3. Variables

Service → **Variables**, add these. Copy the values from your local `server/.env`; never paste them into chat or commit them.

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini key (best: a new one, then delete the old key) |
| `AUTH_EMAIL` | `info@digiteqsolution.com` |
| `AUTH_PASSWORD_HASH` | copy from `server/.env` |
| `AUTH_SECRET` | copy from `server/.env` |
| `TRUST_PROXY` | `1` |

Optional: `IMAGE_MODEL`, `VIDEO_MODEL`, `TEXT_MODEL`, `MCP_TOKEN` (for the ChatGPT app), `PUBLIC_URL` (your final https address).
`PORT` and `DATA_DIR` are set automatically (Railway and the Dockerfile).

## 4. Get the address

Service → **Settings → Networking → Generate Domain**. You get something like `https://digiteq-studio.up.railway.app`.
Open it, sign in, and set up the company profile once (the volume starts empty).

Optional: **Custom Domain** (e.g. `studio.digiteq.com`) in the same place, then add the CNAME it shows at your DNS provider.

## 5. Point the Android app at it

In `mobile/capacitor.config.json` set `"url"` to the Railway https address and remove `"cleartext"`, then rebuild:

```bash
cd mobile && npm run apk
```

## Updating

Every push to `main` on GitHub redeploys automatically. Data on the volume is kept.
