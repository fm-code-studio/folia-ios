// src/workers/metadataParser.worker.ts
// The parsing itself lives in src/utils/localMetadataParser.ts, so that the client
// can fall back to the main thread on a platform that cannot run this worker.

import {
    extractEmbeddedMetadata,
    hashLocalCoverBlob,
} from '../utils/localMetadataParser';

self.onmessage = async (e: MessageEvent) => {
    const { type, file, cover, includeCover, requestId } = e.data as {
        type: string;
        file?: File;
        cover?: Blob;
        includeCover?: boolean;
        requestId: string;
    };

    if (type !== 'parse-metadata' && type !== 'hash-cover') {
        self.postMessage({ type: 'error', message: 'Unknown message type', requestId });
        return;
    }

    try {
        if (type === 'hash-cover') {
            if (!cover) throw new Error('Invalid local cover payload');
            const result = await hashLocalCoverBlob(cover);
            self.postMessage({ type: 'result', data: result, requestId });
            return;
        }

        if (!(file instanceof File)) throw new Error('Missing metadata file');
        const data = await extractEmbeddedMetadata(file, Boolean(includeCover));
        self.postMessage({ type: 'result', data, requestId });
    } catch (err) {
        self.postMessage({ type: 'error', message: String(err), requestId });
    }
};
