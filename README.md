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
   1. **What the business does** (with quick-pick chips) and optionally the website. The server reads the website (homepage + About/Products/Services pages, CSS colours and fonts, a few photos; public addresses only, honest `DigiteqStudioBot` user agent) and Gemini turns it into a company profile (products, audience, tone, visual style) added to every image prompt (`server/src/website.js`).
   2. **Products or services to feature** (up to 10). The image AI uses all, a few or one of them, whichever makes the best post.
   3. **Business name, tagline (optional) and logo.** Gemini reads the logo's colours and style (`server/src/brand.js`). The logo is optional: without one, the client picks brand colours by hand and the app stamps their name at the top of each post.
      **Logo clean-up** (`server/src/logo.js`): every logo becomes a PNG. If it sits on a solid background, the client sees a preview and chooses *Keep it*, *Remove* (the background around the logo) or *Remove inside too* (that colour everywhere); edges are un-mixed from the background so they stay crisp. Logos with a see-through background also get a **White** and a **Grey** version; the app picks White when the top of a post is dark, and the client can switch versions when placing the logo.
   4. **Contact details** (optional: phone, email, website, address). Posts get a contact bar at the bottom, and downloaded videos end with a 3-second white closing card (logo, tagline, website, email, phone, address), all drawn by ffmpeg so numbers are always exact (`stampBrand`, `addEndCard` in `server/src/brand.js`).
   The brand is remembered in this browser and can be edited from the sidebar.
2. **Home screen:** the nearest big festival is suggested from the calendar (`web/src/festivals.ts`; Indian festivals for devices on India time, worldwide ones for everyone). The user can pick another from the dropdown and presses **Generate**. Every post is a 9:16 image plus an 8 second video. Lunar festival dates are listed per year: add the next year's dates before the list runs out.
3. **Wait screen:** shows the steps (idea, post, video) and a timer while it works. No chat.
4. **Image:** one prompt built from the client's details (`imagePrompt` in `server/src/brand.js`), aimed at agency-style posts: the business's own world is the heart of the festival (its products forming the festival art, its product as the festival gift, its workplace celebrating, or the festival's story in its colours), photoreal and cinematic, with a fixed layout: a calm space at the top for the logo, a small "HAPPY" over a large ornamental festival name, the brand tagline (or a one-line wish) under it, and a clear band at the bottom. Nano Banana 2 makes it.
   **Brand frame:** ffmpeg then adds the real logo centred at the top and a contact bar (phone, email, website, address) in the darkest brand colour across the bottom (`stampBrand`), so they're always sharp and correct. The client can move or remove the logo.
   **Video:** Gemini looks at the image and writes how to animate it as a premium festive film (subtle, cinematic motion; text and layout kept still); that prompt plus the logo-free image go to Gemini Omni Flash, and the brand frame is added to the video too.
5. **Result:** the image appears first, then the video. The client places their logo on each (ffmpeg stamps the real logo) and downloads. Videos download with the contact card appended (`GET /api/jobs/:id/download`).

Cost: about $0.10 per image post (2K) and $0.50 per video post (image + 8 s video).

## Cost

Nano Banana 2: about **$0.067 per image** (switch `IMAGE_MODEL` to `gemini-3.1-flash-lite-image` for Nano Banana 2 Lite at ~$0.034).

Gemini Omni Flash bills about **$0.10 per second** of video (720p): 4 s ≈ $0.40, 6 s ≈ $0.60, 8 s ≈ $0.80. Omni has no length setting, so the length is requested in the prompt.

## Structure

```
server/   Express API. Keeps the API key server-side, runs jobs, stores videos in server/data/
  src/db.js               SQLite: accounts, invites, brands, jobs
  src/auth.js             Accounts: signup, login (email or mobile), invites, admin, sessions
  src/jobs.js             Job validation, storage and worker (shared by web + ChatGPT)
  src/brand.js            Brand kits: logo reading, image and video prompts, logo stamping, contact card
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

## Website, signup and accounts

- **`/`** landing page (`web/src/components/Landing.tsx`). Price, launch end date, founding seats, WhatsApp number and customer reviews are in `web/src/offer.ts`; reviews and the seat counter stay hidden until there are real ones. The pack's festivals are in `PACK` (`server/src/index.js`) and repeated on the landing page.
- **`/start`** signup funnel: what the business does, products, name and logo/colours, **pay** (placeholder UPI QR for now), then login + contact details. The account is created as **payment pending**: the pack stays locked until an admin marks it paid, and unlocks on the customer's screen within 15 s.
- **`/login`**: email or mobile number + password. **`/invite/<token>`**: an admin's invite for someone who paid but couldn't sign up (sets a password, then the setup opens). Links last 7 days.
- **Admin** = the account in `AUTH_EMAIL` / `AUTH_PASSWORD_HASH` (scrypt `salt:hash`). Admins see **Customers** (mark paid, create invite links) and can make posts for any festival. `AUTH_SECRET` signs the 30-day session cookie; 10 wrong tries per 15 minutes locks out an address for a while.
- **Data:** SQLite (`node:sqlite`, built into Node) at `DATA_DIR/app.db`: accounts, invites, brands and jobs, each brand and job tagged with its account. Old `brands.json` / `jobs.json` are imported into the admin account on first start. Only `/media/uploads` and `/media/videos` are served; result files have unguessable names.
- **Pack rules (customers):** only the pack's festivals, nothing until paid, videos for Dhanteras, Diwali and Hindu New Year (photo posts for the rest), and one design per festival. A new design costs ₹199 (`PACK.redoPrice`): the customer pays (placeholder QR for now) and taps *I've paid*, then an admin presses *Paid, make it* under Customers → New design requests and it appears in the customer's post.

The Gemini key lives only in `server/.env` (file mode 600, git-ignored) and is used only by the server; it is never sent to the browser or the Android app.
