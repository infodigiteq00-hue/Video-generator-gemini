# Digiteq Studio

A browser-based studio that makes festival posts and videos for a business: pick a festival, press Generate.

| Stage | Status |
|---|---|
| Image generation (Google Nano Banana 2) | **Live** |
| Video generation (Google Gemini Omni Flash) | **Live** |
| Edit in Figma / Canva | Coming soon |
| Full editor | Coming soon |

## Run it

```bash
npm run setup                          # install everything (first time only)
cp server/.env.example server/.env     # then paste your GEMINI_API_KEY (one key covers images and video)
npm run dev                            # http://localhost:5180
```

To run it as one URL (production style):

```bash
npm run build && npm start             # http://localhost:8787
```

Without an API key the app runs in **Demo mode**. It renders placeholder clips locally with ffmpeg, so rehearsing costs nothing.

## Use it inside ChatGPT (MCP app)

The same server exposes an MCP endpoint, so the video tool also runs inside chatgpt.com. ChatGPT makes the image with its own image model, our tool animates it, and the clip plays in an inline player.

1. In `server/.env`, set `MCP_TOKEN` to a long random string (`openssl rand -hex 16`).
2. `npm run build && npm start`, then in a second terminal run `npm run tunnel`. Copy the `https://….trycloudflare.com` URL it prints.
3. In ChatGPT, turn on **Developer mode** (in Settings → Apps; needs Plus/Pro), then open **New Plugin → Create MCP App**:
   - Server URL: `https://<tunnel-host>/mcp/<MCP_TOKEN>`
   - Authentication: **No authentication**
4. In a chat, enable the app and try: *"Generate an image of a koi fish in a neon night market, then animate it into a video."*

Tools: `generate_video` (prompt, optional image, aspect ratio, resolution, duration) and `get_video_status`.
The quick tunnel URL changes every time it starts, so update the app URL in ChatGPT when it does.
For a permanent setup, host the server (Render, Railway, a VPS) and set `PUBLIC_URL`.

Known limitation: OpenAI developers report that images ChatGPT *generates* aren't always handed to app tools. Images the user *uploads* are. If the image doesn't come through, ChatGPT falls back to text-to-video.

## How it works (the product)

1. **Welcome screen (once), four steps:**
   1. **What the business does** (with quick-pick chips) and optionally the website. The server reads the website (homepage + About/Products/Services pages, CSS colours and fonts, a few photos; public addresses only, honest `DigiteqStudioBot` user agent) and Gemini turns it into a company profile (products, audience, tone, visual style) used in every brief (`server/src/website.js`).
   2. **Products or services to feature** (up to 10). Each post is built around one of them; the brief writer picks the best fit for the occasion and rotates away from the ones used in recent posts.
   3. **Business name and logo.** Gemini reads the logo's colours and style (`server/src/brand.js`).
   4. **Contact details** (optional: phone, email, website, address). Downloaded videos end with a 3-second closing card (logo, name, contact details) drawn by ffmpeg, so numbers are always exact (`addEndCard` in `server/src/brand.js`).
   The brand is remembered in this browser and can be edited from the sidebar.
2. **Home screen:** the nearest big festival is suggested from the calendar (`web/src/festivals.ts`; Indian festivals for devices on India time, worldwide ones for everyone). The user can pick another from the dropdown and presses **Generate**. Every post is a 9:16 image plus an 8 second video. Lunar festival dates are listed per year: add the next year's dates before the list runs out.
3. **Wait screen:** shows the steps (idea, post, video) and a timer while it works. No chat.
4. Gemini writes the full creative brief from the business details, featured products and festival. Nano Banana 2 makes the image, leaving the top-right corner clear; Gemini Omni then animates the logo-free image.
   **Variety:** every new post gets a different art style (12 rotating directions in `STYLES`, `server/src/brand.js`) and the AI is told which concepts it already made for that occasion so it never repeats one. **Video** prompts are written as an editor's timed shot list (hook, two build shots with transitions, final hero shot with the greeting, music cut to the beats), timed to the chosen length.
5. **Result:** the image appears first, then the video. The client places their logo on each (ffmpeg stamps the real logo) and downloads. Videos download with the contact card appended (`GET /api/jobs/:id/download`).

Cost: about $0.10 per image post (2K) and $0.50 per video post (image + 8 s video).

## Cost

Nano Banana 2: about **$0.067 per image** (switch `IMAGE_MODEL` to `gemini-3.1-flash-lite-image` for Nano Banana 2 Lite at ~$0.034).

Gemini Omni Flash bills about **$0.10 per second** of video (720p): 4 s ≈ $0.40, 6 s ≈ $0.60, 8 s ≈ $0.80. Omni has no length setting, so the length is requested in the prompt.

## Structure

```
server/   Express API. Keeps the API key server-side, runs jobs, stores videos in server/data/
  src/jobs.js             Job validation, storage and worker (shared by web + ChatGPT)
  src/brand.js            Brand kits: logo reading, brief writing, logo stamping
  src/providers/omni.js   Gemini Omni Flash video (Interactions API, synchronous)
  src/providers/image.js  Nano Banana 2 images + demo-mode images
  src/providers/mock.js   Demo mode videos (ffmpeg)
  src/providers/http.js   Retries for network drops and busy (429/503) responses
  src/mcp.js              ChatGPT app: MCP tools + inline player (src/widget.html)
web/      React + Vite + Tailwind UI
docs/API.md  API contract between web and server
```

To add a provider (for example Gemini Omni Flash or the Vertex AI GA Veo models), add a file in `server/src/providers/` with the same `start / poll / download` shape and register it in `PROVIDERS` in `server/src/jobs.js`.

Veo 3.1 Lite preview was shut down by Google on 22 Oct 2026; video moved to Gemini Omni Flash.

## Live

https://digiteq-studio-production.up.railway.app (Railway, see `DEPLOY.md`). Every push to `main` redeploys.

## Android app (APK)

`mobile/` is a Capacitor wrapper that opens the Digiteq Studio server inside a native Android app (own icon, splash screen, no pull-to-refresh, downloads saved to the phone's Downloads folder).

- The server address is `server.url` in `mobile/capacitor.config.json` (the live Railway address).
- Rebuild: `cd mobile && npm run apk` (needs the Android SDK at `~/Android/Sdk` and JDK 21). Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
- This is a debug build for testing. The Play Store needs a signed release build (AAB).

## Login

One account, no sign-up (`server/src/auth.js`). Set in `server/.env`: `AUTH_EMAIL`, `AUTH_PASSWORD_HASH` (scrypt `salt:hash`, never the plain password) and `AUTH_SECRET` (signs the session cookie). Sessions last 30 days in an HttpOnly cookie; 10 wrong tries per 15 minutes locks out that address for a while. All `/api` routes need a session except login itself and `GET /api/jobs/:id` (used by the ChatGPT player). Generated files under `/media` are reachable by their unguessable names.

The Gemini key lives only in `server/.env` (file mode 600, git-ignored) and is used only by the server; it is never sent to the browser or the Android app.
