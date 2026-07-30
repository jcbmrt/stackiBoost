// claude code bridge for the ai panel

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLAUDE_ARGS = [
  '-p',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--permission-mode', 'acceptEdits',
  '--allowedTools',
  'Bash(npm install:*) Bash(npm run build:*) Bash(npx astro:*) WebFetch WebSearch',
];

function registerClaudeAgent({ ipcMain, send, ensureToolPath }) {
  let child = null;

  // claude installs in different spots depending on how you got it
  function resolveClaudeBin() {
    ensureToolPath();
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    dirs.push(
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.claude', 'local'),
      '/opt/homebrew/bin',
      '/usr/local/bin'
    );
    for (const dir of dirs) {
      const p = path.join(dir, exe);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* not here */
      }
    }
    return null;
  }

  ipcMain.handle('ai:status', async () => {
    const bin = resolveClaudeBin();
    return { available: !!bin, bin, running: !!child };
  });

  ipcMain.handle('ai:send', async (_e, { projectPath, prompt, sessionId, systemPrompt }) => {
    const bin = resolveClaudeBin();
    if (!bin) throw new Error('Claude Code CLI not found. Install it from https://claude.com/claude-code and log in once from a terminal.');
    if (child) throw new Error('Claude is already working — stop it first.');

    const args = [...CLAUDE_ARGS];
    if (sessionId) args.push('--resume', sessionId);
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

    child = spawn(bin, args, {
      cwd: projectPath,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const proc = child;

    // prompt over stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    // ndjson, one event per line
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          send('ai:event', JSON.parse(line));
        } catch {
          send('ai:event', { type: 'stderr', text: line });
        }
      }
    });

    let errText = '';
    proc.stderr.on('data', (chunk) => {
      errText = (errText + chunk.toString()).slice(-4000);
    });

    proc.on('error', (err) => {
      if (child === proc) child = null;
      send('ai:event', { type: 'closed', code: -1, error: err.message });
    });

    proc.on('close', (code) => {
      if (child === proc) child = null;
      send('ai:event', { type: 'closed', code, error: code ? errText.trim() : null });
    });

    return { ok: true };
  });

  // quick round-trip to prove install + login work
  ipcMain.handle('ai:test', async (_e, { projectPath } = {}) => {
    const bin = resolveClaudeBin();
    if (!bin) return { ok: false, error: 'not-installed' };
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      const proc = spawn(bin, ['-p', 'Reply with exactly: ok', '--output-format', 'json', '--max-turns', '1'], {
        cwd: projectPath || os.homedir(),
        env: { ...process.env },
      });
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* gone */ }
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
        try {
          const json = JSON.parse(out.trim().split('\n').pop());
          if (json.is_error) resolve({ ok: false, error: json.result || 'Claude returned an error.' });
          else resolve({ ok: true, model: json.modelUsage ? Object.keys(json.modelUsage)[0] : null });
        } catch {
          resolve({ ok: false, error: (err || out || `exit ${code}`).trim().slice(0, 500) });
        }
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

module.exports = { registerClaudeAgent };
