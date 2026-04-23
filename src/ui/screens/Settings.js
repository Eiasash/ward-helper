import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useApiKey, setPassphrase, getPassphrase, clearPassphrase } from '../hooks/useSettings';
export function Settings() {
    const { present, save, clear } = useApiKey();
    const [key, setKey] = useState('');
    const [pass, setPass] = useState('');
    const [msg, setMsg] = useState('');
    async function onSaveKey() {
        if (!key.startsWith('sk-ant-')) {
            setMsg('מפתח לא תקין');
            return;
        }
        await save(key);
        setKey('');
        setMsg('מפתח נשמר ✓');
    }
    function onSavePass() {
        if (pass.length < 8) {
            setMsg('סיסמה קצרה מדי');
            return;
        }
        setPassphrase(pass);
        setPass('');
        setMsg('סיסמה בזיכרון ✓');
    }
    async function onClearKey() {
        await clear();
        setMsg('מפתח נמחק');
    }
    return (_jsxs("section", { children: [_jsx("h1", { children: "\u05D4\u05D2\u05D3\u05E8\u05D5\u05EA" }), _jsx("h2", { children: "Anthropic API Key" }), _jsx("p", { children: present === null ? '...' : present ? '✓ מפתח מוגדר' : 'עדיין לא מוגדר' }), _jsx("input", { dir: "auto", placeholder: "sk-ant-...", value: key, onChange: (e) => setKey(e.target.value), style: { marginBottom: 8 } }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("button", { onClick: onSaveKey, children: "\u05E9\u05DE\u05D5\u05E8 \u05DE\u05E4\u05EA\u05D7" }), present && _jsx("button", { className: "ghost", onClick: onClearKey, children: "\u05DE\u05D7\u05E7" })] }), _jsx("h2", { children: "\u05E1\u05D9\u05E1\u05DE\u05EA \u05D2\u05D9\u05D1\u05D5\u05D9 (Supabase)" }), _jsx("p", { children: getPassphrase() ? '✓ פעילה (תפוג אחרי 15 דק׳)' : 'לא פעילה — הגיבוי לא ירוץ' }), _jsx("input", { type: "password", dir: "auto", value: pass, onChange: (e) => setPass(e.target.value), style: { marginBottom: 8 } }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("button", { onClick: onSavePass, children: "\u05D4\u05E4\u05E2\u05DC \u05E1\u05D9\u05E1\u05DE\u05D4" }), _jsx("button", { className: "ghost", onClick: clearPassphrase, children: "\u05E0\u05E7\u05D4 \u05E1\u05D9\u05E1\u05DE\u05D4" })] }), msg && _jsx("p", { style: { color: 'var(--muted)', marginTop: 24 }, children: msg })] }));
}
