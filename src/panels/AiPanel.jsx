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

export default function AiPanel({ project, context, onClose, showToast }) {
  const [messages, setMessages] = useState([]);
  const [live, setLive] = useState('');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [providers, setProviders] = useState(null);
  const [added, setAdded] = useState(() => getAiModels() || []);
  const [provider, setProvider] = useState(() => localStorage.getItem('ai-provider') || 'claude');
  const [height, setHeight] = useState(300);
  const [pinned, setPinned] = useState(false); // user sized the panel by hand
  const [autoH, setAutoH] = useState(52); // grows with content up to ~5 lines
  const [inputH, setInputH] = useState(null); // manual override from the grip
  const sessionsRef = useRef({});
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const liveRef = useRef('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const contextRef = useRef(context);
  contextRef.current = context;

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
    inputRef.current?.focus();
  }, []);

  // settings can add/remove models while the chat is open
  useEffect(() => {
    const on = () => setAdded(getAiModels() || []);
    window.addEventListener('ai-models-changed', on);
    return () => window.removeEventListener('ai-models-changed', on);
  }, []);

  // keep the selected model inside the added list
  useEffect(() => {
    if (!providers || added.includes(provider)) return;
    const first =
      providers.find((p) => added.includes(p.id) && p.available) ||
      providers.find((p) => added.includes(p.id));
    if (first) setProvider(first.id);
  }, [providers, added, provider]);

  useEffect(() => {
    localStorage.setItem('ai-provider', provider);
  }, [provider]);

  // escape closes the panel
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  const setLiveText = (fn) => {
    setLive((t) => {
      const v = fn(t);
      liveRef.current = v;
      return v;
    });
  };

  const pushBlocks = (blocks) => {
    setMessages((ms) => {
      const last = ms[ms.length - 1];
      if (last?.role === 'assistant' && !last.done) {
        return [...ms.slice(0, -1), { ...last, blocks: [...last.blocks, ...blocks] }];
      }
      return [...ms, { role: 'assistant', blocks, done: false }];
    });
  };

  const finish = (error) => {
    const leftover = liveRef.current.trim();
    if (leftover) pushBlocks([{ type: 'text', text: leftover }]);
    setLiveText(() => '');
    setRunning(false);
    setMessages((ms) => {
      const out = ms.map((m) => (m.role === 'assistant' ? { ...m, done: true } : m));
      if (error) out.push({ role: 'error', text: error });
      return out;
    });
  };

  useEffect(() => {
    const off = window.avb.onAiEvent((e) => {
      if (e.kind === 'init' && e.sessionId) {
        sessionsRef.current[providerRef.current] = e.sessionId;
      } else if (e.kind === 'delta') {
        setLiveText((t) => t + e.text);
      } else if (e.kind === 'text') {
        setLiveText(() => '');
        if (e.text?.trim()) pushBlocks([{ type: 'text', text: e.text }]);
      } else if (e.kind === 'tool') {
        pushBlocks([{ type: 'tool', verb: e.verb, detail: e.detail }]);
      } else if (e.kind === 'result') {
        if (e.sessionId) sessionsRef.current[providerRef.current] = e.sessionId;
        finish(e.error || null);
      } else if (e.kind === 'closed') {
        finish(e.error || null);
      }
    });
    return off;
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running || !project) return;
    const ctx = contextRef.current;
    const prompt = ctx?.block ? `<stacki-context>\n${ctx.block}\n</stacki-context>\n\n${text}` : text;
    setInput('');
    setMessages((ms) => [
      ...ms.map((m) => (m.role === 'assistant' ? { ...m, done: true } : m)),
      { role: 'user', text },
    ]);
    setRunning(true);
    try {
      await window.avb.aiSend({
        projectPath: project.path,
        prompt,
        sessionId: sessionsRef.current[provider] || null,
        systemPrompt: SYSTEM_PROMPT,
        provider,
      });
    } catch (err) {
      setRunning(false);
      const msg = (err?.message || String(err)).replace(
        /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
        ''
      );
      setMessages((ms) => [...ms, { role: 'error', text: msg }]);
    }
  }, [input, running, project, provider]);

  const stop = useCallback(() => {
    window.avb.aiStop();
    finish(null);
  }, []);

  const newChat = useCallback(() => {
    if (running) window.avb.aiStop();
    sessionsRef.current = {};
    setMessages([]);
    setLiveText(() => '');
    setRunning(false);
    setPinned(false);
    inputRef.current?.focus();
  }, [running]);

  // auto-grow the input with its content
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const prev = el.style.height;
    el.style.height = 'auto';
    const sh = el.scrollHeight;
    el.style.height = prev;
    setAutoH(Math.min(Math.max(sh + 2, 52), 122));
  }, [input]);

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

  // drag the grip to set the input height by hand; double-click resets
  const onInputGrip = (e) => {
    const startY = e.clientY;
    const startH = effInputH;
    dragWith(e, (ev) => {
      setInputH(Math.min(Math.max(startH + (startY - ev.clientY), 52), window.innerHeight * 0.7));
    });
  };

  // drag to resize the whole panel, up to the full page
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

  const addedProviders = providers?.filter((p) => added.includes(p.id)) || [];
  const current = addedProviders.find((p) => p.id === provider);
  const noneAdded = providers && addedProviders.length === 0;
  const unavailable = providers && (!current || !current.available);
  const compact = !pinned && messages.length === 0 && !live && !running;

  return (
    <div
      className={`ai-drawer ${compact ? 'compact' : ''}`}
      style={compact ? undefined : { height: Math.max(height, effInputH + 170) }}
    >
      <div className="ai-resize" onPointerDown={onDragStart} />
      <div className="ai-head">
        <span className="ai-title">
          <SparkleIcon size={13} /> AI Mode <span className="ai-sub">- Ask for anything</span>
        </span>
        <span className="spacer" />
        <button className="ghost" title="New chat" onClick={newChat}>
          <PlusIcon size={13} />
        </button>
        <button className="ghost" title="Close (Esc)" onClick={onClose}>
          <CloseIcon size={13} />
        </button>
      </div>

      {compact && noneAdded && (
        <div className="ai-note">No model added yet. Add one in Settings (the gear on the left rail).</div>
      )}
      {compact && unavailable && !noneAdded && current && (
        <div className="ai-note">{current.name} isn't installed. {current.loginHint}</div>
      )}

      {!compact && (
      <div className="ai-scroll" ref={scrollRef}>
        {messages.map((m, i) =>
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
        {live && (
          <div className="ai-msg assistant">
            <div className="ai-text">{live}</div>
          </div>
        )}
        {running && !live && <div className="ai-thinking">Thinking…</div>}
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
          placeholder={running ? 'Working…' : 'Describe a change…'}
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="ai-composer-bar">
          {context?.pageLabel && (
            <span className="ai-chip" title={context.block}>
              <FileIcon size={11} /> {context.pageLabel}
            </span>
          )}
          {context?.selLabel && (
            <span className="ai-chip sel" title={context.summary}>
              <TagIcon size={11} /> {context.selLabel}
            </span>
          )}
          <span className="spacer" />
          {addedProviders.length > 1 && (
            <select
              className="ai-model"
              value={provider}
              disabled={running}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setProvider(e.target.value)}
              title="Model"
            >
              {addedProviders.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.name}{p.available ? '' : ' (not installed)'}
                </option>
              ))}
            </select>
          )}
          {running ? (
            <button className="ai-send stop" title="Stop" onClick={(e) => { e.stopPropagation(); stop(); }}>
              <StopSquareIcon size={13} />
            </button>
          ) : (
            <button
              className="ai-send"
              title="Send (Enter)"
              disabled={!input.trim() || unavailable}
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
