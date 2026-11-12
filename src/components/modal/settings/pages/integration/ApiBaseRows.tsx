import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getApiBaseOverrides,
    isUsableApiBase,
    probeApiBase,
    saveApiBaseOverrides,
    subscribeApiBaseOverrides,
    type ApiBaseKind,
    type ApiBaseOverrides,
} from '../../../../../services/apiBaseConfig';
import { Button, Row, Status, TextField } from '../../kit';
import { O } from './options';

// src/components/modal/settings/pages/integration/ApiBaseRows.tsx
// The music API addresses of the 连接与集成 page: one field per platform, the test and the save.
// The fields are a draft until they are saved, like the sync server's, because an address that is
// half typed would send every request of the app somewhere that does not exist.

/** The three platforms, in the order the rows are drawn. */
const KINDS: readonly ApiBaseKind[] = ['netease', 'kugou', 'qq'];

/** What the last test said about one row. */
type ProbeState = 'idle' | 'testing' | 'reachable' | 'unreachable';

const PLACEHOLDER: Record<ApiBaseKind, string> = {
    netease: 'http://192.168.1.10:3000',
    kugou: 'http://192.168.1.10:3310',
    qq: 'http://192.168.1.10:3320',
};

const OPTION: Record<ApiBaseKind, typeof O.apiBase> = {
    netease: O.neteaseApiBase,
    kugou: O.kugouApiBase,
    qq: O.qqApiBase,
};

export const ApiBaseRows: React.FC = () => {
    const { t } = useTranslation();
    const [saved, setSaved] = useState<ApiBaseOverrides>(getApiBaseOverrides);
    const [draft, setDraft] = useState<ApiBaseOverrides>(getApiBaseOverrides);
    const [probe, setProbe] = useState<Record<ApiBaseKind, ProbeState>>({ netease: 'idle', kugou: 'idle', qq: 'idle' });
    const [testing, setTesting] = useState(false);
    const [savedNote, setSavedNote] = useState(false);

    // Saving elsewhere (a second window, the storage of another profile) shows up here too.
    useEffect(() => subscribeApiBaseOverrides(() => {
        const next = getApiBaseOverrides();
        setSaved(next);
        setDraft(next);
    }), []);

    const dirty = KINDS.some(kind => draft[kind].trim() !== saved[kind]);
    const invalid = KINDS.find(kind => draft[kind].trim() !== '' && !isUsableApiBase(draft[kind]));

    const update = (kind: ApiBaseKind, value: string) => {
        setDraft(current => ({ ...current, [kind]: value }));
        setProbe(current => ({ ...current, [kind]: 'idle' }));
        setSavedNote(false);
    };

    const runTest = async () => {
        setTesting(true);
        const filled = KINDS.filter(kind => draft[kind].trim() !== '');
        setProbe(Object.fromEntries(
            KINDS.map(kind => [kind, filled.includes(kind) ? 'testing' : 'idle']),
        ) as Record<ApiBaseKind, ProbeState>);
        await Promise.all(filled.map(async (kind) => {
            const reachable = await probeApiBase(draft[kind]);
            setProbe(current => ({ ...current, [kind]: reachable ? 'reachable' : 'unreachable' }));
        }));
        setTesting(false);
    };

    const save = () => {
        saveApiBaseOverrides(draft);
        setSavedNote(true);
    };

    const probeText = (kind: ApiBaseKind) => {
        const state = probe[kind];
        if (state === 'testing') return t('options.apiBaseTesting');
        if (state === 'reachable') return t('options.apiBaseReachable');
        if (state === 'unreachable') return t('options.apiBaseUnreachable');
        return null;
    };

    return (
        <>
            <Row option={O.apiBase} hint={t('options.apiBaseDesc')}>
                {savedNote && <Status tone="ok">{t('options.apiBaseSaved')}</Status>}
            </Row>
            {KINDS.map((kind) => {
                const text = probeText(kind);
                return (
                    <Row
                        key={kind}
                        sub
                        option={OPTION[kind]}
                        hint={invalid === kind ? t('options.apiBaseInvalid') : undefined}
                    >
                        <TextField
                            type="url"
                            value={draft[kind]}
                            onChange={value => update(kind, value)}
                            placeholder={PLACEHOLDER[kind]}
                        />
                        {text && (
                            <Status tone={probe[kind] === 'reachable' ? 'ok' : probe[kind] === 'unreachable' ? 'warn' : undefined}>
                                {text}
                            </Status>
                        )}
                    </Row>
                );
            })}
            <Row sub label={t('options.apiBaseSaveHint')}>
                <Button onClick={() => void runTest()} disabled={testing || KINDS.every(kind => draft[kind].trim() === '')}>
                    {testing ? t('options.apiBaseTesting') : t('options.apiBaseTest')}
                </Button>
                <Button variant="primary" onClick={save} disabled={!dirty || Boolean(invalid)}>
                    {t('options.apiBaseSave')}
                </Button>
            </Row>
        </>
    );
};

export default ApiBaseRows;
