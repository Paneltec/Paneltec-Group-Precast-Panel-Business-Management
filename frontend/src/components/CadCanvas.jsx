import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MousePointer2, Pentagon, Square, SquareX, Circle, Anchor, Hand, Undo2, Redo2,
  Maximize2, Magnet, ZoomIn, ZoomOut, Trash2,
} from "lucide-react";

/*
 * CadCanvas — a small CAD-style editor for one panel elevation.
 *
 * Controlled: `value` = { outline: [[x,y]...], openings: [[[x,y]...]...], lifters: [{label,type,x_mm,y_mm,...}] }
 * in millimetres, origin bottom-left, y up. Every finished edit calls onChange(nextValue).
 *
 * Tools: Select (drag corners / openings / lifters, double-click an edge to add a corner),
 * Panel outline (click corners), Rectangle panel (drag), Opening (drag), Round opening
 * (drag centre → radius), Lifter (click; snaps to an edge = edge lifter), Pan.
 * Wheel = zoom at cursor. Shift = straight lines. Esc cancels, Delete removes the selection,
 * Enter closes an outline, Ctrl+Z / Ctrl+Y undo / redo.
 */

const HEIGHT = 520;
const SNAP_PX = 9;
const GRID_OPTIONS = [10, 25, 50, 100, 250, 500];

const TOOLS = [
  { key: "select", label: "Select / move", icon: MousePointer2, hint: "Drag corners, openings or lifters. Double-click an edge to add a corner. Delete removes the selection." },
  { key: "panel", label: "Draw panel outline", icon: Pentagon, hint: "Click each corner. Click the first corner (or press Enter) to close. Hold Shift for straight lines." },
  { key: "rect", label: "Rectangular panel", icon: Square, hint: "Drag from one corner to the opposite corner." },
  { key: "opening", label: "Opening", icon: SquareX, hint: "Drag a rectangle inside the panel." },
  { key: "round", label: "Round penetration", icon: Circle, hint: "Click the centre, drag out to the radius." },
  { key: "lifter", label: "Place lifter (engineer's position)", icon: Anchor, hint: "Click where the engineer specified. Near an edge it snaps on as an edge lifter." },
  { key: "pan", label: "Pan", icon: Hand, hint: "Drag to move the view. (Middle mouse button pans with any tool.)" },
];

