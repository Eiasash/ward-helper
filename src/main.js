import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';
const root = document.getElementById('root');
if (!root)
    throw new Error('root element missing');
ReactDOM.createRoot(root).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/ward-helper/sw.js').catch(() => { });
}
