// src/services/lyricProxy.ts

/**
 * The app's own relay for outside hosts a web page cannot fetch directly (QQ and KuGou lyric
 * hosts, the AMLL lyric database, QQ and KuGou cover pictures). This file is the only place in
 * the renderer that knows the relay's web address and its desktop bridge.
 *
 * Server sides, each with its own allow-list of hosts: api/lyric-proxy.js, api-ts/lyric-proxy.ts
 * and worker/lyric-proxy.ts on the web; proxyLyricRequest in electron/main.cjs (IPC
 * lyric-proxy-fetch) on the desktop; and the native HTTP bridge on iOS, where there is no
 * server to ask at all.
 *
 * It lives in src/services/ because lyric code, a platform's transport and the cover cache all
 * use it, and none of them owns it.
 *
 * Which route a caller takes (the target directly, the web address or the bridge) stays the
 * caller's own choice; this file only names the two relay routes.
 */

import { isElectronRuntime, isNativeRuntime } from '../platform';

type LyricProxyBridge = NonNullable<Window['electron']>['fetchLyricProxy'];

/** The relay's address on the web for one target URL. */
export const lyricProxyWebUrl = (targetUrl: string): string => (
    `/api/lyric-proxy?url=${encodeURIComponent(targetUrl)}`
);

/**
 * Sends one request through the desktop bridge. Returns null, without sending anything, when
 * the bridge is not there (the web, or a desktop preload without it), so the caller can take
 * its other route.
 */
export const requestLyricProxyOnDesktop = (
    ...args: Parameters<LyricProxyBridge>
): ReturnType<LyricProxyBridge> | null => {
    if (typeof window === 'undefined' || !window.electron?.fetchLyricProxy) return null;
    return window.electron.fetchLyricProxy(...args);
};

/** How the relayed body should be handed back. */
export type LyricProxyResponseType = 'text' | 'json' | 'arraybuffer';

/**
 * The hosts the relay is allowed to reach.
 *
 * The same rule the relay servers keep (api-ts/lyric-proxy.ts, worker/lyric-proxy.ts,
 * and the dev proxy in vite.config.ts): QQ's lyric and cover hosts, and KuGou's.
 * On the native shell there is no relay server to keep the rule, so the rule is kept
 * here instead - the request never leaves the device either way, but the set of hosts
 * it may reach should not depend on which platform the app runs on.
 */
const isAllowedRelayHost = (hostname: string): boolean => (
    hostname === 'qq.com' || hostname.endsWith('.qq.com')
    || hostname === 'y.gtimg.cn'
    || hostname === 'kugou.com' || hostname.endsWith('.kugou.com')
    || hostname === 'kgimg.com' || hostname.endsWith('.kgimg.com')
);

/**
 * Fetches one target through the relay, and answers with an ordinary Response.
 *
 * The relay is the same relay on all three platforms, and only the way the request
 * reaches it differs:
 *
 *   - the web asks the relay route of its own deployment (`/api/lyric-proxy`);
 *   - the desktop app asks its main process, which forwards the request and adds the
 *     CORS headers the web view would otherwise refuse;
 *   - iOS has no relay server, so the request goes out through the native HTTP
 *     bridge, which is not subject to the web view's cross-origin rules at all.
 *
 * The body is sent as it is and the answer is passed back untouched, so a caller cannot
 * tell which platform it is on.
 */
export const fetchThroughLyricProxy = async (
    targetUrl: string,
    init: RequestInit = {},
    responseType: LyricProxyResponseType = 'text',
): Promise<Response> => {
    if (isNativeRuntime()) {
        return nativeLyricProxyFetch(targetUrl, init, responseType);
    }

    if (isElectronRuntime()) {
        // The desktop app reaches the host directly; its main process adds the CORS
        // headers the renderer needs.
        return fetch(targetUrl, init);
    }

    return fetch(lyricProxyWebUrl(targetUrl), init);
};

/** Reads a header bag into the plain object the native bridge wants. */
const readHeaders = (headers: HeadersInit | undefined): Record<string, string> => {
    const result: Record<string, string> = {};
    if (!headers) return result;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        headers.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }
    if (Array.isArray(headers)) {
        for (const [key, value] of headers) result[key] = value;
        return result;
    }
    return { ...(headers as Record<string, string>) };
};

/**
 * The body of a request, as the native bridge wants it: a string it can send as is.
 *
 * A body that is not already text is not expected here - every relayed request Folia
 * makes sends JSON - but a FormData or a Blob would have to be refused rather than
 * silently sent empty, so it is stringified as JSON and the content type says so.
 */
const readBody = (body: BodyInit | null | undefined): string | undefined => {
    if (body === null || body === undefined) return undefined;
    if (typeof body === 'string') return body;
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return body.toString();
    }
    return JSON.stringify(body);
};

/** Turns the native bridge's answer back into an ordinary Response. */
const buildResponse = (
    status: number,
    headers: Record<string, string>,
    data: unknown,
    responseType: LyricProxyResponseType,
): Response => {
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(headers ?? {})) {
        // The bridge reports the content type twice, once under the canonical name and
        // once as it came off the wire; Headers would throw on a duplicate.
        if (!responseHeaders.has(key)) responseHeaders.set(key, value);
    }

    if (responseType === 'arraybuffer') {
        const base64 = typeof data === 'string' ? data : '';
        const binary = base64ToBytes(base64);
        // A copy with a plain ArrayBuffer behind it: the bytes that came out of the
        // decoder may sit in a shared buffer, which a body does not accept.
        const body = new Uint8Array(binary.length);
        body.set(binary);
        return new Response(body.buffer, { status, headers: responseHeaders });
    }

    if (responseType === 'json') {
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        return new Response(text, { status, headers: responseHeaders });
    }

    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return new Response(text, { status, headers: responseHeaders });
};

/** Decodes base64 into bytes, without pulling in a dependency for it. */
const base64ToBytes = (base64: string): Uint8Array => {
    if (!base64) return new Uint8Array(0);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

/**
 * Sends the relayed request through the native HTTP bridge.
 *
 * The native side is not the web view, so it is not bound by the web view's
 * cross-origin rules: the host allow-list the relay server keeps is enforced there
 * instead, and the answer comes back whole.
 */
const nativeLyricProxyFetch = async (
    targetUrl: string,
    init: RequestInit,
    responseType: LyricProxyResponseType,
): Promise<Response> => {
    let parsed: URL;
    try {
        parsed = new URL(targetUrl);
    } catch {
        throw new Error(`Lyric relay refused a malformed URL: ${targetUrl}`);
    }
    if (!isAllowedRelayHost(parsed.hostname)) {
        throw new Error(`Lyric relay refused an unlisted host: ${parsed.hostname}`);
    }

    const { CapacitorHttp } = await import('@capacitor/core');

    const raw = await CapacitorHttp.request({
        url: targetUrl,
        method: init.method ?? 'GET',
        headers: readHeaders(init.headers),
        data: readBody(init.body),
        responseType,
        // QQ's signed-in play link is four calls in a row, each of which may take its
        // own 25 s; the desktop app allows 70 s for the whole chain, and so does this.
        readTimeout: 75_000,
        connectTimeout: 20_000,
    });

    return buildResponse(raw.status, raw.headers, raw.data, responseType);
};
