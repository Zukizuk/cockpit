// Ported from a Claude Code mod (the deliverables tray): plain functions, no engine calls.
// Reads one assistant reply for what you would want to copy or open: shell commands, email and Slack
// drafts, links, a pickup prompt for a handoff note, and the file paths the reply names. Plain functions with
// no engine calls, so the tests can feed them real replies.
const MAX_TEXT = 200000;
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})[ \t]*([^`]*?)[ \t]*$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const QUOTE_LINE = /^\s{0,3}>\s?(.*)$/;
/** The reply as fenced blocks, quoted blocks and the prose between. A block knows the two prose lines before it (its introduction). */
export function segments(reply) {
    const lines = String(reply ?? '').slice(0, MAX_TEXT).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let prose = [];
    let quote = null;
    let quoteIntro = '';
    let recent = [];
    const flushProse = () => {
        if (prose.length)
            out.push({ kind: 'prose', lines: prose });
        prose = [];
    };
    const flushQuote = () => {
        if (quote)
            out.push({ kind: 'quote', body: quote.join('\n'), intro: quoteIntro });
        quote = null;
    };
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        const open = FENCE_OPEN.exec(line);
        if (open) {
            flushQuote();
            flushProse();
            const indent = (open[1] ?? '').length;
            const fence = open[2] ?? '```';
            const lang = ((open[3] ?? '').trim().split(/[\s{,]/)[0] ?? '').replace(/^\./, '').toLowerCase();
            const strip = indent ? new RegExp('^[ \\t]{0,' + indent + '}') : null;
            const body = [];
            let j = i + 1;
            for (; j < lines.length; j += 1) {
                const l = lines[j] ?? '';
                const close = FENCE_CLOSE.exec(l);
                if (close && (close[1] ?? '')[0] === fence[0] && (close[1] ?? '').length >= fence.length)
                    break;
                body.push(strip ? l.replace(strip, '') : l);
            }
            out.push({ kind: 'fence', lang, body: body.join('\n'), intro: recent.join('\n') });
            i = j;
            continue;
        }
        const q = QUOTE_LINE.exec(line);
        if (q) {
            flushProse();
            if (!quote) {
                quote = [];
                quoteIntro = recent.join('\n');
            }
            quote.push(q[1] ?? '');
            continue;
        }
        flushQuote();
        prose.push(line);
        if (line.trim())
            recent = [...recent, line.trim()].slice(-2);
    }
    flushQuote();
    flushProse();
    return out;
}
// ---- commands ----------------------------------------------------------------------------------------------
const SHELL_LANGS = new Set([
    'bash', 'sh', 'shell', 'zsh', 'powershell', 'pwsh', 'ps1', 'cmd', 'bat', 'batch', 'console', 'terminal',
    'shell-session', 'shellsession', 'sh-session', 'bash-session',
]);
// Blocks that hold plain text: untagged, or tagged as text. Prompts, drafts and bare commands live here.
const PLAIN_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'markdown', 'md', 'email', 'mail', 'slack', 'message', 'draft', 'quote']);
// Programs a command line starts with. The first group are tool names nobody writes in prose; the second are
// plain words ("copy", "start", "find") that count only when the line also has a flag, a path or an operator.
const TOOLS = new Set([
    'git', 'gh', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'py', 'pip', 'pip3',
    'pipx', 'uv', 'uvx', 'poetry', 'conda', 'cd', 'ls', 'dir', 'cat', 'pwd', 'echo', 'mkdir', 'rm', 'cp', 'mv', 'rmdir',
    'touch', 'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'docker', 'docker-compose', 'kubectl', 'helm', 'az', 'aws',
    'gcloud', 'claude', 'codex', 'powershell', 'pwsh', 'cmd', 'bash', 'sh', 'zsh', 'sudo', 'systemctl', 'journalctl',
    'tail', 'head', 'grep', 'rg', 'sed', 'awk', 'chmod', 'chown', 'cargo', 'rustup', 'dotnet', 'java', 'mvn', 'gradle',
    'terraform', 'ansible', 'psql', 'sqlcmd', 'sqlite3', 'mysql', 'pytest', 'tsc', 'eslint', 'prettier', 'vite', 'whoami',
    'export', 'source', 'explorer', 'notepad', 'tasklist', 'taskkill', 'ping', 'nslookup', 'ipconfig', 'netstat', 'winget',
    'choco', 'scoop', 'brew', 'apt', 'apt-get', 'yum', 'dnf', 'tar', 'unzip', 'jq', 'yq', 'xargs', 'wsl', 'ollama',
    'litellm', 'fab', 'python.exe', 'pbcopy', 'clip', 'pre-commit', 'nvm', 'fnm', 'rustc', 'make', 'cmake',
]);
const WORDS = new Set([
    'copy', 'move', 'type', 'start', 'set', 'find', 'sort', 'open', 'date', 'clear', 'history', 'man', 'code', 'where',
    'which', 'del', 'md', 'env', 'kill', 'ps', 'top', 'df', 'du', 'free', 'diff', 'patch', 'zip', 'go', 'next', 'ng', 'sleep',
    'service', 'tee', 'more', 'less', 'wc', 'uniq', 'test', 'run', 'time',
]);
const CMDLET = /^[A-Z][a-z]+-[A-Z][A-Za-z]+$/;
const OUTPUT_WORD = /^(ERR!|WARN|warn|error:?|Error:?|fatal:|info:|usage:|Usage:|FAILED|PASSED|OK)$/;
const FEATURE = /(^|\s)-{1,2}[A-Za-z]|[\\/|&<>=$"']|\.\w{1,5}(\s|$)/;
// What follows an everyday word ("copy", "start") when it is a command: a flag, a path, an address, a file name or X=y
const ARGISH = /^(-{1,2}[A-Za-z]|[\\/.~%$"']|[A-Za-z]:[\\/]|https?:|[\w.-]+\.\w{1,5}(\s|$)|\w+=)/;
function firstToken(line) {
    const quoted = /^(["'])(.*?)\1\s*(.*)$/.exec(line);
    if (quoted)
        return { token: quoted[2] ?? '', rest: quoted[3] ?? '' };
    const m = /^(\S+)\s*(.*)$/.exec(line);
    return { token: m?.[1] ?? '', rest: m?.[2] ?? '' };
}
/** A shell prompt at the very start of a line: "$ ", "PS C:\x> ", "C:\x> " or "> ". Its style and what follows it, else null. */
function promptOf(line) {
    const table = [
        ['$', /^\$\s+(\S.*)$/],
        ['ps', /^PS(?: [^>]*)?>\s*(\S.*)$/],
        ['cmd', /^[A-Za-z]:\\[^>]*>\s*(\S.*)$/],
        ['>', /^>\s+(\S.*)$/],
    ];
    for (const [style, re] of table) {
        const m = re.exec(line);
        if (m)
            return { style, rest: m[1] ?? '' };
    }
    return null;
}
const promptRest = (line) => promptOf(line)?.rest ?? null;
const isComment = (line) => /^\s*(#|REM\s|::|\/\/)/i.test(line);
const endsOpen = (line) => /(\\|\^|`|\|\||&&|\|)\s*$/.test(line);
/** Whether one line reads as a command a person would run, not a sentence or output. */
export function isCommandLine(raw) {
    const line = (promptRest(raw) ?? raw).trim();
    if (!line || isComment(line))
        return false;
    let { token, rest } = firstToken(line);
    // FOO=bar git push: skip leading variable assignments
    while (/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(token) && rest)
        ({ token, rest } = firstToken(rest));
    const next = (rest.split(/\s+/)[0] ?? '');
    if (OUTPUT_WORD.test(next))
        return false;
    const words = line.split(/\s+/).length;
    const prose = /[.?!]$/.test(line) && words >= 7 && !FEATURE.test(line);
    if (prose)
        return false;
    const lower = token.toLowerCase();
    if (TOOLS.has(lower) || CMDLET.test(token))
        return true;
    if (/^\.{1,2}[\\/]\S/.test(token) || /^~[\\/]\S/.test(token))
        return true;
    // a program path with arguments: "C:/x/python.exe" script.py --flag
    if (/^([A-Za-z]:[\\/]|\/)[^\s]*\.(exe|bat|cmd|ps1|sh|py)$/i.test(token) && rest)
        return true;
    if (WORDS.has(lower))
        return ARGISH.test(rest);
    return false;
}
/**
 * The prompt style a block opens with ("$ git status", then its output), or '' when it is not a session
 * transcript. Only then are the lines with that prompt the commands; "npm test" prints "> pkg@1.0.0 test" lines
 * that a "$" transcript must not take for commands.
 */
function transcriptStyle(lines) {
    const first = lines.find((l) => l.trim() && !isComment(l));
    return (first !== undefined && promptOf(first)?.style) || '';
}
const promptLines = (lines, style) => lines.map((l) => (promptOf(l)?.style === style ? promptOf(l)?.rest ?? '' : null)).filter((p) => p !== null);
/** Whether a whole untagged block is commands, one per line (continuation lines and comments allowed). */
export function looksLikeCommands(body) {
    const lines = body.split('\n').filter((l) => l.trim());
    if (!lines.length)
        return false;
    // a session transcript: the prompt lines are the commands, the rest is what they printed
    const style = transcriptStyle(lines);
    if (style)
        return promptLines(lines, style).some((l) => isCommandLine(l));
    let seen = 0;
    let continued = false;
    for (const line of lines) {
        if (isComment(line))
            continue;
        if (continued) {
            continued = endsOpen(line);
            continue;
        }
        if (!isCommandLine(line))
            return false;
        seen += 1;
        continued = endsOpen(line);
    }
    return seen > 0;
}
/** The text to copy for a shell block: when it is a session transcript, the commands without their output. */
export function commandText(body) {
    const lines = body.replace(/\s+$/, '').split('\n');
    const style = transcriptStyle(lines);
    const kept = style ? promptLines(lines, style) : lines;
    return kept.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
}
function commandLabel(text) {
    const lines = text.split('\n').filter((l) => l.trim());
    const first = lines.find((l) => !isComment(l)) ?? lines[0] ?? '';
    return { label: first.trim(), extra: Math.max(0, lines.length - 1) };
}
// ---- drafts and prompts -------------------------------------------------------------------------------------
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;
const firstLineOf = (s) => (s.split('\n').find((l) => l.trim()) ?? '').trim();
// The first line with markdown marks off the front: "*Daily Update - (05-10)*" reads "Daily Update - (05-10)*"
const headOf = (s) => firstLineOf(s).replace(/^[\s>*_`#-]+/, '');
// The words that introduce a draft. The first group is the common list; the second counts only when the block
// reads as a message (several sentences).
const STRONG_CUE = /\b(draft(s|ed)?|e-?mails?|slack message|message to)\b/i;
const WEAK_CUE = /\b(dm|reply|message|slack|post|note to|wording)\b/i;
const RUN_CUE = /\b(run|paste|type|execute|terminal|command|shell|powershell|prompt)\b/i;
function proseLike(body) {
    return wordCount(body) >= 12 && /[.!?](\s|$)/.test(body);
}
/** The words that introduce a block: the line right before it, and the one before that when this one is only a lead-in ("It reads:"). */
function lead(intro) {
    const lines = intro.split('\n');
    const last = lines[lines.length - 1] ?? '';
    const before = lines.length > 1 ? (lines[lines.length - 2] ?? '') : '';
    return last.length <= 48 ? `${before} ${last}` : last;
}
/** Whether a block is an email, Slack message or similar text to send: it starts like one, or is introduced as one. */
export function isDraft(body, intro) {
    const head = headOf(body);
    if (!head)
        return false;
    if (/^subject\s*:/i.test(head))
        return true;
    if (/^daily update\b/i.test(head))
        return true;
    if (/^(hi|hello|hey|dear|good (morning|afternoon|evening))\b/i.test(head) && wordCount(body) >= 12)
        return true;
    if (looksLikeCommands(body))
        return false;
    const words = lead(intro);
    if (STRONG_CUE.test(words))
        return true;
    return WEAK_CUE.test(words) && proseLike(body);
}
/** The hub handoff note a "Pick up ..." style prompt names (its file name), or '' when the text is not one. */
export function pickupNote(body) {
    if (!/^\s*(pick up|pickup|read|continue|resume|take over|start from)\b/i.test(body))
        return '';
    return /(?:hub|agent-shared)[\\/]handoff[\\/]([^\s"'`()\\/]+?\.md)/i.exec(body)?.[1] ?? '';
}
/** A hard-wrapped paragraph as one line, paragraphs kept apart; lists and short lines are left alone. */
export function unwrapParagraphs(text) {
    return text
        .replace(/\s+$/, '')
        .split(/\n{2,}/)
        .map((para) => {
        const lines = para.split('\n');
        return lines.some((l) => /^\s*([-*•]|\d+[.)])\s/.test(l)) ? para : lines.map((l) => l.trim()).join(' ');
    })
        .join('\n\n');
}
function draftLabel(body) {
    const lines = body.split('\n').map((l) => l.replace(/^[\s>*_`#-]+/, '').replace(/[*`]+/g, '').trim()).filter(Boolean);
    const subject = lines.slice(0, 3).find((l) => /^subject\s*:/i.test(l));
    if (subject)
        return subject;
    const first = lines[0] ?? '';
    return first.length < 24 && lines[1] ? first + ' ' + lines[1] : first;
}
// ---- links and file paths ---------------------------------------------------------------------------------
const LOCAL_HOST = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1?\]|.+\.localhost)$/i;
const PLACEHOLDER_HOST = /(^|\.)example\.(com|org|net)$|\.(test|invalid|example)$/i;
const REAL_HOST = /^(localhost|\[[0-9a-f:.]+\]|\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;
const count = (s, ch) => s.split(ch).length - 1;
function cleanUrl(raw) {
    let u = raw;
    // a "]" ends a markdown link's text; an IPv6 host's own brackets stay
    const hostEnd = /^https?:\/\/\[[^\]]*\]/.exec(u)?.[0].length ?? 0;
    const close = u.indexOf(']', hostEnd);
    if (close >= 0)
        u = u.slice(0, close);
    for (;;) {
        const before = u;
        u = u.replace(/[.,;:!?*_'"}>\u2026\u201d\u2019\u00bb]+$/, '');
        if (u.endsWith(')') && count(u, '(') < count(u, ')'))
            u = u.slice(0, -1);
        if (u === before)
            return u;
    }
}
function shortUrl(url) {
    return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
/** Web addresses in some text, in order, without repeats; localhost ones only when there is no other. */
export function findLinks(text) {
    const found = [];
    const seen = new Set();
    const re = /https?:\/\/[^\s<>"'`]+/g;
    let m;
    while ((m = re.exec(text))) {
        const url = cleanUrl(m[0]);
        let host = '';
        try {
            host = new URL(url).hostname;
        }
        catch {
            continue;
        }
        if (!REAL_HOST.test(host) || PLACEHOLDER_HOST.test(host))
            continue;
        const key = url.replace(/\/+$/, '');
        if (seen.has(key))
            continue;
        seen.add(key);
        const text0 = /\[([^\]\n]{1,120})\]\(<?$/.exec(text.slice(Math.max(0, m.index - 130), m.index))?.[1]?.trim() ?? '';
        found.push({ url, label: text0 && !/^https?:/i.test(text0) ? text0 : shortUrl(url) });
    }
    const remote = found.filter((l) => !LOCAL_HOST.test(new URL(l.url).hostname));
    return remote.length ? remote : found;
}
const DOC_EXT = 'md|txt|json|csv|tsv|xlsx|xls|docx|doc|pptx|ppt|pdf|html|htm|png|jpg|jpeg|svg|gif|py|ts|tsx|js|mjs|sql|yaml|yml|toml|ps1|sh|bat|ipynb|zip';
const WIN_PATH = /^[A-Za-z]:[\\/]/;
const HAS_EXT = /\.[A-Za-z0-9]{1,8}$/;
/** A token from the reply as a file path worth looking for, or '' (a word, a URL, a command). */
export function asPathCandidate(token) {
    let t = token.trim().replace(/^<|>$/g, '').replace(/^["']|["']$/g, '');
    if (/^file:\/\/\//i.test(t))
        t = t.replace(/^file:\/\/\//i, '');
    t = t.replace(/#L?\d+(-L?\d+)?$/, '');
    if (/%[0-9a-fA-F]{2}/.test(t)) {
        try {
            t = decodeURIComponent(t);
        }
        catch {
            // keep it as written
        }
    }
    t = t.replace(/:\d+(:\d+)?$/, '').replace(/[.,;)]+$/, '');
    if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(mailto|slack|tel):/i.test(t) || /[\n*?<>|]/.test(t))
        return '';
    if (!HAS_EXT.test(t))
        return '';
    if (WIN_PATH.test(t) || /^~[\\/]/.test(t))
        return t;
    if (/^\/[^\s/][^\s]*\/[^\s]*$/.test(t))
        return t;
    if (/\s/.test(t))
        return '';
    if (/[\\/]/.test(t))
        return t;
    return new RegExp('\\.(' + DOC_EXT + ')$', 'i').test(t) ? t : '';
}
/** File paths a stretch of prose names: markdown link targets, `code spans` and bare drive or ~ paths. */
export function findPaths(text) {
    const found = [];
    const add = (raw) => {
        const p = asPathCandidate(raw);
        if (p && !found.includes(p))
            found.push(p);
    };
    let m;
    const link = /\]\(<?([^)>\n]+?)>?\)/g;
    while ((m = link.exec(text)))
        add(m[1] ?? '');
    const code = /`([^`\n]{3,260})`/g;
    while ((m = code.exec(text)))
        add(m[1] ?? '');
    const bare = /(?:^|[\s(])([A-Za-z]:[\\/][^\s`"'<>|*?]+|~\/[^\s`"'<>|*?]+)/g;
    while ((m = bare.exec(text)))
        add(m[1] ?? '');
    return found.slice(0, 40);
}
// ---- the whole reply --------------------------------------------------------------------------------------
/**
 * What one reply holds: commands (a shell block, or an untagged block of command lines), drafts, a pickup
 * prompt for each handoff note named in `notes`, the links in what is left, and the file paths it names.
 */
export function extractReply(reply, opts = {}) {
    const notes = (opts.notes ?? []).filter(Boolean);
    const out = { commands: [], drafts: [], prompts: [], links: [], paths: [] };
    const rest = [];
    const seen = new Set();
    const once = (kind, text) => {
        const key = kind + '\u0000' + text;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    };
    const addCommand = (body) => {
        const text = commandText(body);
        if (!text || !text.split('\n').some((l) => l.trim() && !isComment(l)))
            return false;
        if (once('command', text))
            out.commands.push({ text, ...commandLabel(text) });
        return true;
    };
    const addDraft = (body) => {
        const text = body.replace(/^\s*\n/, '').replace(/\s+$/, '');
        if (text && once('draft', text))
            out.drafts.push({ text, label: draftLabel(text) });
    };
    for (const seg of segments(reply)) {
        if (seg.kind === 'prose') {
            rest.push(seg.lines.join('\n'));
        }
        else if (seg.kind === 'quote') {
            if (isDraft(seg.body, seg.intro))
                addDraft(seg.body);
            else
                rest.push(seg.body);
        }
        else if (SHELL_LANGS.has(seg.lang)) {
            if (!addCommand(seg.body))
                rest.push(seg.body);
        }
        else if (PLAIN_LANGS.has(seg.lang)) {
            // the model's own pickup prompt: a "Pick up ..." block, or any block naming a note written this turn
            const named = pickupNote(seg.body) || (notes.find((n) => seg.body.toLowerCase().includes(n.toLowerCase())) ?? '');
            if (named) {
                if (once('prompt', named.toLowerCase()))
                    out.prompts.push({ note: named, text: unwrapParagraphs(seg.body.replace(/^\s*\n/, '')) });
            }
            else if (isDraft(seg.body, seg.intro)) {
                addDraft(seg.body);
            }
            else if ((seg.lang === '' || RUN_CUE.test(lead(seg.intro))) && looksLikeCommands(seg.body)) {
                addCommand(seg.body);
            }
            else {
                rest.push(seg.body);
            }
        }
        // a block in any other language (python, json, sql ...) is a code sample: neither a deliverable nor a source of links
    }
    const prose = rest.join('\n');
    out.links = findLinks(prose);
    out.paths = findPaths(prose);
    return out;
}
