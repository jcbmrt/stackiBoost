import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, PlusIcon, SparkleIcon } from '../ui/Icons.jsx';

const SYSTEM_PROMPT = [
  'You are the AI assistant built into Stacki, a visual editor for Astro projects.',
  'The user sees a live canvas of their site; your file edits hot-reload instantly.',
  'A <stacki-context> block in each message tells you which page is open and which element is selected — start there.',
  'Edit project files directly. Keep replies short and plain; the user is in a design tool, not a terminal.',
  'The Astro dev server is already running. Never start dev servers, never commit to git unless asked.',
].join(' ');

function toolLabel(block) {
  const input = block.input || {};
  const rel = (p) => (typeof p === 'string' ? p.replace(/^.*\/src\//, 'src/') : '');
  switch (block.name) {
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
      return { verb: block.name, detail: '' };
  }
}

export default function AiPanel({ project, context, onClose, showToast }) {
  const [messages, setMessages] = useState([]);
  const [live, setLive] = useState('');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(null);
  const [height, setHeight] = useState(300);
  const sessionRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    window.avb.aiStatus().then(setStatus).catch(() => setStatus({ available: false }));
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  useEffect(() => {
    const off = window.avb.onAiEvent((e) => {
      if (e.type === 'system' && e.subtype === 'init') {
        sessionRef.current = e.session_id;
        return;
      }
      if (e.type === 'stream_event') {
        const ev = e.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          setLive((t) => t + ev.delta.text);
        }
        return;
      }
      if (e.type === 'assistant') {
        const blocks = (e.message?.content || [])
          .map((b) =>
            b.type === 'text'
              ? { type: 'text', text: b.text }
              : b.type === 'tool_use'
                ? { type: 'tool', ...toolLabel(b) }
                : null
          )
          .filter(Boolean);
        setLive('');
        if (!blocks.length) return;
        setMessages((ms) => {
          const last = ms[ms.length - 1];
          if (last?.role === 'assistant' && !last.done) {
            return [...ms.slice(0, -1), { ...last, blocks: [...last.blocks, ...blocks] }];
          }
          return [...ms, { role: 'assistant', blocks, done: false }];
        });
        return;
      }
      if (e.type === 'result') {
        if (e.session_id) sessionRef.current = e.session_id;
        setRunning(false);
        setLive('');
        setMessages((ms) => {
          const out = ms.map((m) => (m.role === 'assistant' ? { ...m, done: true } : m));
          if (e.is_error) {
            out.push({ role: 'error', text: e.result || e.subtype || 'Something went wrong.' });
          }
          return out;
        });
        return;
      }
      if (e.type === 'closed') {
        setRunning(false);
        setLive('');
        if (e.error) {
          setMessages((ms) => [...ms, { role: 'error', text: e.error }]);
        }
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
        sessionId: sessionRef.current,
        systemPrompt: SYSTEM_PROMPT,
      });
    } catch (err) {
      setRunning(false);
      const msg = err?.message || String(err);
      setMessages((ms) => [...ms, { role: 'error', text: msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') }]);
    }
  }, [input, running, project]);

  const stop = useCallback(() => {
    window.avb.aiStop();
    setRunning(false);
  }, []);

  const newChat = useCallback(() => {
    if (running) window.avb.aiStop();
    sessionRef.current = null;
    setMessages([]);
    setLive('');
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

  const unavailable = status && !status.available;

  return (
    <div className="ai-drawer" style={{ height }}>
      <div className="ai-resize" onPointerDown={onDragStart} />
      <div className="ai-head">
        <span className="ai-title">
          <SparkleIcon size={13} /> AI
        </span>
        {context?.summary && <span className="ai-context-chip" title={context.block}>{context.summary}</span>}
        <span className="spacer" />
        <button className="ghost" title="New chat" onClick={newChat}>
          <PlusIcon size={13} />
        </button>
        <button className="ghost" title="Close (⌘J)" onClick={onClose}>
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="ai-scroll" ref={scrollRef}>
        {unavailable && (
          <div className="ai-empty">
            <p>Claude Code isn't installed (or isn't on your PATH).</p>
            <p>
              Install it from{' '}
              <a onClick={() => window.avb.openExternal('https://claude.com/claude-code')}>
                claude.com/claude-code
              </a>
              , run <code>claude</code> once in a terminal to log in, then reopen this panel.
            </p>
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

      <div className="ai-inputrow">
        <textarea
          ref={inputRef}
          className="ai-input"
          placeholder={running ? 'Claude is working…' : 'Describe a change…'}
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
        {running ? (
          <button className="ai-stop" onClick={stop}>Stop</button>
        ) : (
          <button className="primary" disabled={!input.trim() || unavailable} onClick={send}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
