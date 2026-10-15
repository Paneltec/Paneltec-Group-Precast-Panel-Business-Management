"""Panel geometry — pure functions, no database.

Used by the Panels register (server.py) for:
  * area / volume / weight / centre-of-gravity calculations
  * reading panel outlines + openings from DXF files
  * drawing a panel elevation as SVG for the shop drawing PDF and the UI preview

Conventions
-----------
* All lengths are millimetres. Origin is the bottom-left corner of the panel
  (x to the right, y up), i.e. an elevation view as drawn on a shop drawing.
* A polygon is a list of [x, y] points. It may be given open (last != first);
  closing is implied.

SAFETY NOTE: nothing in this module designs lifting. Lifter positions are only
ever *recorded* from the structural engineer and drawn where they say.
"""
from __future__ import annotations

import io
import math
import os
import re
import tempfile
from html import escape
from typing import Any, Dict, List, Optional, Sequence, Tuple

Point = Tuple[float, float]
Polygon = List[Point]

MIN_LOOP_AREA_MM2 = 100.0       # ignore DXF loops smaller than 10 x 10 mm
CHAIN_TOL_MM = 0.5              # endpoint snap tolerance when chaining LINE/ARC

# ---------------------------------------------------------------------------
# Basic polygon maths
# ---------------------------------------------------------------------------

def clean_polygon(pts: Sequence[Sequence[float]]) -> Polygon:
    """Float-ify, drop the repeated closing point and consecutive duplicates."""
    out: Polygon = []
    for p in pts or []:
        x, y = float(p[0]), float(p[1])
        if not (math.isfinite(x) and math.isfinite(y)):
            raise ValueError("Polygon contains a non-numeric point")
        if out and abs(out[-1][0] - x) < 1e-9 and abs(out[-1][1] - y) < 1e-9:
            continue
        out.append((x, y))
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < 1e-9 and abs(out[0][1] - out[-1][1]) < 1e-9:
        out.pop()
    return out


def signed_area(poly: Polygon) -> float:
    s = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def area(poly: Polygon) -> float:
    return abs(signed_area(poly))


def centroid(poly: Polygon) -> Point:
    a = signed_area(poly)
    if abs(a) < 1e-12:
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        return (sum(xs) / len(xs), sum(ys) / len(ys))
    cx = cy = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return (cx / (6.0 * a), cy / (6.0 * a))


def perimeter(poly: Polygon) -> float:
    n = len(poly)
    return sum(math.dist(poly[i], poly[(i + 1) % n]) for i in range(n))


def bbox(poly: Polygon) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_polygon(pt: Point, poly: Polygon) -> bool:
    """Ray casting. Points exactly on an edge count as inside."""
    x, y = pt
    n = len(poly)
    inside = False
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        # on-segment check
        cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
        if abs(cross) < 1e-6 and min(x1, x2) - 1e-6 <= x <= max(x1, x2) + 1e-6 \
                and min(y1, y2) - 1e-6 <= y <= max(y1, y2) + 1e-6:
            return True
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin:
                inside = not inside
    return inside


