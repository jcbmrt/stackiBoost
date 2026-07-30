import React, { useEffect, useState } from 'react';
import { SparkleIcon } from '../ui/Icons.jsx';

export default function SettingsPanel({ project }) {
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState(null); // null | 'running' | {ok, error, model}

  const refresh = () => {
    window.avb.aiStatus().then(setStatus).catch(() => setStatus({ available: false }));
  };
  useEffect(refresh, []);

  const runTest = async () => {
    setTest('running');
    try {
      setTest(await window.avb.aiTest({ projectPath: project?.path }));
    } catch (err) {
      setTest({ ok: false, error: err?.message || String(err) });
    }
  };

  return (
    <div className="settings-panel">
      <div className="panel-title">Settings</div>

      <div className="settings-section">
        <div className="settings-heading">
          <SparkleIcon size={14} /> AI — Claude
        </div>
        <p className="settings-note">
          The AI panel runs Claude Code on your machine with your own Claude subscription
          (Pro or Max) — no API key, billed like using Claude in the terminal.
        </p>

        <div className="settings-row">
          <span className="settings-label">Claude Code</span>
          {status === null ? (
            <span className="dim">checking…</span>
          ) : status.available ? (
            <span className="settings-ok">Installed</span>
          ) : (
            <span className="settings-bad">Not found</span>
          )}
        </div>
        {status?.available && <div className="settings-path">{status.bin}</div>}

        {status && !status.available && (
          <div className="settings-steps">
            <p>1. Install Claude Code:</p>
            <code>curl -fsSL https://claude.ai/install.sh | bash</code>
            <p>2. Log in with your Claude account (opens a browser):</p>
            <code>claude</code>
            <p>3. Come back here and re-check.</p>
            <div className="settings-actions">
              <button onClick={() => window.avb.openExternal('https://claude.com/claude-code')}>
                Get Claude Code
              </button>
              <button onClick={refresh}>Re-check</button>
            </div>
          </div>
        )}

        {status?.available && (
          <div className="settings-actions">
            <button onClick={runTest} disabled={test === 'running'}>
              {test === 'running' ? 'Testing…' : 'Test connection'}
            </button>
            <button className="ghost" onClick={refresh}>Re-check</button>
          </div>
        )}
        {test && test !== 'running' && (
          <div className={test.ok ? 'settings-ok' : 'settings-bad'} style={{ marginTop: 8 }}>
            {test.ok
              ? `Connected${test.model ? ` — ${test.model}` : ''}. You're good to go.`
              : `Not working: ${test.error === 'not-installed' ? 'Claude Code is not installed.' : test.error}`}
          </div>
        )}
        {test && test !== 'running' && !test.ok && /login|auth|credit|api key/i.test(test.error || '') && (
          <p className="settings-note">
            Run <code>claude</code> in a terminal once and log in with your claude.ai account, then test again.
          </p>
        )}
      </div>
    </div>
  );
}
