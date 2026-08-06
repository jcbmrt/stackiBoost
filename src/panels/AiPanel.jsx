import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, PlusIcon, SparkleIcon, SendIcon, StopSquareIcon, FileIcon, TagIcon } from '../ui/Icons.jsx';
import { getAiModels, setAiModels } from '../aiModels.js';

const SYSTEM_PROMPT = [
  'You are the AI assistant built into StackiBoost, a visual editor for Astro projects.',
  'The user sees a live canvas of their site; your file edits hot-reload instantly.',
  'A <stacki-context> block in each message tells you which page is open and which element is selected — start there.',
  'Edit project files directly. Keep replies short and plain; the user is in a design tool, not a terminal.',
  'The Astro dev server is already running. Never start dev servers, never commit to git unless asked.',
].join(' ');

const MAX_TABS = 5;
let tabSeq = 1;
const makeTab = (provider, num) => ({
  id: `t${Date.now().toString(36)}-${tabSeq++}`,
  num,
  messages: [],
  live: '',
  input: '',
  running: false,
  stopping: false,
  unread: false,
  sessions: {},
  ctx: null,
  provider,
});

export default function AiPanel({ project, context, hidden, onClose, onFinished, showToast }) {
  const defaultProvider = () => localStorage.getItem('ai-provider') || 'claude';
  const [tabs, setTabs] = useState(() => [makeTab(defaultProvider(), 1)]);
  const [activeId, setActiveId] = useState(() => null);
  const [providers, setProviders] = useState(null);
  const [added, setAdded] = useState(() => getAiModels() || []);
  const [height, setHeight] = useState(300);
  const [pinned, setPinned] = useState(false);
  const [autoH, setAutoH] = useState(52);
  const [inputH, setInputH] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const contextRef = useRef(context);
  contextRef.current = context;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const runningChatsRef = useRef(new Set());

  const active = tabs.find((t) => t.id === activeId) || tabs[0];
  const activeIdRef = useRef(null);
  activeIdRef.current = active?.id;

  const patchTab = useCallback((id, fn) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)));
  }, []);

  useEffect(() => {
    if (!activeId && tabs[0]) setActiveId(tabs[0].id);
  }, [activeId, tabs]);

  // selection changes stamp the tab you're looking at; switching tabs alone
  // never overwrites what a tab already remembers
  const lastCtxKeyRef = useRef(null);
  useEffect(() => {
    if (hidden || !context) return;
    if (context.block === lastCtxKeyRef.current) return;
    lastCtxKeyRef.current = context.block;
    if (activeIdRef.current) patchTab(activeIdRef.current, () => ({ ctx: context }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, hidden]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!hidden) {
      inputRef.current?.focus();
      if (activeIdRef.current) patchTab(activeIdRef.current, () => ({ unread: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, activeId]);

  useEffect(() => {
    const on = () => setAdded(getAiModels() || []);
    window.addEventListener('ai-models-changed', on);
    return () => window.removeEventListener('ai-models-changed', on);
  }, []);

  // keep each tab's model inside the added list (running tabs settle after)
  const runningKey = tabs.map((t) => (t.running ? '1' : '0')).join('');
  useEffect(() => {
    if (!providers || !added.length) return;
    setTabs((ts) =>
      ts.map((t) => {
        if (t.running || added.includes(t.provider)) return t;
        const first =
          providers.find((p) => added.includes(p.id) && p.available) ||
          providers.find((p) => added.includes(p.id));
        return first ? { ...t, provider: first.id } : t;
      })
    );
  }, [providers, added, runningKey]);

  // escape closes the panel (only while it's showing)
  useEffect(() => {
    if (hidden) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement;
      const editable =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (editable && !el.closest('.ai-drawer')) return;
      if (document.querySelector('.modal-overlay, .dd-popup, .insert-overlay, .code-window')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [hidden, onClose]);

  useEffect(() => {
    if (hidden) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages, active?.live, activeId, hidden]);

  const pushBlocks = useCallback(
    (id, blocks) => {
      patchTab(id, (t) => {
        const last = t.messages[t.messages.length - 1];
        if (last?.role === 'assistant' && !last.done) {
          return {
            messages: [...t.messages.slice(0, -1), { ...last, blocks: [...last.blocks, ...blocks] }],
          };
        }
        return { messages: [...t.messages, { role: 'assistant', blocks, done: false }] };
      });
    },
    [patchTab]
  );

  const finish = useCallback(
    (id, error) => {
      patchTab(id, (t) => {
        let messages = t.messages;
        const leftover = t.live.trim();
        if (leftover) {
          const last = messages[messages.length - 1];
          messages =
            last?.role === 'assistant' && !last.done
              ? [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, { type: 'text', text: leftover }] }]
              : [...messages, { role: 'assistant', blocks: [{ type: 'text', text: leftover }], done: false }];
        }
        messages = messages.map((m) => (m.role === 'assistant' ? { ...m, done: true } : m));
        if (error && t.running && !t.stopping) messages = [...messages, { role: 'error', text: error }];
        const seen = activeIdRef.current === id && !hiddenRef.current;
        return {
          messages,
          live: '',
          running: false,
          stopping: false,
          unread: (t.running && !seen) || t.unread,
        };
      });
    },
    [patchTab]
  );

  useEffect(() => {
    const off = window.avb.onAiEvent((e) => {
      const id = e.chatId;
      if (!id) return;
      if (e.kind === 'init' && e.sessionId) {
        patchTab(id, (t) => ({ sessions: { ...t.sessions, [t.runProvider || t.provider]: e.sessionId } }));
      } else if (e.kind === 'delta') {
        patchTab(id, (t) => ({ live: t.live + e.text }));
      } else if (e.kind === 'text') {
        patchTab(id, () => ({ live: '' }));
        if (e.text?.trim()) pushBlocks(id, [{ type: 'text', text: e.text }]);
      } else if (e.kind === 'tool') {
        pushBlocks(id, [{ type: 'tool', verb: e.verb, detail: e.detail }]);
      } else if (e.kind === 'result') {
        if (e.sessionId) patchTab(id, (t) => ({ sessions: { ...t.sessions, [t.runProvider || t.provider]: e.sessionId } }));
        finish(id, e.error || null);
        if (runningChatsRef.current.delete(id)) onFinishedRef.current?.();
      } else if (e.kind === 'closed') {
        finish(id, e.error || null);
        if (runningChatsRef.current.delete(id)) onFinishedRef.current?.();
      }
    });
    return off;
  }, [patchTab, pushBlocks, finish]);

  const send = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    const text = tab.input.trim();
    if (!text || tab.running || !project) return;
    const ctx = tab.ctx || contextRef.current;
    const prompt = ctx?.block ? `<stacki-context>\n${ctx.block}\n</stacki-context>\n\n${text}` : text;
    patchTab(tab.id, (t) => ({
      input: '',
      running: true,
      unread: false,
      stopping: false,
      runProvider: t.provider,
      messages: [
        ...t.messages.map((m) => (m.role === 'assistant' ? { ...m, done: true } : m)),
        { role: 'user', text },
      ],
    }));
    runningChatsRef.current.add(tab.id);
    try {
      await window.avb.aiSend({
        projectPath: project.path,
        prompt,
        sessionId: tab.sessions[tab.provider] || null,
        systemPrompt: SYSTEM_PROMPT,
        provider: tab.provider,
        chatId: tab.id,
      });
    } catch (err) {
      runningChatsRef.current.delete(tab.id);
      const msg = (err?.message || String(err)).replace(
        /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
        ''
      );
      patchTab(tab.id, (t) => {
        const messages = [...t.messages];
        if (messages[messages.length - 1]?.role === 'user') messages.pop();
        return { running: false, input: t.input || text, messages: [...messages, { role: 'error', text: msg }] };
      });
    }
  }, [tabs, project, patchTab]);

  const stop = useCallback(
    (id) => {
      patchTab(id, () => ({ stopping: true }));
      window.avb.aiStop({ chatId: id });
    },
    [patchTab]
  );

  const addTab = useCallback(() => {
    setTabs((ts) => {
      if (ts.length >= MAX_TABS) return ts;
      const used = new Set(ts.map((t) => t.num));
      let num = 1;
      while (used.has(num)) num++;
      const t = makeTab(ts[ts.length - 1]?.provider || defaultProvider(), num);
      setActiveId(t.id);
      return [...ts, t];
    });
  }, []);

  const closeTab = useCallback(
    (id) => {
      window.avb.aiStop({ chatId: id });
      setTabs((ts) => {
        const idx = ts.findIndex((t) => t.id === id);
        let next = ts.filter((t) => t.id !== id);
        if (!next.length) next = [makeTab(defaultProvider(), 1)];
        if (activeIdRef.current === id) {
          const fallback = next[Math.max(0, idx - 1)] || next[0];
          setActiveId(fallback.id);
        }
        return next;
      });
    },
    []
  );

  const selectTab = useCallback(
    (id) => {
      setActiveId(id);
      patchTab(id, () => ({ unread: false }));
    },
    [patchTab]
  );

  // auto-grow the input with its content
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const prev = el.style.height;
    el.style.height = 'auto';
    const sh = el.scrollHeight;
    el.style.height = prev;
    setAutoH(Math.min(Math.max(sh + 2, 52), 122));
  }, [active?.input, activeId]);

  const effInputH = inputH ?? autoH;

  // pointer capture keeps the drag alive over the preview iframe and
  // guarantees the release is seen — without it the handle sticks to the cursor
  const dragWith = (e, onMove) => {
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* older engines */
    }
    const up = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  const onInputGrip = (e) => {
    const startY = e.clientY;
    const startH = effInputH;
    dragWith(e, (ev) => {
      setInputH(Math.min(Math.max(startH + (startY - ev.clientY), 52), window.innerHeight * 0.7));
    });
  };

  const onDragStart = (e) => {
    const drawer = e.currentTarget.parentElement;
    const maxH = (drawer?.parentElement?.clientHeight || window.innerHeight) - 28;
    const startY = e.clientY;
    const startH = drawer?.getBoundingClientRect().height || height;
    setPinned(true);
    dragWith(e, (ev) => {
      setHeight(Math.min(Math.max(startH + (startY - ev.clientY), 160), maxH));
    });
  };

  if (!active) return null;

  const addedProviders = providers?.filter((p) => added.includes(p.id)) || [];
  const current = addedProviders.find((p) => p.id === active.provider);
  const noneAdded = providers && addedProviders.length === 0;
  const unavailable = providers && (!current || !current.available);
  const compact =
    !pinned && tabs.length === 1 && active.messages.length === 0 && !active.live && !active.running;

  return (
    <div
      className={`ai-drawer ${compact ? 'compact' : ''}`}
      style={{ ...(compact ? {} : { height: Math.max(height, effInputH + 170) }), ...(hidden ? { display: 'none' } : {}) }}
    >
      <div className="ai-resize" onPointerDown={onDragStart} />
      <div className="ai-head">
        <span className="ai-title">
          <SparkleIcon size={13} /> {compact ? 'AI Mode' : ''}
          {compact && <span className="ai-sub">- Ask for anything</span>}
        </span>
        {!compact && (
          <div className="ai-tabs">
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`ai-tab ${t.id === active.id ? 'on' : ''}`}
                onClick={() => selectTab(t.id)}
                title={`Chat #${t.num}`}
              >
                {t.running && <span className="ai-tab-dot running" />}
                {!t.running && t.unread && <span className="ai-tab-dot done" />}
                <span className="ai-tab-label">Chat #{t.num}</span>
                {tabs.length > 1 && (
                  <button
                    className="ai-tab-x"
                    title="Close chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  >
                    <CloseIcon size={9} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <span className="spacer" />
        <button
          className="ghost"
          title={tabs.length >= MAX_TABS ? `Up to ${MAX_TABS} chats` : 'New chat'}
          disabled={tabs.length >= MAX_TABS}
          onClick={addTab}
        >
          <PlusIcon size={13} />
        </button>
        <button className="ghost" title="Close (Esc)" onClick={onClose}>
          <CloseIcon size={13} />
        </button>
      </div>

      {noneAdded && (
        <div className="ai-note">No model added yet. Add one in Settings (the gear on the left rail).</div>
      )}
      {unavailable && !noneAdded && (
        <div className="ai-note">
          {current
            ? `${current.name} isn't installed. ${current.loginHint}`
            : 'This chat\'s model was removed. Add it back or pick another in Settings.'}
        </div>
      )}

      {!compact && (
        <div className="ai-scroll" ref={scrollRef}>
          {active.messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="ai-msg user">{m.text}</div>
            ) : m.role === 'error' ? (
              <div key={i} className="ai-msg error">{m.text}</div>
            ) : (
              <div key={i} className="ai-msg assistant">
                {m.blocks.map((b, j) =>
                  b.type === 'tool' ? (
                    <div key={j} className="ai-tool">
                      <span className="ai-tool-verb">{b.verb}</span>
                      {b.detail && <span className="ai-tool-detail">{b.detail}</span>}
                    </div>
                  ) : (
                    <div key={j} className="ai-text">{b.text}</div>
                  )
                )}
              </div>
            )
          )}
          {active.live && (
            <div className="ai-msg assistant">
              <div className="ai-text">{active.live}</div>
            </div>
          )}
          {active.running && !active.live && <div className="ai-thinking">Thinking…</div>}
        </div>
      )}

      <div className="ai-composer" onClick={() => inputRef.current?.focus()}>
        <div
          className="ai-input-grip"
          title="Drag to resize, double-click to reset"
          onPointerDown={onInputGrip}
          onDoubleClick={() => setInputH(null)}
        />
        <textarea
          ref={inputRef}
          className="ai-input"
          style={{ height: effInputH }}
          placeholder={active.running ? 'Working…' : 'Describe a change…'}
          value={active.input}
          rows={1}
          onChange={(e) => patchTab(active.id, () => ({ input: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="ai-composer-bar">
          {(active.ctx || context)?.pageLabel && (
            <span className="ai-chip" title={(active.ctx || context).block}>
              <FileIcon size={11} /> {(active.ctx || context).pageLabel}
            </span>
          )}
          {(active.ctx || context)?.selLabel && (
            <span className="ai-chip sel" title={(active.ctx || context).summary}>
              <TagIcon size={11} /> {(active.ctx || context).selLabel}
            </span>
          )}
          <span className="spacer" />
          {addedProviders.length > 1 && (
            <select
              className="ai-model"
              value={active.provider}
              disabled={active.running}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                localStorage.setItem('ai-provider', e.target.value);
                patchTab(active.id, () => ({ provider: e.target.value }));
              }}
              title="Model"
            >
              {addedProviders.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.name}{p.available ? '' : ' (not installed)'}
                </option>
              ))}
            </select>
          )}
          {active.running ? (
            <button
              className="ai-send stop"
              title="Stop"
              onClick={(e) => {
                e.stopPropagation();
                stop(active.id);
              }}
            >
              <StopSquareIcon size={13} />
            </button>
          ) : (
            <button
              className="ai-send"
              title="Send (Enter)"
              disabled={!active.input.trim() || unavailable}
              onClick={(e) => {
                e.stopPropagation();
                send();
              }}
            >
              <SendIcon size={14} strokeWidth={1.6} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
