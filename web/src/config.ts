/** Product name — change it here and it updates everywhere. */
export const APP_NAME = 'Digiteq Studio';
export const APP_TAGLINE = 'All-in-one AI creative studio';

/** The path the app lives under ('' at a site's root, '/digiteqstudio' on quotegen.ai). Set at build time by BASE_PATH. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
/** An app path ('/start', '/api/...', '/samples/...') as the browser needs it. */
export const at = (path: string) => BASE + path;
