import React, { useEffect, useState } from 'react';
import { SparkleIcon, CheckIcon, TrashIcon } from '../ui/Icons.jsx';
import { BRAND_ICONS } from '../ui/BrandIcons.jsx';
import { getAiModels, setAiModels } from '../aiModels.js';

export default function SettingsPanel({ project }) {
  const [providers, setProviders] = useState(null);
  const [added, setAdded] = useState(() => getAiModels() || []);

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
    if (!id || added.includes(id)) return;
    const next = [...added, id];
    setAiModels(next);
    setAdded(next);
  };

  const removeModel = (id) => {
    const next = added.filter((x) => x !== id);
    setAiModels(next);
    setAdded(next);
  };

  const addedProviders = providers?.filter((p) => added.includes(p.id)) || [];
  const addable = providers?.filter((p) => !added.includes(p.id)) || [];

  return (
    <div className="settings-panel">
      <div className="panel-title">Settings</div>

      <div className="settings-section">
        <div className="settings-heading">
          <SparkleIcon size={14} /> Connected AI models
        </div>
        <p className="settings-note">
          Runs on your own subscriptions through locally installed CLIs. No API keys.
        </p>

        {providers === null && <span className="dim">checking…</span>}

        {addedProviders.map((p) => {
          const Brand = BRAND_ICONS[p.id];
          return (
            <div key={p.id} className="settings-provider">
              <div className="settings-row">
                <span className="settings-label">
                  {Brand && <Brand size={15} />} {p.name}
                </span>
                <span className="settings-provider-actions">
                  {p.available && <CheckIcon size={14} className="settings-check" />}
                  <button className="ghost icon" title="Remove" onClick={() => removeModel(p.id)}>
                    <TrashIcon size={13} />
                  </button>
                </span>
              </div>
              {!p.available && (
                <>
                  <p className="settings-note">{p.loginHint}</p>
                  <div className="settings-actions">
                    <button onClick={() => window.avb.openExternal(p.installUrl)}>Get {p.name}</button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {providers && addable.length > 0 && (
          <select
            className="settings-add"
            value=""
            onChange={(e) => addModel(e.target.value)}
          >
            <option value="" disabled>
              + Add model…
            </option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.available ? '' : ' (not installed)'}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
