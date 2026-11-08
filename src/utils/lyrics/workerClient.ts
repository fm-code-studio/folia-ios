import { LyricData } from '../../types';
import type { LyricParseFormat } from './parserCore';
import type { LyricProcessingOptions } from './types';

let lyricsWorker: Worker | null = null;
let workerRequestId = 0;
const workerCallbacks = new Map<string, (data: LyricData | null) => void>();

type WorkerLyricProcessingOptions = Pick<LyricProcessingOptions, 'includeInterludes'>;

// Keeps orchestration-only values such as provider callbacks outside the structured-clone boundary.
export const toWorkerLyricProcessingOptions = (
    options?: LyricProcessingOptions,
): WorkerLyricProcessingOptions | undefined => {
    if (!options) return undefined;
    return {
        ...(options.includeInterludes !== undefined ? { includeInterludes: options.includeInterludes } : {}),
    };
};

/**
 * Builds the lyrics worker, or returns null when this platform cannot have one.
 *
 * A web view is the one place where a worker may fail to start, and a worker that
 * never answers leaves the promise it was given waiting forever - the lyrics would
 * simply never arrive. So a failure to build one is not an error here: the caller
 * falls back to parsing on the main thread.
 */
export const initLyricsWorker = (): Worker | null => {
    if (lyricsWorker) return lyricsWorker;

    if (typeof Worker === 'undefined') return null;

    try {
        // Need to use correct relative path or alias
        lyricsWorker = new Worker(
            new URL('../../workers/lyricsParser.worker.ts', import.meta.url),
            { type: 'module' }
        );
    } catch (error) {
        console.warn('[LyricsWorker] Falling back to the main thread:', error);
        return null;
    }

    lyricsWorker.onmessage = (e) => {
        const { type, data, requestId, message } = e.data;
        const callback = workerCallbacks.get(requestId);
        if (callback) {
            workerCallbacks.delete(requestId);
            if (type === 'result') {
                callback(data);
            } else {
                console.warn('[LyricsWorker] parsing error:', message);
                callback(null);
            }
        }
    };

    return lyricsWorker;
};

/** Parses on the main thread, for a platform that cannot run the worker. */
const parseOnMainThread = async (
    format: LyricParseFormat,
    content: string,
    translation?: string,
    options?: LyricProcessingOptions,
    romanization?: string,
): Promise<LyricData | null> => {
    try {
        const { parseLyricsByFormat } = await import('./parserCore');
        return parseLyricsByFormat(format, content, translation ?? '', options ?? {}, romanization ?? '');
    } catch (error) {
        console.warn('[LyricsWorker] parsing failed on the main thread:', error);
        return null;
    }
};

export const parseLyricsAsync = async (
    format: LyricParseFormat,
    content: string,
    translation?: string,
    options?: LyricProcessingOptions,
    romanization?: string
): Promise<LyricData | null> => {
    const worker = initLyricsWorker();
    if (!worker) {
        return await parseOnMainThread(format, content, translation, options, romanization);
    }

    return new Promise((resolve) => {
        const requestId = `req_${++workerRequestId}`;
        workerCallbacks.set(requestId, resolve);
        worker.postMessage({
            type: 'parse',
            format,
            content,
            translation,
            romanization,
            options: toWorkerLyricProcessingOptions(options),
            requestId,
        });
    });
};
