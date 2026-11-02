import { at } from './config';
import type { AdminRedo, AppConfig, Brand, Contact, BrandInput, BrandPostInput, CreateJobInput, Customer, Job, LogoPlace, LogoPreview, Redo, User } from './types';

function brandForm(input: BrandInput) {
  const fd = new FormData();
  fd.append('name', input.name);
  fd.append('industry', input.industry);
  fd.append('website', input.website ?? '');
  fd.append('featured', JSON.stringify(input.featured));
  fd.append('contact', JSON.stringify(input.contact));
  fd.append('endCard', String(input.endCard));
  fd.append('colors', JSON.stringify(input.colors));
  fd.append('tagline', input.tagline);
  if (input.logo) fd.append('logo', input.logo, input.logo.name);
  fd.append('logoBg', input.logoBg ?? 'keep');
  return fd;
}

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
    res = await fetch(at(path), init);
  } catch {
    throw new ApiError('Can’t connect right now. Check your internet and try again.', 0);
  }
  if (!res.ok) {
    let message =
      res.status >= 500
        ? `Something went wrong on our side (${res.status}). Please try again.`
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
  me(): Promise<User> {
    return request<User>('/api/me');
  },

  /** `login` is an email address or a mobile number. */
  login(login: string, password: string): Promise<User> {
    return request<User>('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });
  },

  /** "Get it now": the account first; the brand setup and payment follow in the app. */
  signup(input: { phone: string; email: string; password: string; contact: Contact; endCard: boolean }): Promise<User> {
    return request<User>('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  },

  getReset(token: string): Promise<{ email: string | null; phone: string | null }> {
    return request(`/api/resets/${encodeURIComponent(token)}`);
  },

  /** Sets the new password from a reset link and signs in. */
  acceptReset(token: string, password: string): Promise<User> {
    return request<User>(`/api/resets/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  },

  /** Admin: correct a customer's login. */
  updateLogin(id: string, input: { email: string; phone: string }): Promise<User> {
    return request<User>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  /** Admin: a one-time link for a customer to set a new password. */
  resetLink(id: string): Promise<{ url: string }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/reset`, { method: 'POST' });
  },

  getInvite(token: string): Promise<{ email: string | null; phone: string | null }> {
    return request(`/api/invites/${encodeURIComponent(token)}`);
  },

  acceptInvite(token: string, input: { email: string; phone: string; password: string }): Promise<User> {
    return request<User>(`/api/invites/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  /** What's behind an uploaded logo, and how each background choice looks. */
  previewLogo(logo: File): Promise<LogoPreview> {
    const fd = new FormData();
    fd.append('logo', logo, logo.name);
    return request<LogoPreview>('/api/logo/preview', { method: 'POST', body: fd });
  },

  /** Founding spots taken, whether payments go through PhonePe, and today's pack price (rupees). */
  publicStats(): Promise<{ paid: number; online: boolean; price: number }> {
    return request('/api/public/stats');
  },

  /** PhonePe's payment page for the signed-in account's pack. */
  payPack(): Promise<{ url: string }> {
    return request('/api/pay/pack', { method: 'POST' });
  },

  /** How the account's pack payment stands with PhonePe (checked again each time). */
  payStatus(): Promise<{ state: 'paid' | 'failed' | 'pending' | 'none' }> {
    return request('/api/pay/status');
  },

  /** Ask for a new design of a post: { url } is PhonePe's payment page (online payments), else a request an admin confirms. */
  requestRedo(jobId: string): Promise<Redo | { url: string }> {
    return request<Redo | { url: string }>('/api/redos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }) });
  },

  myRedos(): Promise<Redo[]> {
    return request<Redo[]>('/api/redos');
  },

  adminRedos(): Promise<AdminRedo[]> {
    return request<AdminRedo[]>('/api/admin/redos');
  },

  /** Payment confirmed: make the new design. */
  approveRedo(id: string): Promise<void> {
    return request<void>(`/api/admin/redos/${encodeURIComponent(id)}`, { method: 'POST' });
  },

  customers(): Promise<Customer[]> {
    return request<Customer[]>('/api/admin/users');
  },

  setPaid(id: string, paid: boolean): Promise<void> {
    return request<void>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid }),
    });
  },

  invite(input: { email: string; phone: string }): Promise<{ url: string }> {
    return request('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
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
  saveBrand(input: BrandInput): Promise<Brand> {
    const fd = brandForm(input);
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
