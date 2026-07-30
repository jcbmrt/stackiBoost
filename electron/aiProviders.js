// multi-provider ai bridge — claude code, codex, gemini
// each is a locally installed cli the user logs into with their own subscription

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLAUDE_TOOLS =
  'Bash(npm install:*) Bash(npm run build:*) Bash(npx astro:*) WebFetch WebSearch';

function toolLabel(name, input = {}) {
  const rel = (p) => (typeof p === 'string' ? p.replace(/^.*\/src\//, 'src/') : '');
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return { verb: 'Editing', detail: rel(input.file_path) };
    case 'Write':
      return { verb: 'Writing', detail: rel(input.file_path) };
    case 'Read':
      return { verb: 'Reading', detail: rel(input.file_path) };
    case 'Bash':
      return { verb: 'Running', detail: (input.command || '').slice(0, 80) };
    case 'Glob':
    case 'Grep':
      return { verb: 'Searching', detail: input.pattern || '' };
    case 'TodoWrite':
      return { verb: 'Planning', detail: '' };
    case 'Task':
      return { verb: 'Working', detail: input.description || '' };
    case 'WebSearch':
      return { verb: 'Searching web', detail: input.query || '' };
    case 'WebFetch':
      return { verb: 'Fetching', detail: input.url || '' };
    default:
      return { verb: name, detail: '' };
  }
}

const PROVIDERS = {
  claude: {
    name: 'Claude Code',
    vendor: 'Anthropic',
    installUrl: 'https://claude.com/claude-code',
    loginHint: 'Run `claude` in a terminal and log in with your claude.ai account.',
    bins: ['claude'],
    extraDirs: [path.join(os.homedir(), '.claude', 'local')],
    supportsResume: true,
    args({ sessionId, systemPrompt }) {
      const a = [
        '-p',
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', CLAUDE_TOOLS,
      ];
      if (sessionId) a.push('--resume', sessionId);
      if (systemPrompt) a.push('--append-system-prompt', systemPrompt);
      return a;
    },
    stdinText: ({ prompt }) => prompt,
    testArgs: ['-p', 'Reply with exactly: ok', '--output-format', 'json', '--max-turns', '1'],
    onLine(line, emit) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      if (e.type === 'system' && e.subtype === 'init') emit({ kind: 'init', sessionId: e.session_id });
      else if (e.type === 'stream_event') {
        const ev = e.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta')
          emit({ kind: 'delta', text: ev.delta.text });
      } else if (e.type === 'assistant') {
        for (const b of e.message?.content || []) {
          if (b.type === 'text') emit({ kind: 'text', text: b.text });
          else if (b.type === 'tool_use') emit({ kind: 'tool', ...toolLabel(b.name, b.input) });
        }
      } else if (e.type === 'result') {
        emit({ kind: 'result', sessionId: e.session_id, error: e.is_error ? e.result || e.subtype : null });
      }
    },
  },

  codex: {
    name: 'Codex CLI',
    vendor: 'OpenAI',
    installUrl: 'https://developers.openai.com/codex/cli',
    loginHint: 'Install with `npm i -g @openai/codex`, then run `codex login` (ChatGPT account).',
    bins: ['codex'],
    extraDirs: [],
    supportsResume: true,
    args({ sessionId }) {
      const flags = ['--json', '--full-auto', '--skip-git-repo-check'];
      return sessionId ? ['exec', 'resume', ...flags, sessionId, '-'] : ['exec', ...flags, '-'];
    },
    stdinText: ({ prompt, systemPrompt, sessionId }) =>
      systemPrompt && !sessionId ? `${systemPrompt}\n\n${prompt}` : prompt,
    testArgs: ['exec', '--json', '--skip-git-repo-check', 'Reply with exactly: ok'],
    onLine(line, emit) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      if (e.type === 'thread.started' && e.thread_id) emit({ kind: 'init', sessionId: e.thread_id });
      else if (e.type === 'item.completed') {
        const it = e.item || {};
        if (it.type === 'agent_message' && it.text) emit({ kind: 'text', text: it.text });
        else if (it.type === 'command_execution')
          emit({ kind: 'tool', verb: 'Running', detail: (it.command || '').slice(0, 80) });
        else if (it.type === 'file_change' || it.type === 'patch_apply') {
          const files = (it.changes || []).map((c) => c.path).join(', ');
          emit({ kind: 'tool', verb: 'Editing', detail: files.slice(0, 80) });
        } else if (it.type === 'web_search')
          emit({ kind: 'tool', verb: 'Searching web', detail: it.query || '' });
      } else if (e.type === 'turn.completed') emit({ kind: 'result', error: null });
      else if (e.type === 'turn.failed' || e.type === 'error')
        emit({ kind: 'result', error: e.error?.message || e.message || 'Codex reported an error.' });
    },
  },

  gemini: {
    name: 'Gemini CLI',
    vendor: 'Google',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
    loginHint: 'Install with `npm i -g @google/gemini-cli`, then run `gemini` and sign in with Google.',
    bins: ['gemini'],
    extraDirs: [],
    supportsResume: false,
    args({ prompt, systemPrompt }) {
      return ['--yolo', '-p', systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt];
    },
    stdinText: null,
    testArgs: ['-p', 'Reply with exactly: ok'],
    onLine(line, emit) {
      // plain text output — the renderer finalizes the buffer on close
      emit({ kind: 'delta', text: line + '\n' });
    },
  },
};

