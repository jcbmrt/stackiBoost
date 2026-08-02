import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import CodeEditor from '../ui/CodeEditor.jsx';
import {
  FileIcon,
  FolderIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CodeIcon,
} from '../ui/Icons.jsx';
import { cleanError } from '../App.jsx';

const langFor = (rel) => {
  const ext = (rel.split('.').pop() || '').toLowerCase();
  if (ext === 'css' || ext === 'scss') return 'css';
  if (['astro', 'html', 'svg', 'xml', 'md', 'mdx'].includes(ext)) return 'html';
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'json'].includes(ext)) return 'javascript';
  return 'plain';
};

function buildTree(files) {
  const root = { dirs: {}, files: [] };
  for (const rel of files) {
    const parts = rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      node = node.dirs[parts[i]] || (node.dirs[parts[i]] = { dirs: {}, files: [] });
    }
    node.files.push({ name: parts[parts.length - 1], rel });
  }
  return root;
}

function Dir({ name, node, depth, openRel, onOpen, collapsed, toggle, path }) {
  const isCollapsed = collapsed.has(path);
  return (
    <>
      <button
        className="code-tree-row dir"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => toggle(path)}
      >
        {isCollapsed ? <ChevronRightIcon size={10} /> : <ChevronDownIcon size={10} />}
        <FolderIcon size={12} />
        <span className="label">{name}</span>
      </button>
      {!isCollapsed && (
        <TreeLevel
          node={node}
          depth={depth + 1}
          openRel={openRel}
          onOpen={onOpen}
          collapsed={collapsed}
          toggle={toggle}
          path={path}
        />
      )}
    </>
  );
}

function TreeLevel({ node, depth, openRel, onOpen, collapsed, toggle, path }) {
  return (
    <>
      {Object.keys(node.dirs)
        .sort()
        .map((name) => (
          <Dir
            key={name}
            name={name}
            node={node.dirs[name]}
            depth={depth}
            openRel={openRel}
            onOpen={onOpen}
            collapsed={collapsed}
            toggle={toggle}
            path={path ? `${path}/${name}` : name}
          />
        ))}
      {node.files.map((f) => (
        <button
          key={f.rel}
          className={`code-tree-row file ${openRel === f.rel ? 'on' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 + 14 }}
          onClick={() => onOpen(f.rel)}
          title={f.rel}
        >
          <FileIcon size={11} />
          <span className="label">{f.name}</span>
        </button>
      ))}
    </>
  );
}

export default function CodePanel({ project, initialRel, showToast }) {
  const [files, setFiles] = useState([]);
  const [openRel, setOpenRel] = useState(null);
  const [text, setText] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set(['public']));
  const viewRef = useRef(null);
  const saveTimer = useRef(null);
  const pendingRef = useRef(null); // {rel, text} not yet written
  const lastWriteRef = useRef({}); // rel -> ts, to ignore our own fs echoes
  const openRelRef = useRef(null);
  openRelRef.current = openRel;

  const tree = useMemo(() => buildTree(files), [files]);

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    clearTimeout(saveTimer.current);
    lastWriteRef.current[pending.rel] = Date.now();
    try {
      await window.avb.codeWrite({ projectPath: project.path, rel: pending.rel, text: pending.text });
      if (openRelRef.current === pending.rel) setDirty(false);
    } catch (err) {
      showToast(`Save failed: ${cleanError(err)}`, 'error');
    }
  }, [project.path, showToast]);

  const openFile = useCallback(
    async (rel) => {
      await flush();
      try {
        const { text: t } = await window.avb.codeRead({ projectPath: project.path, rel });
        setOpenRel(rel);
        setText(t);
        setDirty(false);
      } catch (err) {
        showToast(`Could not open ${rel}: ${cleanError(err)}`, 'error');
      }
    },
    [flush, project.path, showToast]
  );

  useEffect(() => {
    window.avb
      .codeList(project.path)
      .then(({ files: f }) => {
        setFiles(f);
        const first =
          (initialRel && f.includes(initialRel) && initialRel) ||
          f.find((x) => /^src\/pages\//.test(x)) ||
          f[0];
        if (first) openFile(first);
      })
      .catch(() => setFiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.path]);

  // save shortly after typing stops
  const onEdit = (t) => {
    setText(t);
    setDirty(true);
    pendingRef.current = { rel: openRelRef.current, text: t };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 350);
  };

  useEffect(() => () => flush(), [flush]);

  // outside edits (the ai, another editor) refresh the open file and the tree
  useEffect(() => {
    const off = window.avb.onFsChanged(async ({ files: changed }) => {
      const rel = openRelRef.current;
      if (!rel) return;
      const abs = `${project.path}/${rel}`;
      const hit = (changed || []).some((f) => f === abs || f.endsWith(`/${rel}`));
      if (!hit || Date.now() - (lastWriteRef.current[rel] || 0) < 1200) return;
      try {
        const { text: t } = await window.avb.codeRead({ projectPath: project.path, rel });
        setText(t);
        setDirty(false);
      } catch {
        /* deleted, keep buffer */
      }
    });
    return off;
  }, [project.path]);

  // the app menu owns cmd+z; while code mode is up it forwards here
  useEffect(() => {
    const u = () => viewRef.current && cmUndo(viewRef.current);
    const r = () => viewRef.current && cmRedo(viewRef.current);
    window.addEventListener('avb:code-undo', u);
    window.addEventListener('avb:code-redo', r);
    return () => {
      window.removeEventListener('avb:code-undo', u);
      window.removeEventListener('avb:code-redo', r);
    };
  }, []);

  const toggle = (path) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="code-mode">
      <div className="code-tree">
        <div className="code-tree-head">
          <CodeIcon size={12} /> {project.name}
        </div>
        <div className="code-tree-body">
          <TreeLevel
            node={tree}
            depth={0}
            openRel={openRel}
            onOpen={openFile}
            collapsed={collapsed}
            toggle={toggle}
            path=""
          />
        </div>
      </div>
      <div className="code-main">
        <div className="code-path">
          <span className="code-path-text">{openRel || 'No file open'}</span>
          <span className={`code-save ${dirty ? 'dirty' : ''}`}>{dirty ? 'Editing…' : 'Saved'}</span>
        </div>
        <div className="code-editor-host">
          {openRel != null && text != null && (
            <CodeEditor
              key={openRel}
              language={langFor(openRel)}
              value={text}
              onChange={onEdit}
              onView={(v) => (viewRef.current = v)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
