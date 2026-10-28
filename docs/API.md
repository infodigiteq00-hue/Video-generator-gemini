# Backend API contract

Backend: Express on `http://localhost:8787`. The Vite dev server proxies `/api` and `/media` to it.

## Types

```ts
type Provider = 'veo-3.1-lite' | 'mock';   // 'mock' = demo mode for both images and videos
type Kind = 'video' | 'image';
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface Job {
  id: string;
  kind: Kind;
  chatId: string | null;       // groups jobs into a chat thread
  provider: string;            // 'veo-3.1-lite' | 'nano-banana-2-lite' | 'mock'
  status: JobStatus;
  prompt: string;
  negativePrompt: string | null;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p' | null;   // null for images
  durationSeconds: 4 | 6 | 8 | null;     // null for images
  imageUrl: string | null;     // reference image (image-to-video), e.g. "/media/uploads/<file>"
  sourceJobId: string | null;  // image job whose output was used as input
  outputUrl: string | null;    // set when succeeded: generated image or video
  videoUrl: string | null;     // same as outputUrl for videos (kept for the ChatGPT widget)
  estimatedCost: number;       // USD
  error: string | null;
  createdAt: string;           // ISO
  updatedAt: string;           // ISO
  elapsedSeconds: number;
}
```

## Endpoints

### `GET /api/config`
```json
{
  "providers": [
    { "id": "veo-3.1-lite", "label": "Veo 3.1 Lite", "available": true,
      "pricePerSecond": { "720p": 0.05, "1080p": 0.08 } },
    { "id": "mock", "label": "Demo mode (no API cost)", "available": true,
      "pricePerSecond": { "720p": 0, "1080p": 0 } }
  ],
  "defaultProvider": "veo-3.1-lite",
  "durations": [4, 6, 8],
  "aspectRatios": ["16:9", "9:16"],
  "resolutions": ["720p", "1080p"],
  "rules": { "1080pRequiresDuration": 8 }
}
```
`available: false` on Veo means no API key is configured. The UI should then default to `mock` and show a hint.

### `POST /api/jobs` — `multipart/form-data`
Fields: `kind` (`video` default, or `image`), `chatId`, `prompt` (required), `negativePrompt`, `aspectRatio`, `resolution` and `durationSeconds` (video only), `provider`, `image` (optional file: png/jpeg/webp, max 10 MB), `sourceJobId` (use a finished image job's output as the input image).
Images use Nano Banana 2 (`gemini-3.1-flash-image`, set by `IMAGE_MODEL`); an input image means "edit this". Videos use Veo 3.1 Lite; an input image means "animate this".
Returns `201` with a `Job`, or `400 { "error": "..." }`.

### `GET /api/jobs` → `Job[]` (newest first)
### `GET /api/jobs/:id` → `Job` (poll every ~3s while queued/running)
### `DELETE /api/jobs/:id` → `204` (removes the job and its files)

## Brand kits

### `POST /api/brands` — `multipart/form-data`: `industry` (required), `name`, `logo` (required file) → `201 Brand`
### `PUT /api/brands/:id` — same fields, `logo` optional → `Brand`
### `GET /api/brands/:id` → `Brand`

```ts
interface Brand { id: string; name: string; industry: string; logoUrl: string; colors: string[]; style: string }
```

### `POST /api/brand-posts` — JSON
`{ brandId, chatId, request, aspectRatio, imageSize, resolution, durationSeconds, provider }` → `201 Job` (the image).
The server writes the brief, makes the image, stamps the logo, then creates the follow-up video job itself
(`auto: true`, same `chatId`, `sourceJobId` = the image). Jobs gain `request`, `title`, `brandId`, `auto`, `followUpError`.
