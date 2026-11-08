import { registerPlugin } from '@capacitor/core';

import type { FoliaNativePlugin } from './definitions';

/**
 * The native side of Folia.
 *
 * `web` is the fallback for the plain web build, where none of this exists: the
 * calls that have a web equivalent (the relay, the local library) are served by the
 * browser there, and the calls that have none are refused loudly rather than
 * silently doing nothing.
 */
const FoliaNative = registerPlugin<FoliaNativePlugin>('FoliaNative', {
    web: () => import('./web').then((module) => new module.FoliaNativeWeb()),
});

export * from './definitions';
export { FoliaNative };
