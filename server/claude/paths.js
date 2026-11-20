// Ported from a Claude Code mod (the deliverables tray): plain functions, no engine calls.
// Path helpers for the tray: one comparable form of a path, which paths are noise, which files are
// hub handoff notes, and how a path reads in a row. No engine calls: the tests run these directly.
/** Forward slashes only. */
export const slashes = (p) => String(p ?? '').replace(/\\/g, '/');
/** A drive path (C:\... or C:/...) or a UNC share (\\server\share): the Windows kind. */
export function isWindowsPath(p) {
    return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p);
}
/** Forward slashes, `.` and `..` folded away, no trailing slash. Case is kept. */
export function fold(p) {
    const s = slashes(p);
    const lead = s.startsWith('//') ? '//' : s.startsWith('/') ? '/' : '';
    const parts = [];
    for (const part of s.split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..') {
            const last = parts[parts.length - 1];
            if (last !== undefined && last !== '..' && !/^[A-Za-z]:$/.test(last))
                parts.pop();
            else if (!lead && (last === undefined || last === '..'))
                parts.push('..'); // a relative path may climb
            continue;
        }
        parts.push(part);
    }
    return lead + parts.join('/');
}
/** One comparable form of a path. A Windows path is lower-cased, since Windows ignores case. */
export function pathKey(p) {
    const folded = fold(p);
    return isWindowsPath(p) ? folded.toLowerCase() : folded;
}
/** How a path is shown and copied: backslashes for a Windows path, as typed into Explorer or PowerShell. */
export function nativePath(p) {
    const folded = fold(p);
    if (!isWindowsPath(p))
        return folded;
    const win = folded.replace(/\//g, '\\');
    return /^[A-Za-z]:$/.test(win) ? win + '\\' : win;
}
export function baseName(p) {
    const parts = slashes(p).split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
}
/** The extension without its dot, lower case ('' when there is none). */
export function extOf(p) {
    const name = baseName(p);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
/** Temp and scratchpad folders, node_modules and the engine's own .claude folder (except its mods) are not deliverables. */
export function isNoise(p) {
    const s = '/' + fold(p).toLowerCase().replace(/^\/+/, '');
    if (s.includes('/appdata/local/temp/') || s.includes('/scratchpad/') || s.includes('/node_modules/'))
        return true;
    if (s.startsWith('/tmp/') || s.startsWith('/var/tmp/') || s.includes('/windows/temp/'))
        return true;
    const at = s.indexOf('/.claude/');
    if (at >= 0)
        return !s.slice(at + '/.claude/'.length).startsWith('mods/');
    return false;
}
/** The file name when the path is a note in the hub's handoff folder (not its README or an acknowledgement), else ''. */
export function handoffFile(p) {
    const m = /(?:^|\/)(?:hub|agent-shared)\/handoff\/([^/]+\.md)$/i.exec(slashes(p));
    if (!m)
        return '';
    const name = m[1] ?? '';
    if (/^readme\.md$/i.test(name) || /^ack-/i.test(name) || /\.conflict-[0-9a-f]+\.md$/i.test(name))
        return '';
    return name;
}
/** The folder a file is in, as the last two folders: "hub/handoff". The home folder reads "~". */
export function shortDir(p, home = '') {
    const folded = fold(p);
    const dir = folded.slice(0, Math.max(0, folded.lastIndexOf('/')));
    if (home && pathKey(dir) === pathKey(home))
        return '~';
    return dir.split('/').filter(Boolean).slice(-2).join('/');
}
// Files that Windows runs when they are opened (or hands to a macro-enabled Office): the tray offers Reveal and
// Copy for these but never Open, so a press cannot start a script a model wrote.
const RUNS = new Set([
    'exe', 'com', 'bat', 'cmd', 'scr', 'pif', 'msi', 'msp', 'msix', 'appx', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
    'hta', 'cpl', 'reg', 'lnk', 'url', 'jar', 'py', 'pyw', 'ps1', 'psm1', 'psd1', 'sh', 'bash', 'zsh', 'fish', 'dll',
    'sys', 'inf', 'scf', 'gadget', 'application', 'xlsm', 'docm', 'pptm', 'xlam', 'dotm', 'xltm', 'potm', 'ppam', 'ppsm', 'sldm',
]);
/** Whether pressing Open on this file is safe: it is a document or data file, not something Windows would run. */
export function isSafeToOpen(p) {
    return !RUNS.has(extOf(p));
}
