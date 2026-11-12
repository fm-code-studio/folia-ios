// 当前文件：读取 Docker 注入的 Web 运行时配置，并兼容既有 Vite 构建变量。

import { getApiBaseOverrides } from './apiBaseConfig';

export type WebAiProvider = 'gemini' | 'openai';

/** 音源后端的地址来源。 */
export type RuntimeApiBaseKind = 'netease' | 'kugou' | 'qq';

const normalizeAiProvider = (value: unknown): WebAiProvider => (
    value === 'openai' ? 'openai' : 'gemini'
);

export const getWebAiProvider = (): WebAiProvider => {
    if (typeof window !== 'undefined') {
        const runtimeValue = window.__FOLIA_RUNTIME_CONFIG__?.aiProvider;
        if (runtimeValue) return normalizeAiProvider(runtimeValue);
    }

    return normalizeAiProvider(import.meta.env.VITE_AI_PROVIDER);
};

/**
 * 读取某个音源的后端地址。
 *
 * 网页版和桌面版的地址是 Vite 的构建变量，打包时就定死了。原生壳（iOS）不行：
 * 一个 App 包发出去之后就没法再改构建变量了，所以地址改由原生侧在运行时给出，
 * 页面启动前注入 `__FOLIA_RUNTIME_CONFIG__`。这里先读运行时，读不到再退回构建变量。
 */
export const getRuntimeApiBase = (kind: RuntimeApiBaseKind): string => {
    // 设置页填过的地址最优先：包发出去之后构建变量改不了，用户只能靠这里换服务器。
    const overridden = getApiBaseOverrides()[kind];
    if (overridden) return overridden;

    if (typeof window !== 'undefined') {
        const runtime = window.__FOLIA_RUNTIME_CONFIG__;
        const specific = runtime?.[`${kind}ApiBase`];
        if (typeof specific === 'string' && specific.trim()) {
            return specific.trim().replace(/\/$/, '');
        }
        const shared = runtime?.apiBase;
        if (typeof shared === 'string' && shared.trim()) {
            return shared.trim().replace(/\/$/, '');
        }
    }

    const envKey = kind === 'netease'
        ? 'VITE_NETEASE_API_BASE'
        : kind === 'kugou'
            ? 'VITE_KUGOU_API_BASE'
            : 'VITE_QQ_API_BASE';

    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.[envKey] || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.[envKey] || '')
        : '';

    return (viteValue || processValue).trim().replace(/\/$/, '');
};

/** 运行时地址是否来自原生侧（而不是构建变量）。设置里填的也算。 */
export const hasRuntimeApiBase = (kind: RuntimeApiBaseKind): boolean => {
    if (getApiBaseOverrides()[kind]) return true;
    if (typeof window === 'undefined') return false;
    const runtime = window.__FOLIA_RUNTIME_CONFIG__;
    if (!runtime) return false;
    const specific = runtime[`${kind}ApiBase`];
    if (typeof specific === 'string' && specific.trim()) return true;
    const shared = runtime.apiBase;
    return typeof shared === 'string' && Boolean(shared.trim());
};