function registerAiProviders({ ipcMain, send, ensureToolPath }) {
  let child = null;

  function resolveBin(p) {
    ensureToolPath();
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    dirs.push(
      path.join(os.homedir(), '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      ...p.extraDirs
    );
    for (const name of p.bins)
      for (const dir of dirs)
        for (const ext of exts) {
          const cand = path.join(dir, name + ext);
          try {
            if (fs.statSync(cand).isFile()) return cand;
          } catch {
            /* not here */
          }
        }
    return null;
  }

  const cleanErr = (s) =>
    String(s || '')
      .split('\n')
      .filter((l) => l.trim() && !/^\[STARTUP\]/.test(l))
      .slice(-6)
      .join('\n')
      .slice(0, 600);

  ipcMain.handle('ai:status', async () => {
    const providers = Object.entries(PROVIDERS).map(([id, p]) => ({
      id,
      name: p.name,
      vendor: p.vendor,
      installUrl: p.installUrl,
      loginHint: p.loginHint,
      bin: resolveBin(p),
    }));
    providers.forEach((p) => (p.available = !!p.bin));
    return { providers, running: !!child };
  });

  ipcMain.handle('ai:send', async (_e, { projectPath, prompt, sessionId, systemPrompt, provider = 'claude' }) => {
    const p = PROVIDERS[provider];
    if (!p) throw new Error(`Unknown provider: ${provider}`);
    const bin = resolveBin(p);
    if (!bin) throw new Error(`${p.name} is not installed. ${p.loginHint}`);
    if (child) throw new Error('The AI is already working — stop it first.');

    const opts = { prompt, sessionId: p.supportsResume ? sessionId : null, systemPrompt };
    child = spawn(bin, p.args(opts), {
      cwd: projectPath,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const proc = child;

    if (p.stdinText) proc.stdin.write(p.stdinText(opts));
    proc.stdin.end();

    const emit = (ev) => send('ai:event', ev);

    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.trim()) p.onLine(line, emit);
      }
    });

    let errText = '';
    proc.stderr.on('data', (chunk) => {
      errText = (errText + chunk.toString()).slice(-8000);
    });

    proc.on('error', (err) => {
      if (child === proc) child = null;
      emit({ kind: 'closed', code: -1, error: err.message });
    });

    proc.on('close', (code) => {
      if (child === proc) child = null;
      if (buf.trim()) p.onLine(buf, emit);
      emit({ kind: 'closed', code, error: code ? cleanErr(errText) || `exit ${code}` : null });
    });

    return { ok: true };
  });

  ipcMain.handle('ai:test', async (_e, { projectPath, provider = 'claude' } = {}) => {
    const p = PROVIDERS[provider];
    if (!p) return { ok: false, error: 'unknown provider' };
    const bin = resolveBin(p);
    if (!bin) return { ok: false, error: 'not-installed' };
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      const proc = spawn(bin, p.testArgs, {
        cwd: projectPath || os.homedir(),
        env: { ...process.env },
      });
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* gone */
        }
        resolve({ ok: false, error: 'Timed out after 90s.' });
      }, 90000);
      proc.stdout.on('data', (c) => (out += c));
      proc.stderr.on('data', (c) => (err += c));
      proc.on('error', (e2) => {
        clearTimeout(timer);
        resolve({ ok: false, error: e2.message });
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: cleanErr(err || out) || `exit ${code}` });
      });
    });
  });

  ipcMain.handle('ai:stop', async () => {
    if (!child) return { ok: true };
    const proc = child;
    child = null;
    try {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 1500).unref?.();
    } catch {
      /* already gone */
    }
    return { ok: true };
  });
}

module.exports = { registerAiProviders };
