import { describe, it, expect, beforeEach } from 'vitest';
import { putPatient, putNote, listPatients, listNotes, getSettings, setSettings, resetDbForTests, } from '@/storage/indexed';
import { encryptForCloud, decryptFromCloud } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
beforeEach(async () => {
    await resetDbForTests();
    await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('ward-helper');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
    });
});
describe('indexeddb schema', () => {
    it('stores and retrieves a patient', async () => {
        await putPatient({
            id: 'p1',
            name: 'דוד כהן',
            teudatZehut: '012345678',
            dob: '1944-03-01',
            room: '3-12',
            tags: [],
            createdAt: 1,
            updatedAt: 1,
        });
        const list = await listPatients();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('דוד כהן');
    });
    it('stores and retrieves a note keyed by patientId', async () => {
        await putNote({
            id: 'n1',
            patientId: 'p1',
            type: 'admission',
            bodyHebrew: 'קבלה...',
            structuredData: {},
            createdAt: 1,
            updatedAt: 1,
        });
        const notes = await listNotes('p1');
        expect(notes).toHaveLength(1);
    });
    it('settings is a keyed singleton', async () => {
        await setSettings({
            apiKeyXor: new Uint8Array([1, 2]),
            deviceSecret: new Uint8Array([3, 4]),
            lastPassphraseAuthAt: null,
            prefs: {},
        });
        const s = await getSettings();
        expect(s?.apiKeyXor[0]).toBe(1);
    });
});
describe('cloud encryption boundary', () => {
    it('encryptForCloud produces opaque bytes', async () => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveAesKey('pass', salt);
        const record = { id: 'p1', name: 'דוד כהן', teudatZehut: '012345678' };
        const sealed = await encryptForCloud(record, key, salt);
        const asString = new TextDecoder('utf-8', { fatal: false }).decode(sealed.ciphertext);
        expect(asString).not.toContain('דוד');
        expect(asString).not.toContain('012345678');
    });
    it('round-trips through encryptForCloud -> decryptFromCloud', async () => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveAesKey('pass', salt);
        const record = { id: 'n1', bodyHebrew: 'קבלה של מטופל' };
        const sealed = await encryptForCloud(record, key, salt);
        const back = await decryptFromCloud(sealed.ciphertext, sealed.iv, key);
        expect(back).toEqual(record);
    });
});
