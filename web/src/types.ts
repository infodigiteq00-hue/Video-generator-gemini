// Mirrors docs/API.md exactly.

export type Provider = 'omni-flash' | 'mock';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type AspectRatio = '16:9' | '9:16';
export type Resolution = '720p' | '1080p';
export type DurationSeconds = 4 | 6 | 8;
export type ImageSize = '1K' | '2K' | '4K';

export type Kind = 'video' | 'image';

export interface Job {
  id: string;
  kind: Kind;
  chatId: string | null;
  provider: string;
  status: JobStatus;
  prompt: string;
  negativePrompt: string | null;
  aspectRatio: AspectRatio;
  /** Video only */
  resolution: Resolution | null;
  /** Video only */
  durationSeconds: DurationSeconds | null;
  /** Image only */
  imageSize?: ImageSize | null;
  /** Reference image (image-to-video), e.g. "/media/uploads/<file>" */
  imageUrl: string | null;
  /** What the user typed, when `prompt` was written for them (brand posts) */
  request: string | null;
  title: string | null;
  brandId: string | null;
  /** Created by the app as a follow-up (the brand post's video), not typed by the user */
  auto: boolean;
  followUpError: string | null;
  /** Same result without the logo (brand posts) */
  cleanUrl?: string | null;
  /** Where the client placed their logo; null = no logo */
  logo?: LogoPlace | null;
  /** Brand post that turns into a video once the image is ready */
  makesVideo?: boolean;
  /** Job whose output image was used as input */
  sourceJobId: string | null;
  /** Set when succeeded: the generated image or video */
  outputUrl: string | null;
  videoUrl: string | null;
  /** USD */
  estimatedCost: number;
  error: string | null;
  /** ISO */
  createdAt: string;
  /** ISO */
  updatedAt: string;
  elapsedSeconds: number;
}

export interface ProviderConfig {
  id: Provider;
  label: string;
  available: boolean;
  pricePerSecond: Record<Resolution, number>;
}

export interface AppConfig {
  providers: ProviderConfig[];
  image: { available: boolean; label: string; pricePerImage: Partial<Record<ImageSize, number>> };
  imageSizes: ImageSize[];
  defaultProvider: Provider;
  durations: DurationSeconds[];
  aspectRatios: AspectRatio[];
  resolutions: Resolution[];
  rules: { '1080pRequiresDuration': DurationSeconds };
  pack: Pack;
}

export interface Pack {
  name: string;
  festivals: string[];
  /** Festivals that also get a video */
  video: string[];
  /** Designs allowed per festival (the first one plus redos) */
  designs: number;
}

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'customer';
  /** Payment confirmed: the pack is unlocked */
  paid: boolean;
  createdAt: string;
}

export interface Customer extends User {
  business: string | null;
  posts: number;
}

export interface CreateJobInput {
  kind: Kind;
  chatId: string;
  sourceJobId?: string | null;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  resolution?: Resolution | null;
  durationSeconds?: DurationSeconds | null;
  imageSize?: ImageSize | null;
  provider: Provider;
  image?: File | null;
}

export const isActiveStatus = (s: JobStatus) => s === 'queued' || s === 'running';

export type PageId = 'chat' | 'figma' | 'canva' | 'editor' | 'customers';

export interface Brand {
  id: string;
  name: string;
  industry: string;
  /** null when the client has no logo and picked colours by hand */
  logoUrl: string | null;
  colors: string[];
  style: string;
  website?: string | null;
  websiteProfile?: {
    summary: string;
    products: string[];
    audience: string;
    tone: string;
    visualStyle: string;
    colors: string[];
    fonts: string[];
  } | null;
  websiteError?: string | null;
  /** Products or services the client wants in their posts */
  featured?: string[];
  /** Shown on the closing card of videos when `endCard` is on */
  contact?: Contact;
  endCard?: boolean;
}

export interface Contact {
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
}

export interface BrandInput {
  id?: string;
  name: string;
  industry: string;
  website?: string;
  featured: string[];
  contact: Contact;
  endCard: boolean;
  /** Picked by hand when there's no logo; otherwise read from the logo */
  colors: string[];
  logo: File | null;
}

export interface BrandPostInput {
  chatId: string;
  request: string;
  /** Make the video for this finished image (when its video didn't start) */
  changeOf?: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  resolution: Resolution;
  durationSeconds: DurationSeconds;
  provider: Provider;
}

/** Logo placement as fractions of the frame: top-left corner and width. */
export interface LogoPlace {
  x: number;
  y: number;
  w: number;
}