const fmt = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
const clone = (v) => JSON.parse(JSON.stringify(v));
const bboxOf = (pts) => {
  const xs = pts.map((p) => +p[0]); const ys = pts.map((p) => +p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const rectPoly = (a, b) => {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
};
const circlePoly = (c, r, n = 24) => Array.from({ length: n }, (_, i) => {
  const t = (i / n) * Math.PI * 2;
  return [Math.round((c[0] + r * Math.cos(t)) * 10) / 10, Math.round((c[1] + r * Math.sin(t)) * 10) / 10];
});
const insidePoly = ([x, y], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// nearest point on any edge of poly → {pt, dist, edge}
const nearestOnEdges = (p, poly) => {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    const q = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.dist) best = { pt: q, dist: d, edge: i };
  }
  return best;
};

export default function CadCanvas({ value, onChange, editable = true, cog = null, allowLifters = true, height = HEIGHT }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [view, setView] = useState({ s: 0.1, tx: 60, ty: HEIGHT - 60 });
  const [tool, setTool] = useState(editable ? "select" : "pan");
  const [grid, setGrid] = useState(100);
  const [snapOn, setSnapOn] = useState(true);
  const [cursor, setCursor] = useState(null);       // world mm (snapped)
  const [draft, setDraft] = useState([]);           // outline points while drawing
  const [dragRect, setDragRect] = useState(null);   // {a, b, kind}
  const [drag, setDrag] = useState(null);           // active move
  const [live, setLive] = useState(null);           // geometry while dragging
  const [sel, setSel] = useState(null);             // {type, i, j?}
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [shift, setShift] = useState(false);

  const geo = live || value;
  const outline = useMemo(() => geo.outline || [], [geo.outline]);
  const openings = useMemo(() => geo.openings || [], [geo.openings]);
  const lifters = useMemo(() => geo.lifters || [], [geo.lifters]);

  // ---------- sizing + view ----------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts = outline.length >= 2 ? outline : [[0, 0], [6000, 3000]];
    const [x0, y0, x1, y1] = bboxOf(pts);
    const w = Math.max(x1 - x0, 500), h = Math.max(y1 - y0, 500);
    const s = Math.min((width - 120) / w, (height - 100) / h);
    setView({ s, tx: (width - w * s) / 2 - x0 * s, ty: height - (height - h * s) / 2 + y0 * s });
  }, [outline, width, height]);

  const fittedOnce = useRef(false);
  useEffect(() => {
    if (!fittedOnce.current && width > 320) { fittedOnce.current = true; fit(); }
  }, [width, fit]);

  const toScreen = useCallback(([x, y]) => [view.tx + x * view.s, view.ty - y * view.s], [view]);
  const toWorld = useCallback((sx, sy) => [(sx - view.tx) / view.s, (view.ty - sy) / view.s], [view]);

  // ---------- history ----------
  const commit = useCallback((next) => {
    setPast((p) => [...p.slice(-49), clone(value)]);
    setFuture([]);
    onChange(next);
  }, [value, onChange]);

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [clone(value), ...f]);
    setPast(past.slice(0, -1));
    onChange(past[past.length - 1]);
  }, [past, value, onChange]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, clone(value)]);
    setFuture(future.slice(1));
    onChange(future[0]);
  }, [future, value, onChange]);

  // Move everything so the panel's bottom-left corner is (0,0) without the view jumping.
  const normalise = useCallback((g) => {
    if (!g.outline || g.outline.length < 3) return g;
    const [x0, y0] = bboxOf(g.outline);
    if (Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6) return g;
    const sh = (p) => [Math.round((p[0] - x0) * 10) / 10, Math.round((p[1] - y0) * 10) / 10];
    setView((v) => ({ ...v, tx: v.tx + x0 * v.s, ty: v.ty - y0 * v.s }));
    return {
      ...g,
      outline: g.outline.map(sh),
      openings: g.openings.map((o) => o.map(sh)),
      lifters: (g.lifters || []).map((l) => ({ ...l, x_mm: Math.round((l.x_mm - x0) * 10) / 10, y_mm: Math.round((l.y_mm - y0) * 10) / 10 })),
    };
  }, []);

  // ---------- snapping ----------
  const allVertices = useMemo(() => [...outline, ...openings.flat(), ...draft], [outline, openings, draft]);
  const snap = useCallback((w, { exclude } = {}) => {
    let p = w;
    if (shift && draft.length) {
      const last = draft[draft.length - 1];
      p = Math.abs(p[0] - last[0]) > Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]];
    }
    if (!snapOn) return [Math.round(p[0]), Math.round(p[1])];
    let best = null;
    allVertices.forEach((v, i) => {
      if (exclude === i) return;
      const d = Math.hypot(v[0] - p[0], v[1] - p[1]) * view.s;
      if (d < SNAP_PX && (!best || d < best.d)) best = { d, v };
    });
    if (best) return [+best.v[0], +best.v[1]];
    const g = grid;
    if (shift && draft.length) {
      const last = draft[draft.length - 1];
      return p[1] === last[1] ? [Math.round(p[0] / g) * g, p[1]] : [p[0], Math.round(p[1] / g) * g];
    }
    return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  }, [allVertices, snapOn, grid, view.s, shift, draft]);

  const eventWorld = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return toWorld(e.clientX - r.left, e.clientY - r.top);
  };

  // ---------- hit testing (select tool) ----------
  const hit = (w) => {
    const px = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * view.s;
    for (let i = 0; i < lifters.length; i++) if (px([lifters[i].x_mm, lifters[i].y_mm], w) < 10) return { type: "lifter", i };
    for (let i = 0; i < outline.length; i++) if (px(outline[i], w) < 8) return { type: "vertex", i };
    for (let i = 0; i < openings.length; i++) {
      for (let j = 0; j < openings[i].length; j++) if (openings[i].length === 4 && px(openings[i][j], w) < 8) return { type: "overtex", i, j };
    }
    for (let i = openings.length - 1; i >= 0; i--) if (insidePoly(w, openings[i])) return { type: "opening", i };
    return null;
  };

  // ---------- pointer handlers ----------
  const onDown = (e) => {
    if (e.button === 1 || tool === "pan" || (!editable && e.button === 0)) {
      e.preventDefault();
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, v: view });
      return;
    }
    if (e.button !== 0) return;
    svgRef.current.focus();
    const w = eventWorld(e);
    const p = snap(w);

    if (tool === "select") {
      const h = hit(w);
      setSel(h);
      if (!h) return;
      setLive(clone(value));
      setDrag({ kind: h.type, ...h, start: p, orig: clone(value) });
      return;
    }
    if (tool === "panel") {
      if (draft.length >= 3 && Math.hypot(draft[0][0] - p[0], draft[0][1] - p[1]) * view.s < SNAP_PX + 2) {
        finishOutline(draft);
      } else if (!draft.length || draft[draft.length - 1][0] !== p[0] || draft[draft.length - 1][1] !== p[1]) {
        setDraft((d) => [...d, p]);
      }
      return;
    }
    if (tool === "rect" || tool === "opening" || tool === "round") {
      setDragRect({ a: p, b: p, kind: tool });
      return;
    }
    if (tool === "lifter" && allowLifters && outline.length >= 3) {
      const near = nearestOnEdges(p, outline);
      const onEdge = near && near.dist * view.s < 14;
      const pos = onEdge ? near.pt.map((n) => Math.round(n)) : p;
      const n = lifters.length + 1;
      commit({ ...value, lifters: [...lifters, { label: `L${n}`, type: onEdge ? "edge" : "face", x_mm: pos[0], y_mm: pos[1], capacity_t: "", product: "" }] });
    }
  };

  const onMove = (e) => {
    if (drag?.kind === "pan") {
      setView({ ...drag.v, tx: drag.v.tx + (e.clientX - drag.sx), ty: drag.v.ty + (e.clientY - drag.sy) });
      return;
    }
    const w = eventWorld(e);
    const excludeIdx = drag?.kind === "vertex" ? drag.i : undefined;
    const p = snap(w, { exclude: excludeIdx });
    setCursor(p);
    if (dragRect) { setDragRect((r) => ({ ...r, b: p })); return; }
    if (!drag || !live) return;
    const g = clone(drag.orig);
    const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    if (drag.kind === "vertex") g.outline[drag.i] = p;
    if (drag.kind === "opening") g.openings[drag.i] = g.openings[drag.i].map(([x, y]) => [x + dx, y + dy]);
    if (drag.kind === "overtex") {
      // rectangles stay rectangular: move the dragged corner, keep the opposite one
      const o = g.openings[drag.i];
      const opp = o[(drag.j + 2) % 4];
      g.openings[drag.i] = rectPoly(opp, p);
    }
    if (drag.kind === "lifter") {
      const l = g.lifters[drag.i];
      const near = nearestOnEdges(p, g.outline);
      const onEdge = near && near.dist * view.s < 14;
      const pos = onEdge ? near.pt.map((n) => Math.round(n)) : p;
      g.lifters[drag.i] = { ...l, x_mm: pos[0], y_mm: pos[1], type: onEdge ? "edge" : "face" };
    }
    setLive(g);
  };

  const onUp = () => {
    if (drag?.kind === "pan") { setDrag(null); return; }
    if (dragRect) {
      const { a, b, kind } = dragRect;
      setDragRect(null);
      if (kind === "round") {
        const r = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (r * view.s > 3) commit({ ...value, openings: [...openings, circlePoly(a, Math.round(r))] });
        return;
      }
      if (Math.abs(b[0] - a[0]) * view.s < 4 || Math.abs(b[1] - a[1]) * view.s < 4) return;
      if (kind === "rect") commit(normalise({ ...value, outline: rectPoly(a, b) }));
      else commit({ ...value, openings: [...openings, rectPoly(a, b)] });
      return;
    }
    if (drag && live) {
      const moved = JSON.stringify(live) !== JSON.stringify(drag.orig);
      if (moved) commit(drag.kind === "vertex" ? normalise(live) : live);
    }
    setDrag(null); setLive(null);
  };

  const finishOutline = (pts) => {
    if (pts.length < 3) return;
    setDraft([]);
    commit(normalise({ ...value, outline: pts }));
    setTool("select");
  };

  const onDouble = (e) => {
    if (tool !== "select" || !editable || outline.length < 3) return;
    const w = eventWorld(e);
    const near = nearestOnEdges(w, outline);
    if (!near || near.dist * view.s > 8) return;
    const p = snapOn ? snap(near.pt) : near.pt.map(Math.round);
    const next = [...outline];
    next.splice(near.edge + 1, 0, p);
    commit({ ...value, outline: next });
  };

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const r = svgRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    setView((v) => {
      const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const s = Math.min(5, Math.max(0.005, v.s * k));
      const wx = (sx - v.tx) / v.s, wy = (v.ty - sy) / v.s;
      return { s, tx: sx - wx * s, ty: sy + wy * s };
    });
  }, []);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const zoomBy = (k) => setView((v) => {
    const sx = width / 2, sy = height / 2;
    const s = Math.min(5, Math.max(0.005, v.s * k));
    const wx = (sx - v.tx) / v.s, wy = (v.ty - sy) / v.s;
    return { s, tx: sx - wx * s, ty: sy + wy * s };
  });

  const deleteSelection = useCallback(() => {
    if (!sel || !editable) return;
    if (sel.type === "opening" || sel.type === "overtex") commit({ ...value, openings: openings.filter((_, i) => i !== sel.i) });
    else if (sel.type === "lifter") commit({ ...value, lifters: lifters.filter((_, i) => i !== sel.i).map((l, i) => (/^L\d+$/.test(l.label || "") ? { ...l, label: `L${i + 1}` } : l)) });
    else if (sel.type === "vertex" && outline.length > 3) commit(normalise({ ...value, outline: outline.filter((_, i) => i !== sel.i) }));
    setSel(null);
  }, [sel, editable, value, openings, lifters, outline, commit, normalise]);

  const onKey = (e) => {
    if (e.key === "Shift") setShift(true);
    if (e.key === "Escape") { setDraft([]); setDragRect(null); setSel(null); }
    if (e.key === "Enter" && tool === "panel") finishOutline(draft);
    if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); deleteSelection(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
  };

  // ---------- drawing ----------
  const pts = (poly) => poly.map((p) => toScreen(p).map((n) => n.toFixed(1)).join(",")).join(" ");
  const gridLayer = useMemo(() => {
    let g = grid;
    while (g * view.s < 10) g *= 5;
    const [wx0, wy1] = toWorld(0, 0), [wx1, wy0] = toWorld(width, height);
    const dots = [];
    const xs = Math.floor(wx0 / g) * g, ys = Math.floor(wy0 / g) * g;
    if ((wx1 - xs) / g * ((wy1 - ys) / g) > 6000) return null;
    for (let x = xs; x <= wx1; x += g) for (let y = ys; y <= wy1; y += g) {
      const [sx, sy] = toScreen([x, y]);
      dots.push(<circle key={`${x},${y}`} cx={sx} cy={sy} r={0.9} fill="#9AA5AE" />);
    }
    return dots;
  }, [grid, view, width, height, toScreen, toWorld]);

  const activeTool = TOOLS.find((t) => t.key === tool);
  const [ox, oy] = toScreen([0, 0]);
  const draftLen = draft.length && cursor ? Math.hypot(cursor[0] - draft[draft.length - 1][0], cursor[1] - draft[draft.length - 1][1]) : 0;

  return (
    <div ref={wrapRef} className="border border-gray-300 rounded overflow-hidden select-none" data-testid="cad-canvas">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1 bg-[#F5F6F7] border-b border-gray-300 px-2 py-1.5">
        {TOOLS.filter((t) => editable || t.key === "pan").filter((t) => allowLifters || t.key !== "lifter").map((t) => {
          const I = t.icon;
          return (
            <button key={t.key} type="button" title={t.label} aria-label={t.label} aria-pressed={tool === t.key}
              onClick={() => { setTool(t.key); setDraft([]); }}
              className={`h-8 w-8 inline-flex items-center justify-center rounded border ${tool === t.key ? "bg-[#1F2A33] text-white border-[#1F2A33]" : "bg-white text-[#1F2A33] border-gray-300 hover:bg-gray-100"}`}
              data-testid={`cad-tool-${t.key}`}>
              <I className="w-4 h-4" />
            </button>
          );
        })}
        <span className="w-px h-6 bg-gray-300 mx-1" />
        {editable && (
          <>
            <IconBtn title="Undo (Ctrl+Z)" onClick={undo} disabled={!past.length}><Undo2 className="w-4 h-4" /></IconBtn>
            <IconBtn title="Redo (Ctrl+Y)" onClick={redo} disabled={!future.length}><Redo2 className="w-4 h-4" /></IconBtn>
            <IconBtn title="Delete selected" onClick={deleteSelection} disabled={!sel}><Trash2 className="w-4 h-4" /></IconBtn>
            <span className="w-px h-6 bg-gray-300 mx-1" />
          </>
        )}
        <IconBtn title="Zoom in" onClick={() => zoomBy(1.3)}><ZoomIn className="w-4 h-4" /></IconBtn>
        <IconBtn title="Zoom out" onClick={() => zoomBy(1 / 1.3)}><ZoomOut className="w-4 h-4" /></IconBtn>
        <IconBtn title="Fit panel to view" onClick={fit}><Maximize2 className="w-4 h-4" /></IconBtn>
        <span className="w-px h-6 bg-gray-300 mx-1" />
        <button type="button" title="Snap to grid and corners" aria-pressed={snapOn} onClick={() => setSnapOn((s) => !s)}
          className={`h-8 px-2 inline-flex items-center gap-1 rounded border text-xs font-semibold ${snapOn ? "bg-[#3A6B8C] text-white border-[#3A6B8C]" : "bg-white text-gray-600 border-gray-300"}`}>
          <Magnet className="w-4 h-4" /> Snap
        </button>
        <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} aria-label="Grid spacing"
          className="h-8 border border-gray-300 rounded text-xs px-1 bg-white">
          {GRID_OPTIONS.map((g) => <option key={g} value={g}>Grid {g} mm</option>)}
        </select>
      </div>

      {/* drawing area */}
      <svg ref={svgRef} width={width} height={height} tabIndex={0}
        className={`block bg-white outline-none ${tool === "pan" || drag?.kind === "pan" ? "cursor-grab" : tool === "select" ? "cursor-default" : "cursor-crosshair"}`}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { setCursor(null); if (drag?.kind === "pan") setDrag(null); }}
        onDoubleClick={onDouble} onKeyDown={onKey} onKeyUp={(e) => e.key === "Shift" && setShift(false)}
        onContextMenu={(e) => { e.preventDefault(); if (draft.length) finishOutline(draft); }}>
        {gridLayer}
        {/* origin */}
        <g stroke="#3A6B8C" strokeWidth="1">
          <line x1={ox - 10} y1={oy} x2={ox + 24} y2={oy} /><line x1={ox} y1={oy + 10} x2={ox} y2={oy - 24} />
        </g>
        <text x={ox + 4} y={oy + 14} fontSize="10" fill="#3A6B8C">0,0</text>

        {outline.length >= 3 && (
          <path fillRule="evenodd" fill="#FDECEA" fillOpacity="0.55" stroke="#C0392B" strokeWidth="2"
            d={`M ${pts(outline).replace(/ /g, " L ")} Z ${openings.map((o) => `M ${pts(o).replace(/ /g, " L ")} Z`).join(" ")}`} />
        )}
        {openings.map((o, i) => {
          const [x0, y0, x1, y1] = bboxOf(o);
          const a = toScreen([x0, y0]), b = toScreen([x1, y1]);
          const isSel = sel && (sel.type === "opening" || sel.type === "overtex") && sel.i === i;
          return (
            <g key={`o${i}`}>
              <polygon points={pts(o)} fill="#fff" stroke={isSel ? "#3A6B8C" : "#C0392B"} strokeWidth={isSel ? 2.5 : 1.5} />
              {o.length === 4 && <><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#C0392B" strokeWidth="0.8" /><line x1={a[0]} y1={b[1]} x2={b[0]} y2={a[1]} stroke="#C0392B" strokeWidth="0.8" /></>}
              {isSel && <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 + 4} textAnchor="middle" fontSize="11" fill="#3A6B8C" fontWeight="bold">{fmt(x1 - x0)} × {fmt(y1 - y0)}</text>}
              {tool === "select" && editable && o.length === 4 && o.map((p, j) => { const s = toScreen(p); return <rect key={j} x={s[0] - 3} y={s[1] - 3} width="6" height="6" fill="#fff" stroke="#3A6B8C" />; })}
            </g>
          );
        })}
        {tool === "select" && editable && outline.map((p, i) => {
          const s = toScreen(p);
          const isSel = sel?.type === "vertex" && sel.i === i;
          return <rect key={`v${i}`} x={s[0] - 4} y={s[1] - 4} width="8" height="8" fill={isSel ? "#3A6B8C" : "#fff"} stroke="#1F2A33" />;
        })}
        {cog && outline.length >= 3 && (() => {
          const [cx, cy] = toScreen([cog[0], cog[1]]);
          return <g><circle cx={cx} cy={cy} r="7" fill="#fff" stroke="#1F2A33" strokeWidth="1.2" /><path d={`M ${cx} ${cy} L ${cx + 7} ${cy} A 7 7 0 0 0 ${cx} ${cy - 7} Z M ${cx} ${cy} L ${cx - 7} ${cy} A 7 7 0 0 0 ${cx} ${cy + 7} Z`} fill="#1F2A33" /><text x={cx + 10} y={cy + 14} fontSize="10" fill="#1F2A33">CoG</text></g>;
        })()}
        {lifters.map((l, i) => {
          const [x, y] = toScreen([+l.x_mm, +l.y_mm]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const isSel = sel?.type === "lifter" && sel.i === i;
          return (
            <g key={`l${i}`}>
              {l.type === "edge"
                ? <polygon points={`${x},${y - 9} ${x + 8},${y + 6} ${x - 8},${y + 6}`} fill="#F5C518" stroke={isSel ? "#3A6B8C" : "#1F2A33"} strokeWidth={isSel ? 2.5 : 1.2} />
                : <circle cx={x} cy={y} r="7" fill="#F5C518" stroke={isSel ? "#3A6B8C" : "#1F2A33"} strokeWidth={isSel ? 2.5 : 1.2} />}
              <text x={x + 10} y={y - 8} fontSize="11" fontWeight="bold" fill="#1F2A33">{l.label || `L${i + 1}`}</text>
            </g>
          );
        })}

        {/* drafts */}
        {draft.length > 0 && (
          <>
            <polyline points={pts(cursor ? [...draft, cursor] : draft)} fill="none" stroke="#3A6B8C" strokeWidth="1.5" strokeDasharray="6 4" />
            {draft.map((p, i) => { const s = toScreen(p); return <rect key={i} x={s[0] - 3} y={s[1] - 3} width="6" height="6" fill={i === 0 ? "#3A6B8C" : "#fff"} stroke="#3A6B8C" />; })}
          </>
        )}
        {dragRect && dragRect.kind !== "round" && (
          <polygon points={pts(rectPoly(dragRect.a, dragRect.b))} fill="#3A6B8C" fillOpacity="0.08" stroke="#3A6B8C" strokeDasharray="6 4" />
        )}
        {dragRect && dragRect.kind === "round" && (() => {
          const [cx, cy] = toScreen(dragRect.a);
          const r = Math.hypot(dragRect.b[0] - dragRect.a[0], dragRect.b[1] - dragRect.a[1]);
          return <circle cx={cx} cy={cy} r={r * view.s} fill="#3A6B8C" fillOpacity="0.08" stroke="#3A6B8C" strokeDasharray="6 4" />;
        })()}
        {cursor && tool !== "select" && tool !== "pan" && (() => {
          const [cx, cy] = toScreen(cursor);
          let label = "";
          if (draft.length) label = `${fmt(draftLen)}`;
          if (dragRect && dragRect.kind !== "round") label = `${fmt(Math.abs(dragRect.b[0] - dragRect.a[0]))} × ${fmt(Math.abs(dragRect.b[1] - dragRect.a[1]))}`;
          if (dragRect && dragRect.kind === "round") label = `Ø ${fmt(2 * Math.hypot(dragRect.b[0] - dragRect.a[0], dragRect.b[1] - dragRect.a[1]))}`;
          return (
            <g pointerEvents="none">
              <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="#1F2A33" strokeWidth="0.8" />
              <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke="#1F2A33" strokeWidth="0.8" />
              {label && <><rect x={cx + 10} y={cy + 8} width={label.length * 7 + 8} height="17" fill="#1F2A33" rx="2" /><text x={cx + 14} y={cy + 20} fontSize="11" fill="#fff">{label}</text></>}
            </g>
          );
        })()}
      </svg>

      {/* status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-[#F5F6F7] border-t border-gray-300 px-3 py-1.5 text-[11px] text-gray-700">
        <span className="font-mono tabular-nums w-40">{cursor ? `x: ${fmt(cursor[0])}  y: ${fmt(cursor[1])}` : "x: —  y: —"}</span>
        <span className="font-semibold text-[#1F2A33]">{activeTool?.label}</span>
        <span className="text-gray-500">{activeTool?.hint}</span>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, disabled, children }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className="h-8 w-8 inline-flex items-center justify-center rounded border bg-white text-[#1F2A33] border-gray-300 hover:bg-gray-100 disabled:opacity-40">
      {children}
    </button>
  );
}