def _segments_cross(a: Point, b: Point, c: Point, d: Point) -> bool:
    """True when segments ab and cd properly intersect (touching ends don't count)."""
    def orient(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return 0 if abs(v) < 1e-6 else (1 if v > 0 else -1)
    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return o1 * o2 < 0 and o3 * o4 < 0


def polygons_overlap(p: Polygon, q: Polygon) -> bool:
    """True if the interiors of two simple polygons overlap."""
    for i in range(len(p)):
        for j in range(len(q)):
            if _segments_cross(p[i], p[(i + 1) % len(p)], q[j], q[(j + 1) % len(q)]):
                return True
    # one fully inside the other (test an interior-ish point: the centroid)
    if point_in_polygon(centroid(p), q) or point_in_polygon(centroid(q), p):
        return True
    return False


def rectangle(x: float, y: float, w: float, h: float) -> Polygon:
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


# ---------------------------------------------------------------------------
# Validation + calculation
# ---------------------------------------------------------------------------

def validate_geometry(outline: Sequence, openings: Sequence) -> Tuple[Polygon, List[Polygon]]:
    """Return cleaned (outline, openings). Raises ValueError with a friendly
    message when the shape can't be a real panel."""
    o = clean_polygon(outline)
    if len(o) < 3:
        raise ValueError("Panel outline needs at least 3 corner points")
    if area(o) < MIN_LOOP_AREA_MM2:
        raise ValueError("Panel outline has no area — check the corner points")
    ops: List[Polygon] = []
    for i, raw in enumerate(openings or [], start=1):
        op = clean_polygon(raw)
        if len(op) < 3 or area(op) < 1.0:
            raise ValueError(f"Opening {i} needs at least 3 corner points and some area")
        for pt in op:
            if not point_in_polygon(pt, o):
                raise ValueError(f"Opening {i} sits outside the panel outline")
        if any(
            _segments_cross(op[a], op[(a + 1) % len(op)], o[b], o[(b + 1) % len(o)])
            for a in range(len(op)) for b in range(len(o))
        ):
            raise ValueError(f"Opening {i} crosses the panel edge")
        for j, other in enumerate(ops, start=1):
            if polygons_overlap(op, other):
                raise ValueError(f"Openings {j} and {i} overlap")
        ops.append(op)
    if sum(area(p) for p in ops) >= area(o):
        raise ValueError("Openings take up the whole panel")
    return o, ops


def calculate(outline: Sequence, openings: Sequence, thickness_mm: float,
              concrete_density_kg_m3: float = 2500.0,
              reinforcement_kg_m3: float = 0.0) -> Dict[str, Any]:
    """Area, volume, weight and centre of gravity for one panel.

    Weight = net volume x (concrete density + reinforcement density). The
    reinforcement allowance is an estimate (kg of steel per m3 of concrete) —
    the same method the quote calculator uses.
    """
    if not thickness_mm or float(thickness_mm) <= 0:
        raise ValueError("Thickness must be greater than 0 mm")
    o, ops = validate_geometry(outline, openings)
    t = float(thickness_mm)
    gross = area(o)
    holes = sum(area(p) for p in ops)
    net = gross - holes
    gcx, gcy = centroid(o)
    mx = gross * gcx - sum(area(p) * centroid(p)[0] for p in ops)
    my = gross * gcy - sum(area(p) * centroid(p)[1] for p in ops)
    cog_x, cog_y = mx / net, my / net
    x0, y0, x1, y1 = bbox(o)
    volume_m3 = net * t / 1e9
    concrete_kg = volume_m3 * float(concrete_density_kg_m3 or 0)
    steel_kg = volume_m3 * float(reinforcement_kg_m3 or 0)
    total_kg = concrete_kg + steel_kg
    return {
        "width_mm": round(x1 - x0, 1),
        "height_mm": round(y1 - y0, 1),
        "thickness_mm": round(t, 1),
        "gross_area_m2": round(gross / 1e6, 4),
        "openings_area_m2": round(holes / 1e6, 4),
        "net_area_m2": round(net / 1e6, 4),
        "perimeter_m": round(perimeter(o) / 1000.0, 3),
        "opening_count": len(ops),
        "volume_m3": round(volume_m3, 4),
        "concrete_weight_kg": round(concrete_kg, 1),
        "steel_weight_kg": round(steel_kg, 1),
        "total_weight_kg": round(total_kg, 1),
        "total_weight_t": round(total_kg / 1000.0, 3),
        "cog_x_mm": round(cog_x, 1),
        "cog_y_mm": round(cog_y, 1),
        "concrete_density_kg_m3": float(concrete_density_kg_m3 or 0),
        "reinforcement_kg_m3": float(reinforcement_kg_m3 or 0),
    }


# ---------------------------------------------------------------------------
# DXF import
# ---------------------------------------------------------------------------

_INSUNITS_TO_MM = {1: 25.4, 2: 304.8, 4: 1.0, 5: 10.0, 6: 1000.0, 14: 100.0}
_MARK_RE = re.compile(r"^[A-Za-z]{0,6}[-_ ]?\d{1,4}[A-Za-z]?$")


def _flatten_entity(e, out_loops: List[Polygon], out_open: List[Polygon],
                    out_text: List[Tuple[str, Point]], depth: int = 0):
    import ezdxf.path as ezpath
    t = e.dxftype()
    if t == "INSERT" and depth < 4:
        try:
            for ve in e.virtual_entities():
                _flatten_entity(ve, out_loops, out_open, out_text, depth + 1)
        except Exception:
            pass
        return
    if t in ("TEXT", "MTEXT"):
        try:
            txt = e.plain_text() if t == "MTEXT" else e.dxf.text
            ins = e.dxf.insert
            out_text.append((str(txt).strip(), (float(ins.x), float(ins.y))))
        except Exception:
            pass
        return
    if t not in ("LWPOLYLINE", "POLYLINE", "LINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE"):
        return
    try:
        p = ezpath.make_path(e)
        pts = [(float(v.x), float(v.y)) for v in p.flattening(distance=0.5)]
    except Exception:
        return
    if len(pts) < 2:
        return
    closed = t == "CIRCLE" or math.dist(pts[0], pts[-1]) <= CHAIN_TOL_MM
    if t in ("LWPOLYLINE", "POLYLINE"):
        closed = closed or bool(getattr(e, "is_closed", False) or getattr(e, "closed", False))
    (out_loops if closed else out_open).append(pts)


def _chain_open(pieces: List[Polygon], tol: float) -> List[Polygon]:
    """Join loose LINE/ARC pieces end-to-end into closed loops."""
    remaining = [list(p) for p in pieces]
    loops: List[Polygon] = []
    while remaining:
        chain = remaining.pop(0)
        grew = True
        while grew and math.dist(chain[0], chain[-1]) > tol:
            grew = False
            for i, seg in enumerate(remaining):
                if math.dist(chain[-1], seg[0]) <= tol:
                    chain += seg[1:]
                elif math.dist(chain[-1], seg[-1]) <= tol:
                    chain += list(reversed(seg))[1:]
                elif math.dist(chain[0], seg[-1]) <= tol:
                    chain = seg[:-1] + chain
                elif math.dist(chain[0], seg[0]) <= tol:
                    chain = list(reversed(seg))[:-1] + chain
                else:
                    continue
                remaining.pop(i)
                grew = True
                break
        if len(chain) >= 3 and math.dist(chain[0], chain[-1]) <= tol:
            loops.append(chain)
    return loops


def parse_dxf(data: bytes, filename: str = "upload.dxf") -> Dict[str, Any]:
    """Read panels from a DXF.

    Rules:
      * every closed shape that isn't inside another shape is a panel outline
      * closed shapes directly inside a panel are its openings
      * a short text label inside a panel (e.g. "P01", "W-12") becomes its mark
      * drawing units come from the DXF header; unitless drawings whose
        shapes are tiny are assumed to be in metres

    Returns {"panels": [...], "warnings": [...], "units": "..."}.
    """
    import ezdxf
    from ezdxf import recover

    warnings: List[str] = []
    if not data:
        raise ValueError("The file is empty")
    fd, tmp = tempfile.mkstemp(suffix=".dxf")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        try:
            doc, auditor = recover.readfile(tmp)
        except Exception:
            raise ValueError("This doesn't look like a DXF file. In your CAD program use 'Save As' → DXF.")
    finally:
        try: os.unlink(tmp)
        except OSError: pass

    loops: List[Polygon] = []
    open_pieces: List[Polygon] = []
    texts: List[Tuple[str, Point]] = []
    for e in doc.modelspace():
        _flatten_entity(e, loops, open_pieces, texts)
    loops += _chain_open(open_pieces, CHAIN_TOL_MM)
    loops = [clean_polygon(l) for l in loops]
    loops = [l for l in loops if len(l) >= 3 and area(l) > 0]
    if not loops:
        raise ValueError("No closed shapes found. Panel outlines must be closed polylines (or lines that join up).")

    # Units → mm
    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    if insunits in _INSUNITS_TO_MM:
        scale = _INSUNITS_TO_MM[insunits]
        units = {1: "inches", 2: "feet", 4: "mm", 5: "cm", 6: "metres", 14: "decimetres"}[insunits]
    else:
        biggest = max(max(bbox(l)[2] - bbox(l)[0], bbox(l)[3] - bbox(l)[1]) for l in loops)
        if biggest < 100:
            scale, units = 1000.0, "metres (assumed)"
            warnings.append("The drawing has no units set and the shapes are small, so they were read as metres.")
        else:
            scale, units = 1.0, "mm (assumed)"
    if scale != 1.0:
        loops = [[(x * scale, y * scale) for x, y in l] for l in loops]
        texts = [(t, (p[0] * scale, p[1] * scale)) for t, p in texts]

    loops = [l for l in loops if area(l) >= MIN_LOOP_AREA_MM2]
    loops.sort(key=area, reverse=True)

    # Containment tree: parent = smallest earlier (larger) loop containing this one
    parent: List[Optional[int]] = []
    for i, l in enumerate(loops):
        par = None
        probe = l[0]
        for j in range(i - 1, -1, -1):
            if area(loops[j]) > area(l) and point_in_polygon(probe, loops[j]) \
                    and all(point_in_polygon(p, loops[j]) for p in l[:: max(1, len(l) // 8)]):
                par = j
                break
        parent.append(par)

    def depth(i: int) -> int:
        d = 0
        while parent[i] is not None:
            i = parent[i]; d += 1
        return d

    panels: List[Dict[str, Any]] = []
    index_of_panel: Dict[int, int] = {}
    skipped_deep = 0
    for i, l in enumerate(loops):
        d = depth(i)
        if d == 0:
            index_of_panel[i] = len(panels)
            panels.append({"outline": l, "openings": []})
        elif d == 1:
            panels[index_of_panel[parent[i]]]["openings"].append(l)
        else:
            skipped_deep += 1
    if skipped_deep:
        warnings.append(f"{skipped_deep} shape(s) drawn inside openings were ignored.")

    # Duplicate outlines (e.g. a closed polyline drawn on top of lines) — keep one
    seen = set()
    uniq = []
    for p in panels:
        x0, y0, x1, y1 = bbox(p["outline"])
        key = (round(x0), round(y0), round(x1), round(y1), round(area(p["outline"])))
        if key in seen:
            continue
        seen.add(key); uniq.append(p)
    if len(uniq) != len(panels):
        warnings.append(f"{len(panels) - len(uniq)} duplicate outline(s) were ignored.")
    panels = uniq

    # Marks from text inside each panel (not inside an opening)
    for p in panels:
        cands = [t for t, pos in texts
                 if t and point_in_polygon(pos, p["outline"])
                 and not any(point_in_polygon(pos, op) for op in p["openings"])]
        good = [t for t in cands if _MARK_RE.match(t)]
        p["mark"] = (good or cands or [""])[0][:30]

    # Order panels left-to-right, top-to-bottom as drawn
    panels.sort(key=lambda p: (-round(bbox(p["outline"])[3] / 1000.0), bbox(p["outline"])[0]))

    # Move each panel so its bottom-left corner is (0, 0); round to 0.1 mm
    result = []
    for n, p in enumerate(panels, start=1):
        x0, y0, _, _ = bbox(p["outline"])
        def shift(poly):
            return [[round(x - x0, 1), round(y - y0, 1)] for x, y in poly]
        outline = shift(p["outline"])
        openings = [shift(o) for o in p["openings"]]
        item = {
            "mark": p["mark"] or f"P{n:02d}",
            "mark_from_drawing": bool(p["mark"]),
            "outline": outline,
            "openings": openings,
            "width_mm": round(bbox(p["outline"])[2] - x0, 1),
            "height_mm": round(bbox(p["outline"])[3] - y0, 1),
        }
        try:
            validate_geometry(outline, openings)
            item["valid"] = True; item["problem"] = ""
        except ValueError as ex:
            item["valid"] = False; item["problem"] = str(ex)
        result.append(item)

    return {"panels": result, "warnings": warnings, "units": units, "filename": filename}


# ---------------------------------------------------------------------------
# DXF export (single panel) — handy to send outlines back to CAD
# ---------------------------------------------------------------------------

def export_dxf(panels: List[Dict[str, Any]]) -> bytes:
    import ezdxf
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4
    for name, color in (("PANEL", 7), ("OPENING", 1), ("LIFTER", 3), ("TEXT", 2)):
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    msp = doc.modelspace()
    gap = 1000.0
    x_off = 0.0
    for p in panels:
        o = clean_polygon(p["outline"])
        x0, y0, x1, y1 = bbox(o)
        def mv(poly): return [(x - x0 + x_off, y - y0) for x, y in poly]
        msp.add_lwpolyline(mv(o), close=True, dxfattribs={"layer": "PANEL"})
        for op in p.get("openings") or []:
            msp.add_lwpolyline(mv(clean_polygon(op)), close=True, dxfattribs={"layer": "OPENING"})
        for lf in (p.get("lifting") or {}).get("lifters") or []:
            msp.add_circle((lf["x_mm"] - x0 + x_off, lf["y_mm"] - y0), 40, dxfattribs={"layer": "LIFTER"})
        msp.add_text(p.get("mark") or "", height=150, dxfattribs={"layer": "TEXT"}).set_placement(
            (x_off + (x1 - x0) / 2, (y1 - y0) / 2))
        x_off += (x1 - x0) + gap
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# SVG elevation drawing
# ---------------------------------------------------------------------------

def _fmt(n: float) -> str:
    return f"{n:.0f}" if abs(n - round(n)) < 0.05 else f"{n:.1f}"


def _chain_values(values: List[float], lo: float, hi: float, limit: int = 14) -> List[float]:
    vals = sorted({round(v, 1) for v in values if lo - 0.05 <= v <= hi + 0.05} | {round(lo, 1), round(hi, 1)})
    if len(vals) > limit:
        return [round(lo, 1), round(hi, 1)]
    return vals


def render_svg(outline: Sequence, openings: Sequence, calc: Optional[Dict[str, Any]] = None,
               lifters: Optional[List[Dict[str, Any]]] = None, *, width_px: float = 900,
               height_px: float = 520, show_dimensions: bool = True, show_cog: bool = True,
               show_lifters: bool = True, mark: str = "") -> str:
    """Elevation of one panel with dimension chains, CoG and recorded lifters.
    Returns a standalone <svg> string (works in browsers and WeasyPrint)."""
    o = clean_polygon(outline)
    ops = [clean_polygon(p) for p in (openings or [])]
    x0, y0, x1, y1 = bbox(o)
    pw, ph = max(x1 - x0, 1.0), max(y1 - y0, 1.0)
    pad_l, pad_r, pad_t, pad_b = (110, 40, 40, 110) if show_dimensions else (30, 30, 30, 30)
    s = min((width_px - pad_l - pad_r) / pw, (height_px - pad_t - pad_b) / ph)
    dw, dh = pw * s, ph * s
    ox = pad_l + (width_px - pad_l - pad_r - dw) / 2
    oy = pad_t + (height_px - pad_t - pad_b - dh) / 2

    def X(x): return ox + (x - x0) * s
    def Y(y): return oy + (y1 - y) * s
    def pts(poly): return " ".join(f"{X(x):.2f},{Y(y):.2f}" for x, y in poly)

    ink, mid, light = "#1F2A33", "#3A6B8C", "#9AA5AE"
    parts: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width_px:.0f} {height_px:.0f}" '
        f'width="100%" font-family="Helvetica, Arial, sans-serif" font-size="12">',
        '<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" '
        'patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#C9D2D9" stroke-width="1"/></pattern>'
        f'<marker id="tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8">'
        f'<line x1="1" y1="9" x2="9" y2="1" stroke="{ink}" stroke-width="1.4"/></marker></defs>',
    ]
    # panel body with openings cut out (evenodd)
    d = "M " + " L ".join(f"{X(x):.2f} {Y(y):.2f}" for x, y in o) + " Z"
    for op in ops:
        d += " M " + " L ".join(f"{X(x):.2f} {Y(y):.2f}" for x, y in op) + " Z"
    parts.append(f'<path d="{d}" fill="url(#hatch)" fill-rule="evenodd" stroke="{ink}" stroke-width="2"/>')
    # opening cross marks + size labels
    for i, op in enumerate(ops, start=1):
        bx0, by0, bx1, by1 = bbox(op)
        parts.append(f'<polygon points="{pts(op)}" fill="#fff" stroke="{ink}" stroke-width="1.5"/>')
        parts.append(f'<line x1="{X(bx0):.2f}" y1="{Y(by0):.2f}" x2="{X(bx1):.2f}" y2="{Y(by1):.2f}" stroke="{light}" stroke-width="0.8"/>')
        parts.append(f'<line x1="{X(bx0):.2f}" y1="{Y(by1):.2f}" x2="{X(bx1):.2f}" y2="{Y(by0):.2f}" stroke="{light}" stroke-width="0.8"/>')
        if (bx1 - bx0) * s > 60 and (by1 - by0) * s > 26:
            cx, cy = X((bx0 + bx1) / 2), Y((by0 + by1) / 2)
            parts.append(f'<rect x="{cx-44:.1f}" y="{cy-10:.1f}" width="88" height="18" fill="#fff" opacity="0.9"/>')
            parts.append(f'<text x="{cx:.1f}" y="{cy+4:.1f}" text-anchor="middle" fill="{mid}" font-size="11">'
                         f'{_fmt(bx1-bx0)} × {_fmt(by1-by0)}</text>')

    if show_dimensions:
        # chain = panel corners + each opening's extents (round/shaped openings
        # contribute their bounding box, not every facet point)
        oboxes = [bbox(op) for op in ops]
        xs = [p[0] for p in o] + [v for b in oboxes for v in (b[0], b[2])]
        ys = [p[1] for p in o] + [v for b in oboxes for v in (b[1], b[3])]
        xv = _chain_values(xs, x0, x1)
        yv = _chain_values(ys, y0, y1)
        # bottom: running chain + overall
        yb1, yb2 = oy + dh + 34, oy + dh + 72
        for x in xv:
            parts.append(f'<line x1="{X(x):.2f}" y1="{oy+dh+6:.2f}" x2="{X(x):.2f}" y2="{yb2+6:.2f}" stroke="{light}" stroke-width="0.6"/>')
        if len(xv) > 2:
            for a, b in zip(xv, xv[1:]):
                parts.append(f'<line x1="{X(a):.2f}" y1="{yb1:.2f}" x2="{X(b):.2f}" y2="{yb1:.2f}" stroke="{ink}" stroke-width="0.8" marker-start="url(#tick)" marker-end="url(#tick)"/>')
                if (b - a) * s > 26:
                    parts.append(f'<text x="{(X(a)+X(b))/2:.2f}" y="{yb1-5:.2f}" text-anchor="middle" font-size="10" fill="{ink}">{_fmt(b-a)}</text>')
        parts.append(f'<line x1="{X(x0):.2f}" y1="{yb2:.2f}" x2="{X(x1):.2f}" y2="{yb2:.2f}" stroke="{ink}" stroke-width="1" marker-start="url(#tick)" marker-end="url(#tick)"/>')
        parts.append(f'<text x="{(X(x0)+X(x1))/2:.2f}" y="{yb2-6:.2f}" text-anchor="middle" font-weight="bold" fill="{ink}">{_fmt(pw)}</text>')
        # left: running chain + overall
        xl1, xl2 = ox - 34, ox - 72
        for y in yv:
            parts.append(f'<line x1="{ox-6:.2f}" y1="{Y(y):.2f}" x2="{xl2-6:.2f}" y2="{Y(y):.2f}" stroke="{light}" stroke-width="0.6"/>')
        if len(yv) > 2:
            for a, b in zip(yv, yv[1:]):
                parts.append(f'<line x1="{xl1:.2f}" y1="{Y(a):.2f}" x2="{xl1:.2f}" y2="{Y(b):.2f}" stroke="{ink}" stroke-width="0.8" marker-start="url(#tick)" marker-end="url(#tick)"/>')
                if (b - a) * s > 26:
                    my = (Y(a) + Y(b)) / 2
                    parts.append(f'<text x="{xl1-5:.2f}" y="{my:.2f}" text-anchor="middle" font-size="10" fill="{ink}" transform="rotate(-90 {xl1-5:.2f} {my:.2f})">{_fmt(b-a)}</text>')
        parts.append(f'<line x1="{xl2:.2f}" y1="{Y(y0):.2f}" x2="{xl2:.2f}" y2="{Y(y1):.2f}" stroke="{ink}" stroke-width="1" marker-start="url(#tick)" marker-end="url(#tick)"/>')
        my = (Y(y0) + Y(y1)) / 2
        parts.append(f'<text x="{xl2-6:.2f}" y="{my:.2f}" text-anchor="middle" font-weight="bold" fill="{ink}" transform="rotate(-90 {xl2-6:.2f} {my:.2f})">{_fmt(ph)}</text>')

    if show_lifters:
        for i, lf in enumerate(lifters or [], start=1):
            try:
                lx, ly = float(lf.get("x_mm")), float(lf.get("y_mm"))
            except (TypeError, ValueError):
                continue
            label = escape(str(lf.get("label") or f"L{i}"))
            cx, cy = X(lx), Y(ly)
            if (lf.get("type") or "face") == "edge":
                parts.append(f'<polygon points="{cx:.1f},{cy-9:.1f} {cx+8:.1f},{cy+6:.1f} {cx-8:.1f},{cy+6:.1f}" fill="#F5C518" stroke="{ink}" stroke-width="1.2"/>')
            else:
                parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="7" fill="#F5C518" stroke="{ink}" stroke-width="1.2"/>')
                parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="2" fill="{ink}"/>')
            parts.append(f'<text x="{cx+10:.1f}" y="{cy-8:.1f}" font-size="11" font-weight="bold" fill="{ink}">{label}</text>')

    if show_cog and calc:
        cx, cy = X(calc["cog_x_mm"]), Y(calc["cog_y_mm"])
        r = 9
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="#fff" stroke="#C0392B" stroke-width="1.5"/>')
        parts.append(f'<path d="M {cx:.1f} {cy:.1f} L {cx+r:.1f} {cy:.1f} A {r} {r} 0 0 0 {cx:.1f} {cy-r:.1f} Z" fill="#C0392B"/>')
        parts.append(f'<path d="M {cx:.1f} {cy:.1f} L {cx-r:.1f} {cy:.1f} A {r} {r} 0 0 0 {cx:.1f} {cy+r:.1f} Z" fill="#C0392B"/>')
        parts.append(f'<text x="{cx+13:.1f}" y="{cy+16:.1f}" font-size="10" fill="#C0392B">CoG ({_fmt(calc["cog_x_mm"])}, {_fmt(calc["cog_y_mm"])})</text>')

    if mark:
        parts.append(f'<text x="{width_px-12:.0f}" y="22" text-anchor="end" font-size="16" font-weight="bold" fill="{ink}">{escape(mark)}</text>')
    parts.append("</svg>")
    return "".join(parts)
