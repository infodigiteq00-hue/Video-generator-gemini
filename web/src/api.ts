import type { AppConfig, Brand, BrandPostInput, CreateJobInput, Job, LogoPlace } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running on port 8787?', 0);
  }
  if (!res.ok) {
    let message =
      res.status >= 500
        ? `Server error (${res.status}). Is the backend running on port 8787?`
        : `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string' && body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    // Session missing or expired: tell the app to show the sign-in screen.
    if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/me')) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me(): Promise<{ email: string }> {
    return request<{ email: string }>('/api/me');
  },

  login(email: string, password: string): Promise<{ email: string }> {
    return request<{ email: string }>('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  },

  logout(): Promise<void> {
    return request<void>('/api/logout', { method: 'POST' });
  },

  /** GET /api/config */
  getConfig(): Promise<AppConfig> {
    return request<AppConfig>('/api/config');
  },

  /** GET /api/jobs — newest first */
  listJobs(): Promise<Job[]> {
    return request<Job[]>('/api/jobs');
  },

  /** GET /api/jobs/:id */
  getJob(id: string): Promise<Job> {
    return request<Job>(`/api/jobs/${encodeURIComponent(id)}`);
  },

  /** POST /api/jobs (multipart/form-data) → 201 Job */
  createJob(input: CreateJobInput): Promise<Job> {
    const fd = new FormData();
    fd.append('kind', input.kind);
    fd.append('chatId', input.chatId);
    if (input.sourceJobId) fd.append('sourceJobId', input.sourceJobId);
    fd.append('prompt', input.prompt);
    if (input.negativePrompt && input.negativePrompt.trim()) {
      fd.append('negativePrompt', input.negativePrompt.trim());
    }
    fd.append('aspectRatio', input.aspectRatio);
    if (input.resolution) fd.append('resolution', input.resolution);
    if (input.durationSeconds) fd.append('durationSeconds', String(input.durationSeconds));
    if (input.imageSize) fd.append('imageSize', input.imageSize);
    fd.append('provider', input.provider);
    if (input.image) fd.append('image', input.image, input.image.name);
    return request<Job>('/api/jobs', { method: 'POST', body: fd });
  },

  getBrand(id: string): Promise<Brand> {
    return request<Brand>(`/api/brands/${encodeURIComponent(id)}`);
  },

  /** Create (no id) or update a brand kit. The logo is required when creating. */
  saveBrand(input: { id?: string; name: string; industry: string; website?: string; logo: File | null }): Promise<Brand> {
    const fd = new FormData();
    fd.append('name', input.name);
    fd.append('industry', input.industry);
    fd.append('website', input.website ?? '');
    if (input.logo) fd.append('logo', input.logo, input.logo.name);
    return request<Brand>(input.id ? `/api/brands/${encodeURIComponent(input.id)}` : '/api/brands', {
      method: input.id ? 'PUT' : 'POST',
      body: fd,
    });
  },

  /** Short request → written brief → brand image (its video follows automatically). */
  createBrandPost(input: BrandPostInput): Promise<Job> {
    return request<Job>('/api/brand-posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  /** Stamp the logo at `place`, or remove it with null. */
  placeLogo(id: string, place: LogoPlace | null): Promise<Job> {
    return request<Job>(`/api/jobs/${encodeURIComponent(id)}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(place ?? { remove: true }),
    });
  },

  /** DELETE /api/jobs/:id → 204 */
  deleteJob(id: string): Promise<void> {
    return request<void>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
