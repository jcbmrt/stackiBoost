import React from 'react';

// Freeform canvas: the page rendered at every breakpoint side by side on a
// pannable, zoomable surface. Drag anywhere to pan; pinch (or ⌘/Ctrl+wheel)
// to zoom toward the cursor; plain wheel/trackpad scroll pans. Frames are
// view-only here — switch to a single-device mode to interact with the page.
//
// Each frame is as tall as its page: the Electron preload runs inside the
// preview iframes and posts `avb:page-height` messages, which we match to a
// frame via the message's source window. In return we post `avb:set-vh` with
// the breakpoint's viewport height so the page's vh units stay one "screen"
// tall (viewportHeight) instead of tracking the stretched frame.
const BREAKPOINTS = [
  { key: 'desktop', label: 'Desktop', width: 1440, viewportHeight: 900 },
  { key: 'tablet', label: 'Tablet', width: 768, viewportHeight: 1024 },
  { key: 'phone', label: 'Phone', width: 375, viewportHeight: 812 },
];
const GAP = 120;
const MAX_PAGE_HEIGHT = 30000; // sanity cap for runaway pages

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export default function CanvasView({ url, refreshKey, scriptsOn, selPath, onSelectPath, onOpenPath, activeKey, onActivate, onDeselect }) {
  const wrapRef = React.useRef(null);
  const iframeRefs = React.useRef({}); // key -> iframe element
  const [view, setView] = React.useState(null); // {x, y, s}
  const [panning, setPanning] = React.useState(false);
  const [heights, setHeights] = React.useState({}); // key -> page height
  const [rects, setRects] = React.useState({}); // key -> {path: rect}
  const rectsJsonRef = React.useRef({}); // key -> last payload, skips no-op updates
  const [hovers, setHovers] = React.useState({}); // key -> path
  const hoversRef = React.useRef({});
  hoversRef.current = hovers;
  const selPathRef = React.useRef(selPath);
  selPathRef.current = selPath;

  const frameKeyFor = (source) => {
    const entry = Object.entries(iframeRefs.current).find(
      ([, el]) => el && el.contentWindow === source
    );
    return entry ? entry[0] : null;
  };

  // tell a frame which paths to report rects for
  const track = (key) => {
    const el = iframeRefs.current[key];
    const paths = [selPathRef.current, hoversRef.current[key]].filter(Boolean);
    el?.contentWindow?.postMessage({ type: 'avb:track', paths }, '*');
  };

  React.useEffect(() => {
    for (const key of Object.keys(iframeRefs.current)) track(key);
  }, [selPath]);

  // clicks, hovers and rects coming back from the frames
  React.useEffect(() => {
    const onMessage = (e) => {
      const d = e.data;
      if (!d?.type) return;
      const key = frameKeyFor(e.source);
      if (!key) return;
      if (d.type === 'avb:click-node') {
        onActivate && onActivate(key);
        onSelectPath && onSelectPath(d.path || null);
      } else if (d.type === 'avb:open-node') {
        onActivate && onActivate(key);
        onOpenPath && onOpenPath(d.path || null);
      } else if (d.type === 'avb:hover-node') {
        if (hoversRef.current[key] !== d.path) {
          hoversRef.current[key] = d.path;
          setHovers((h) => ({ ...h, [key]: d.path }));
          track(key);
        }
      } else if (d.type === 'avb:rects') {
        const json = JSON.stringify(d.rects || {});
        if (rectsJsonRef.current[key] === json) return;
        rectsJsonRef.current[key] = json;
        setRects((r) => ({ ...r, [key]: d.rects || {} }));
      } else if (d.type === 'avb:wheel') {
        const el = iframeRefs.current[key];
        const wrap = wrapRef.current;
        const v = viewRef.current;
        if (!el || !wrap || !v) return;
        userMovedRef.current = true;
        const wrect = wrap.getBoundingClientRect();
        const irect = el.getBoundingClientRect();
        const cx = irect.left - wrect.left + d.x * v.s;
        const cy = irect.top - wrect.top + d.y * v.s;
        setView((vv) => {
          if (!vv) return vv;
          if (d.ctrl) {
            const ns = clamp(vv.s * Math.exp(-d.dy * 0.01), MIN_ZOOM, MAX_ZOOM);
            const k = ns / vv.s;
            return { s: ns, x: cx - (cx - vv.x) * k, y: cy - (cy - vv.y) * k };
          }
          return { ...vv, x: vv.x - d.dx, y: vv.y - d.dy };
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onActivate, onSelectPath, onOpenPath]);
  const viewRef = React.useRef(null);
  viewRef.current = view;

  // Frame layout in world coordinates, using live page heights.
  const frames = React.useMemo(() => {
    let x = 0;
    return BREAKPOINTS.map((b) => {
      const height = clamp(heights[b.key] ?? b.viewportHeight, 200, MAX_PAGE_HEIGHT);
      const f = { ...b, x, height };
      x += b.width + GAP;
      return f;
    });
  }, [heights]);
  const worldW = frames[frames.length - 1].x + frames[frames.length - 1].width;
  const worldH = Math.max(...frames.map((f) => f.height));
  const worldRef = React.useRef({ w: worldW, h: worldH });
  worldRef.current = { w: worldW, h: worldH };

  // Page heights reported by the preload inside each preview iframe.
  React.useEffect(() => {
    const onMessage = (e) => {
      if (e.data?.type !== 'avb:page-height' || typeof e.data.height !== 'number') return;
      const entry = Object.entries(iframeRefs.current).find(
        ([, el]) => el && el.contentWindow === e.source
      );
      if (!entry) return;
      const [key] = entry;
      const height = Math.round(e.data.height);
      setHeights((h) => (h[key] === height ? h : { ...h, [key]: height }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const fit = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { w, h } = worldRef.current;
    const pad = 56;
    const s = clamp(
      Math.min((el.clientWidth - pad * 2) / w, (el.clientHeight - pad * 2) / h),
      MIN_ZOOM,
      1
    );
    setView({
      s,
      x: (el.clientWidth - w * s) / 2,
      y: Math.max((el.clientHeight - h * s) / 2, pad * 0.75),
    });
  }, []);

  React.useLayoutEffect(() => {
    fit();
  }, [fit]);

  // Real page heights arrive after the iframes load; keep the layout fitted
  // until the user pans or zooms, then leave their view alone.
  const userMovedRef = React.useRef(false);
  React.useEffect(() => {
    if (!userMovedRef.current) fit();
  }, [worldW, worldH, fit]);

  // Native wheel listener — React attaches wheel handlers passively, so
  // preventDefault (needed to stop history-swipe/page zoom) requires our own.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      userMovedRef.current = true;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        if (!v) return v;
        if (e.ctrlKey || e.metaKey) {
          // Trackpad pinch arrives as ctrl+wheel; zoom toward the cursor.
          const s = clamp(v.s * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
          const k = s / v.s;
          return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const v0 = viewRef.current;
    if (!v0) return;
    e.preventDefault();
    setPanning(true);
    const el = e.currentTarget;
    // capture so the release always lands here, even over a frame iframe —
    // a missed pointerup left the canvas stuck in panning mode
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* older engines */
    }
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let raf = null;
    let last = { x: sx, y: sy };
    const onMove = (ev) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (Math.abs(last.x - sx) + Math.abs(last.y - sy) > 3) {
        moved = true;
        userMovedRef.current = true;
      }
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (moved) setView({ ...v0, x: v0.x + last.x - sx, y: v0.y + last.y - sy });
      });
    };
    const onUp = () => {
      setPanning(false);
      if (raf) cancelAnimationFrame(raf);
      // a still click on the empty canvas clears the selection, like figma
      if (!moved && onDeselect) onDeselect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  // Zoom buttons zoom around the viewport center.
  const zoomTo = (nextS) => {
    const el = wrapRef.current;
    const v = viewRef.current;
    if (!el || !v) return;
    userMovedRef.current = true;
    const s = clamp(nextS, MIN_ZOOM, MAX_ZOOM);
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const k = s / v.s;
    setView({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  };

  return (
    <div
      ref={wrapRef}
      className={`canvas-view ${panning ? 'panning' : ''}`}
      onPointerDown={onPointerDown}
    >
      {view && (
        <div
          className="canvas-world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        >
          {frames.map((f) => (
            <div
              key={f.key}
              className="canvas-frame"
              style={{ left: f.x, top: 0, width: f.width, height: f.height }}
            >
              {/* Counter-scaled so labels stay a constant size on screen. */}
              <div
                className={`canvas-frame-label ${activeKey === f.key ? 'active' : ''}`}
                style={{ fontSize: 13 / view.s, paddingBottom: 8 / view.s }}
              >
                {f.label} · {f.width}px
              </div>
              <iframe
                key={`${url}-${refreshKey}-${scriptsOn ? 's' : 'ns'}`}
                ref={(el) => (iframeRefs.current[f.key] = el)}
                src={`${url}#avb-design,avb-canvas${scriptsOn ? '' : ',avb-noscript'}`}
                title={`${f.label} preview`}
                onLoad={(e) => {
                  e.currentTarget.contentWindow?.postMessage(
                    { type: 'avb:set-vh', px: f.viewportHeight },
                    '*'
                  );
                  track(f.key);
                }}
              />
              {[
                hovers[f.key] && hovers[f.key] !== selPath
                  ? { path: hovers[f.key], cls: 'hover' }
                  : null,
                selPath ? { path: selPath, cls: 'sel' } : null,
              ]
                .filter(Boolean)
                .flatMap(({ path, cls }) =>
                  (rects[f.key]?.[path] || []).map((r, i) => (
                    <div
                      key={`${cls}-${i}`}
                      className={`canvas-outline ${cls}`}
                      style={{
                        left: r.x,
                        top: r.y,
                        width: r.w,
                        height: r.h,
                        borderWidth: Math.max(1.5 / view.s, 1),
                      }}
                    />
                  ))
                )}
            </div>
          ))}
        </div>
      )}
      {view && (
        <div className="canvas-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button title="Zoom out" onClick={() => zoomTo(view.s / 1.25)}>−</button>
          <button className="pct" title="Zoom to 100%" onClick={() => zoomTo(1)}>
            {Math.round(view.s * 100)}%
          </button>
          <button title="Zoom in" onClick={() => zoomTo(view.s * 1.25)}>+</button>
          <button title="Fit all breakpoints" onClick={fit}>Fit</button>
        </div>
      )}
    </div>
  );
}
