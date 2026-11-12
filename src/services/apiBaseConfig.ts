import { getStoredString, removeStoredKey, setStoredString } from '../stores/storagePrimitives';

// src/services/apiBaseConfig.ts
// The music API addresses the person typed in 设置 → 连接与集成.
//
// Every other address Folia talks to is decided before the page runs: the web build bakes it in,
// the native shell reads it from the app. Neither can be changed once the app is on a phone, and a
// self-hosted server is reached at an address only its owner knows - so the settings page keeps its
// own copy here, and `runtimeConfig` reads it first.

/** The three platforms whose APIs are configured separately. */
export type ApiBaseKind = 'netease' | 'kugou' | 'qq';

export type ApiBaseOverrides = Record<ApiBaseKind, string>;

/** The stored overrides, empty when nothing was set. */
const NO_OVERRIDES: ApiBaseOverrides = { netease: '', kugou: '', qq: '' };

/** A published key: it is never renamed, only read. */
const STORAGE_KEY = 'folia.apiBase.overrides';

/** 换地址时在页面上广播一次，让各平台把记住的旧地址作废。 */
export const API_BASE_CHANGED_EVENT = 'folia:api-base-changed';

const listeners = new Set<() => void>();

/** One address as it is stored: no surrounding spaces, no trailing slash. */
const normalizeBase = (value: unknown): string => (
    typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
);

/** Whether an address looks like something a request can be sent to. */
export const isUsableApiBase = (value: string): boolean => /^https?:\/\/[^\s]+$/i.test(value.trim());

/** The addresses in use, the typed-in ones or empty. */
export const getApiBaseOverrides = (): ApiBaseOverrides => {
    const raw = getStoredString(STORAGE_KEY, '');
    if (!raw) return NO_OVERRIDES;
    try {
        const parsed = JSON.parse(raw) as Partial<Record<ApiBaseKind, unknown>>;
        return {
            netease: normalizeBase(parsed.netease),
            kugou: normalizeBase(parsed.kugou),
            qq: normalizeBase(parsed.qq),
        };
    } catch {
        return NO_OVERRIDES;
    }
};

/** Stores the addresses; all three empty clears the key rather than saving an empty object. */
export const saveApiBaseOverrides = (next: ApiBaseOverrides): void => {
    const cleaned: ApiBaseOverrides = {
        netease: normalizeBase(next.netease),
        kugou: normalizeBase(next.kugou),
        qq: normalizeBase(next.qq),
    };
    if (!cleaned.netease && !cleaned.kugou && !cleaned.qq) {
        removeStoredKey(STORAGE_KEY);
    } else {
        setStoredString(STORAGE_KEY, JSON.stringify(cleaned));
    }
    listeners.forEach(listener => listener());
    // 各平台把 resolved 的地址缓存着（netease 的 API_BASE 就是这样），不通知它们的话，
    // 保存后要等重开页面才生效。
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(API_BASE_CHANGED_EVENT));
    }
};

/** Told when the addresses change, so an open settings page follows what was saved. */
export const subscribeApiBaseOverrides = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/**
 * Reaches an address without caring what it answers.
 *
 * The point is whether the phone can talk to the server at all: a 404 from the right host is a
 * working address, a connection error is not.
 */
export const probeApiBase = async (base: string): Promise<boolean> => {
    if (!isUsableApiBase(base)) return false;
    try {
        await fetch(`${normalizeBase(base)}/`, { method: 'GET', mode: 'cors', cache: 'no-store' });
        return true;
    } catch {
        return false;
    }
};
