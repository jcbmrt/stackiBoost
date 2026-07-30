import React, { useEffect, useState } from 'react';
import { SparkleIcon, PlusIcon } from '../ui/Icons.jsx';
import { getAiModels, setAiModels } from '../aiModels.js';

export default function SettingsPanel({ project }) {
  const [providers, setProviders] = useState(null);
  const [added, setAdded] = useState(() => getAiModels() || []);
  const [picking, setPicking] = useState(false);
  const [tests, setTests] = useState({}); // id -> 'running' | {ok, error}

  const refresh = () => {
    window.avb
      .aiStatus()
      .then((s) => {
        setProviders(s.providers);
        if (getAiModels() === null) {
          const seed = s.providers.find((p) => p.id === 'claude' && p.available) ? ['claude'] : [];
          setAiModels(seed);
          setAdded(seed);
        }
      })
      .catch(() => setProviders([]));
  };
  useEffect(refresh, []);

  useEffect(() => {
    const on = () => setAdded(getAiModels() || []);
    window.addEventListener('ai-models-changed', on);
    return () => window.removeEventListener('ai-models-changed', on);
  }, []);

  const addModel = (id) => {
    const next = [...added, id];
    setAiModels(next);
    setAdded(next);
    setPicking(false);
  };

  const removeModel = (id) => {
    const next = added.filter((x) => x !== id);
    setAiModels(next);
    setAdded(next);
  };

  const runTest = async (id) => {
    setTests((t) => ({ ...t, [id]: 'running' }));
    try {
      const res = await window.avb.aiTest({ projectPath: project?.path, provider: id });
      setTests((t) => ({ ...t, [id]: res }));
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: err?.message || String(err) } }));
    }
  };

  const addedProviders = providers?.filter((p) => added.includes(p.id)) || [];
  const addable = providers?.filter((p) => !added.includes(p.id)) || [];

  return (
    <div className="settings-panel">
      <div className="panel-title">Settings</div>

      <div className="settings-section">
        <div className="settings-heading">
          <SparkleIcon size={14} /> Connected models
        </div>
        <p className="settings-note">
          The AI panel runs a coding CLI installed on your machine, using your own subscription.
          No API keys. Add the models you want; with more than one connected you can switch in the chat.
        </p>

        {providers === null && <span className="dim">checking…</span>}

        {addedProviders.map((p) => {
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
                <button className="ghost" onClick={() => removeModel(p.id)}>Remove</button>
              </div>
              {test && test !== 'running' && (
                <div className={test.ok ? 'settings-ok' : 'settings-bad'}>
                  {test.ok ? 'Connected. Ready to use.' : `Not working: ${test.error}`}
                </div>
              )}
              {test && test !== 'running' && !test.ok && /login|auth|credit|api key|account/i.test(test.error || '') && (
                <p className="settings-note">Log in from a terminal first, then test again. {p.loginHint}</p>
              )}
            </div>
          );
        })}

        {providers && addedProviders.length === 0 && !picking && (
          <p className="settings-note dim">No models added yet.</p>
        )}

        {providers && addable.length > 0 && !picking && (
          <div className="settings-actions">
            <button onClick={() => setPicking(true)}>
              <PlusIcon size={12} /> Add model
            </button>
          </div>
        )}

        {picking && (
          <div className="settings-pick">
            {addable.map((p) => (
              <button key={p.id} className="settings-pick-row" onClick={() => addModel(p.id)}>
                <span>
                  {p.name} <span className="dim">· {p.vendor}</span>
                </span>
                {p.available ? (
                  <span className="settings-ok">Connected</span>
                ) : (
                  <span className="dim">Not installed</span>
                )}
              </button>
            ))}
            <div className="settings-actions">
              <button className="ghost" onClick={() => setPicking(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
