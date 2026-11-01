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

### `POST /api/jobs` (admins) — `multipart/form-data`
Fields: `kind` (`video` default, or `image`), `chatId`, `prompt` (required), `negativePrompt`, `aspectRatio`, `resolution` and `durationSeconds` (video only), `provider`, `image` (optional file: png/jpeg/webp, max 10 MB), `sourceJobId` (use a finished image job's output as the input image).
Images use Nano Banana 2 (`gemini-3.1-flash-image`, set by `IMAGE_MODEL`); an input image means "edit this". Videos use Veo 3.1 Lite; an input image means "animate this".
Returns `201` with a `Job`, or `400 { "error": "..." }`.

### `GET /api/jobs` → `Job[]` (newest first)
### `GET /api/jobs/:id` → `Job` (poll every ~3s while queued/running)
### `DELETE /api/jobs/:id` → `204` (removes the job and its files)

## Brand kits

### `POST /api/brands` — `multipart/form-data`: `industry` and `name` (required), `logo` (optional file), `colors` (JSON array of hex codes, used when there's no logo), `website`, `featured` (JSON array of up to 10 product/service names), `contact` (JSON `{ phone?, email?, website?, address? }`), `endCard` (`true`/`false`: close videos with the contact card) → `201 Brand`
### `PUT /api/brands/:id` — same fields, `logo` optional → `Brand`
### `GET /api/brands/:id` → `Brand`

```ts
interface Brand {
  id: string; name: string; industry: string; logoUrl: string; colors: string[]; style: string;
  featured: string[]; contact: { phone?: string; email?: string; website?: string; address?: string }; endCard: boolean;
}
```

### `POST /api/brand-posts` — JSON
`{ brandId, chatId, request, aspectRatio, imageSize, resolution, durationSeconds, provider }` → `201 Job` (the image).
`request` is the festival. The image prompt is built from the brand's details; once the image is ready the server asks Gemini
how to animate it and creates the video job itself (`auto: true`, same `chatId`, `sourceJobId` = the image).
With `changeOf` (a finished image id) instead of `request`, it makes that image's video.
Jobs gain `request`, `title`, `brandId`, `auto`, `followUpError`.

### `GET /api/jobs/:id/download` → the file as an attachment. Brand videos get the contact card appended (made on first download, then cached).

## Accounts

All `/api` routes need a session cookie except: `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/signup`,
`GET|POST /api/invites/:token`, `GET /api/public/stats` and `GET /api/jobs/:id`. Jobs and brands are scoped to the signed-in account.

- `POST /api/login` `{ login, password }` (`login` = email or mobile) → `User`
- `GET /api/me` → `User` `{ id, email, phone, role: 'admin' | 'customer', paid, createdAt }`
- `POST /api/signup` multipart: the brand fields of `POST /api/brands` plus `email` and/or `phone`, `password` → `201 User` (payment pending, signed in)
- `GET /api/invites/:token` → `{ email, phone }`; `POST /api/invites/:token` `{ email, phone, password }` → `201 User` (paid, signed in)
- `GET /api/public/stats` → `{ paid }` (paid customer accounts)
- Admin: `GET /api/admin/users` → customers with `business` and `posts`; `POST /api/admin/users/:id` `{ paid }`;
  `POST /api/admin/invites` `{ email, phone }` → `{ url }`
- `GET /api/config` also returns `pack: { name, festivals, video, designs }`.
- `POST /api/brand-posts` for customers: `402` until paid; `400` for a festival outside the pack or after `designs` posts for it.
