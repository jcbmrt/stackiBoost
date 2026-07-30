import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, PlusIcon, SparkleIcon, SendIcon, StopSquareIcon, FileIcon, TagIcon } from '../ui/Icons.jsx';

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
  const [provider, setProvider] = useState(() => localStorage.getItem('ai-provider') || 'claude');
  const [height, setHeight] = useState(300);
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
        const cur = s.providers.find((p) => p.id === (localStorage.getItem('ai-provider') || 'claude'));
        if (cur && !cur.available) {
          const fallback = s.providers.find((p) => p.available);
          if (fallback) setProvider(fallback.id);
        }
      })
      .catch(() => setProviders([]));
    inputRef.current?.focus();
  }, []);

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
    inputRef.current?.focus();
  }, [running]);

  // drag to resize
  const onDragStart = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev) => {
      const h = Math.min(Math.max(startH + (startY - ev.clientY), 160), window.innerHeight * 0.7);
      setHeight(h);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const current = providers?.find((p) => p.id === provider);
  const noneAvailable = providers && !providers.some((p) => p.available);
  const unavailable = providers && (!current || !current.available);

  return (
    <div className="ai-drawer" style={{ height }}>
      <div className="ai-resize" onPointerDown={onDragStart} />
      <div className="ai-head">
        <span className="ai-title">
          <SparkleIcon size={13} /> AI
        </span>
        <span className="spacer" />
        <button className="ghost" title="New chat" onClick={newChat}>
          <PlusIcon size={13} />
        </button>
        <button className="ghost" title="Close (Esc)" onClick={onClose}>
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="ai-scroll" ref={scrollRef}>
        {noneAvailable && (
          <div className="ai-empty">
            <p>No AI provider found. Install one and log in, then check Settings → Connected models:</p>
            <p>
              <a onClick={() => window.avb.openExternal('https://claude.com/claude-code')}>Claude Code</a>
              {' · '}
              <a onClick={() => window.avb.openExternal('https://developers.openai.com/codex/cli')}>Codex CLI</a>
              {' · '}
              <a onClick={() => window.avb.openExternal('https://github.com/google-gemini/gemini-cli')}>Gemini CLI</a>
            </p>
          </div>
        )}
        {unavailable && !noneAvailable && current && (
          <div className="ai-empty">
            <p>{current.name} isn't installed.</p>
            <p className="dim">{current.loginHint}</p>
          </div>
        )}
        {!unavailable && messages.length === 0 && !live && (
          <div className="ai-empty">
            <p>Ask for anything — new sections, style changes, whole pages.</p>
            <p className="dim">Whatever you have selected on the canvas is sent along as context, and edits show up live.</p>
          </div>
        )}
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

      <div className="ai-composer" onClick={() => inputRef.current?.focus()}>
        <textarea
          ref={inputRef}
          className="ai-input"
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
          {providers && providers.length > 0 && (
            <select
              className="ai-model"
              value={provider}
              disabled={running}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setProvider(e.target.value)}
              title="Model"
            >
              {providers.map((p) => (
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
