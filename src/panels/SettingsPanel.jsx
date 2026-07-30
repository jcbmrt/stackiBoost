import React, { useEffect, useState } from 'react';
import { SparkleIcon } from '../ui/Icons.jsx';

export default function SettingsPanel({ project }) {
  const [providers, setProviders] = useState(null);
  const [tests, setTests] = useState({}); // id -> 'running' | {ok, error}

  const refresh = () => {
    window.avb
      .aiStatus()
      .then((s) => setProviders(s.providers))
      .catch(() => setProviders([]));
  };
  useEffect(refresh, []);

  const runTest = async (id) => {
    setTests((t) => ({ ...t, [id]: 'running' }));
    try {
      const res = await window.avb.aiTest({ projectPath: project?.path, provider: id });
      setTests((t) => ({ ...t, [id]: res }));
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: err?.message || String(err) } }));
    }
  };

  return (
    <div className="settings-panel">
      <div className="panel-title">Settings</div>

      <div className="settings-section">
        <div className="settings-heading">
          <SparkleIcon size={14} /> Connected models
        </div>
        <p className="settings-note">
          The AI panel runs whichever coding CLI you have installed and logged into —
          your own subscriptions, no API keys. Pick the model in the chat's dropdown.
        </p>

        {providers === null && <span className="dim">checking…</span>}
        {providers?.map((p) => {
          const test = tests[p.id];
          return (
            <div key={p.id} className="settings-provider">
              <div className="settings-row">
                <span className="settings-label">
                  {p.name} <span className="dim">· {p.vendor}</span>
                </span>
                {p.available ? (
                  <span className="settings-ok">Connected</span>
                ) : (
                  <span className="settings-bad">Not found</span>
                )}
              </div>
              {p.available && <div className="settings-path">{p.bin}</div>}
              {!p.available && <p className="settings-note">{p.loginHint}</p>}
              <div className="settings-actions">
                {p.available ? (
                  <button onClick={() => runTest(p.id)} disabled={test === 'running'}>
                    {test === 'running' ? 'Testing…' : 'Test connection'}
                  </button>
                ) : (
                  <button onClick={() => window.avb.openExternal(p.installUrl)}>Get {p.name}</button>
                )}
              </div>
              {test && test !== 'running' && (
                <div className={test.ok ? 'settings-ok' : 'settings-bad'}>
                  {test.ok ? 'Connected — ready to use.' : `Not working: ${test.error}`}
                </div>
              )}
              {test && test !== 'running' && !test.ok && /login|auth|credit|api key|account/i.test(test.error || '') && (
                <p className="settings-note">Log in from a terminal first, then test again. {p.loginHint}</p>
              )}
            </div>
          );
        })}
        {providers && (
          <div className="settings-actions">
            <button className="ghost" onClick={refresh}>Re-check all</button>
          </div>
        )}
      </div>
    </div>
  );
}
