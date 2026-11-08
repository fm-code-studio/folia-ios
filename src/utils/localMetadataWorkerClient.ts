export type {
    EmbeddedMetadataResult,
    HashedLocalCoverResult,
} from './localMetadataParser';

import {
    extractEmbeddedMetadata,
    hashLocalCoverBlob,
    type EmbeddedMetadataResult,
    type HashedLocalCoverResult,
} from './localMetadataParser';

let metadataWorker: Worker | null = null;
let workerRequestId = 0;
const workerCallbacks = new Map<string, (result: unknown | null) => void>();

/**
 * Builds the metadata worker, or returns null when this platform cannot have one.
 *
 * A web view is the one place where a worker may fail to start, and a worker that
 * never answers leaves the promise it was given waiting forever - the song would sit
 * there with no tags and no error. So a failure to build one is not an error here:
 * the caller falls back to the main thread.
 */
export const initMetadataWorker = (): Worker | null => {
    if (metadataWorker) return metadataWorker;

    if (typeof Worker === 'undefined') return null;

    try {
        metadataWorker = new Worker(
            new URL('../workers/metadataParser.worker.ts', import.meta.url),
            { type: 'module' }
        );
    } catch (error) {
        console.warn('[MetadataWorker] Falling back to the main thread:', error);
        return null;
    }

    metadataWorker.onmessage = (e) => {
        const { type, data, requestId, message } = e.data;
        const callback = workerCallbacks.get(requestId);
        if (callback) {
            workerCallbacks.delete(requestId);
            if (type === 'result') {
                callback(data);
            } else {
                console.warn('[MetadataWorker] parsing error:', message);
                callback(null);
            }
        }
    };

    return metadataWorker;
};

export const parseEmbeddedMetadataAsync = async (
    file: File,
    includeCover = false
): Promise<EmbeddedMetadataResult | null> => {
    const worker = initMetadataWorker();
    if (!worker) {
        try {
            return await extractEmbeddedMetadata(file, includeCover);
        } catch (error) {
            console.warn('[MetadataWorker] parsing failed on the main thread:', error);
            return null;
        }
    }

    return new Promise((resolve) => {
        const requestId = `meta_req_${++workerRequestId}`;
        workerCallbacks.set(requestId, result => resolve(result as EmbeddedMetadataResult | null));
        worker.postMessage({ type: 'parse-metadata', file, includeCover, requestId });
    });
};

export const hashLocalCoverBlobAsync = async (cover: Blob): Promise<HashedLocalCoverResult | null> => {
    const worker = initMetadataWorker();
    if (!worker) {
        try {
            return await hashLocalCoverBlob(cover);
        } catch (error) {
            console.warn('[MetadataWorker] hashing failed on the main thread:', error);
            return null;
        }
    }

    return new Promise((resolve) => {
        const requestId = `cover_hash_req_${++workerRequestId}`;
        workerCallbacks.set(requestId, result => resolve(result as HashedLocalCoverResult | null));
        worker.postMessage({ type: 'hash-cover', cover, requestId });
    });
};
