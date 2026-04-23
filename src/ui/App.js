import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Capture } from './screens/Capture';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
export function App() {
    return (_jsxs(HashRouter, { children: [_jsx("main", { className: "shell", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Capture, {}) }), _jsx(Route, { path: "/history", element: _jsx(History, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) }), _jsx(Route, { path: "*", element: _jsx(Capture, {}) })] }) }), _jsxs("nav", { className: "bottom-nav", children: [_jsx(NavLink, { to: "/", end: true, children: "\u05E6\u05DC\u05DD" }), _jsx(NavLink, { to: "/history", children: "\u05D4\u05D9\u05E1\u05D8\u05D5\u05E8\u05D9\u05D4" }), _jsx(NavLink, { to: "/settings", children: "\u05D4\u05D2\u05D3\u05E8\u05D5\u05EA" })] })] }));
}
