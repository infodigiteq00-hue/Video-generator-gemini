# Digiteq Studio

A browser-based creative studio with a chat layout. Ask for an image or a video; say "animate it" to turn an image into a video.

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

1. **Welcome screen (once):** business name, logo, what the business does, and optionally the website. The server reads the website (homepage + About/Products/Services pages, CSS colours and fonts, a few photos; public addresses only, honest `DigiteqStudioBot` user agent) and Gemini turns it into a company profile (products, audience, tone, visual style) used in every brief (`server/src/website.js`). Gemini reads the logo's colours and style (`server/src/brand.js`). The brand is remembered in this browser.
2. **The user types only a festival or occasion**, e.g. "Diwali" or "Dussehra" (or taps one of the festival chips).
3. The app asks **"Image or video?"** (skipped if they typed "Diwali video").
4. Gemini writes the full creative brief from the business details + festival. Nano Banana 2 makes the image, leaving the top-right corner clear, and ffmpeg stamps the **real logo** there. For video, Veo then animates the logo-free image and the logo is stamped on the video too.
   **Variety:** every new post gets a different art style (12 rotating directions in `STYLES`, `server/src/brand.js`) and the AI is told which concepts it already made for that occasion so it never repeats one. **Video** prompts are written as an editor's timed shot list (hook, two build shots with transitions, final hero shot with the greeting, music cut to the beats), timed to the chosen length.
5. When it's done the app asks **"Want any changes?"**: brighter colours, a different design, change the text, make it a video, something else (free text), or looks perfect. Changes use the previous image as the starting point.

Cost: about $0.10 per image post (2K) and $0.50 per video post (image + 8 s video).

## How the chat decides what to make

`web/src/intent.ts`: video words ("video", "animate", "clip", "film"…) make a video, image words ("image", "picture", "photo", "visual", "poster"…) make an image. An attached image with no other hint is animated. "Animate it" or "make it darker" refers to the last image in the chat. If it can't tell, it asks. The Auto / Image / Video switch in the composer overrides it.

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

## Android app (APK)

`mobile/` is a Capacitor wrapper that opens the Digiteq Studio server inside a native Android app (own icon, splash screen, no pull-to-refresh, downloads saved to the phone's Downloads folder).

- The server address is `server.url` in `mobile/capacitor.config.json` (currently the laptop on Wi-Fi, `http://192.168.0.112:8787`). Change it to your hosted https address before giving the app to clients.
- Rebuild: `cd mobile && npm run apk` (needs the Android SDK at `~/Android/Sdk` and JDK 21). Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
- This is a debug build for testing. The Play Store needs a signed release build (AAB).

## Login

One account, no sign-up (`server/src/auth.js`). Set in `server/.env`: `AUTH_EMAIL`, `AUTH_PASSWORD_HASH` (scrypt `salt:hash`, never the plain password) and `AUTH_SECRET` (signs the session cookie). Sessions last 30 days in an HttpOnly cookie; 10 wrong tries per 15 minutes locks out that address for a while. All `/api` routes need a session except login itself and `GET /api/jobs/:id` (used by the ChatGPT player). Generated files under `/media` are reachable by their unguessable names.

The Gemini key lives only in `server/.env` (file mode 600, git-ignored) and is used only by the server; it is never sent to the browser or the Android app.
