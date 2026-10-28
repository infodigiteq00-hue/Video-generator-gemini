import type { Kind } from './types';

const VIDEO = /\b(videos?|animat\w*|clips?|film|movie|footage|motion|moving|reel|bring (it|this|that) to life|make (it|this|that) move)\b/i;
const IMAGE = /\b(images?|pictures?|pics?|photos?|photograph|visuals?|illustrat\w*|drawing|draw|paint\w*|posters?|logos?|artwork|art|wallpaper|thumbnail|portrait|sketch|graphic)\b/i;
const REFERS_BACK = /\b(it|this|that|the (image|picture|photo|visual))\b/i;

/**
 * Decide what the user is asking for.
 * - Video words or "animate" → video; image words → image; when both appear, whichever comes first.
 * - An attached image with no other hint means "animate this".
 * - A follow-up like "make it brighter" continues with the last result's kind.
 */
export function detectKind(text: string, hasAttachment: boolean, lastKind: Kind | null): Kind | null {
  if (/\banimat/i.test(text)) return 'video';
  const v = text.search(VIDEO);
  const i = text.search(IMAGE);
  if (v >= 0 && (i < 0 || v < i)) return 'video';
  if (i >= 0) return 'image';
  if (hasAttachment) return 'video';
  if (lastKind && REFERS_BACK.test(text)) return lastKind;
  return null;
}

export const refersBack = (text: string) => REFERS_BACK.test(text);
