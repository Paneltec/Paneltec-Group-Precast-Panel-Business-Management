"""Unit tests for panel_geometry (no database or server needed).

Run:  cd backend && python -m pytest tests/test_panel_geometry.py -q
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import panel_geometry as g  # noqa: E402


def test_plain_rectangle_matches_quote_calculator():
    # 6 m x 3 m x 150 mm — the PRD acceptance panel. 2.7 m3, 2500 kg/m3 + 45 kg/m3 steel
    c = g.calculate(g.rectangle(0, 0, 6000, 3000), [], 150, 2500, 45)
    assert c["gross_area_m2"] == 18.0
    assert c["net_area_m2"] == 18.0
    assert c["volume_m3"] == 2.7
    assert c["concrete_weight_kg"] == 6750.0
    assert c["steel_weight_kg"] == 121.5
    assert c["total_weight_kg"] == 6871.5
    assert (c["cog_x_mm"], c["cog_y_mm"]) == (3000.0, 1500.0)
    assert (c["width_mm"], c["height_mm"]) == (6000.0, 3000.0)


def test_opening_shifts_centre_of_gravity_away_from_hole():
    # 6000 x 3000 with a 1000 x 1000 window in the left half
    c = g.calculate(g.rectangle(0, 0, 6000, 3000), [g.rectangle(1000, 1000, 1000, 1000)], 200, 2400)
    assert c["openings_area_m2"] == 1.0
    assert c["net_area_m2"] == 17.0
    # moment: 18*3000 - 1*1500 = 52500 -> /17
    assert c["cog_x_mm"] == pytest.approx(52500 / 17, abs=0.1)
    assert c["cog_y_mm"] == pytest.approx(1500.0, abs=0.1)
    assert c["volume_m3"] == pytest.approx(17 * 0.2, abs=1e-4)


def test_l_shaped_panel_any_winding():
    l_shape = [(0, 0), (4000, 0), (4000, 1000), (1000, 1000), (1000, 3000), (0, 3000)]
    a = g.calculate(l_shape, [], 150)
    b = g.calculate(list(reversed(l_shape)), [], 150)
    assert a["gross_area_m2"] == 6.0 == b["gross_area_m2"]
    # composite of 4000x1000 (cx 2000, cy 500) + 1000x2000 (cx 500, cy 2000)
    assert a["cog_x_mm"] == pytest.approx((4 * 2000 + 2 * 500) / 6, abs=0.1)
    assert a["cog_y_mm"] == pytest.approx((4 * 500 + 2 * 2000) / 6, abs=0.1)
    assert a["cog_x_mm"] == b["cog_x_mm"]


@pytest.mark.parametrize("openings,msg", [
    ([g.rectangle(5500, 100, 1000, 1000)], "outside"),
    ([g.rectangle(100, 100, 1000, 1000), g.rectangle(600, 600, 1000, 1000)], "overlap"),
])
def test_bad_openings_rejected(openings, msg):
    with pytest.raises(ValueError, match=msg):
        g.calculate(g.rectangle(0, 0, 6000, 3000), openings, 150)


def test_opening_crossing_concave_edge_rejected():
    l_shape = [(0, 0), (4000, 0), (4000, 1000), (1000, 1000), (1000, 3000), (0, 3000)]
    # every corner is inside the L, but one side cuts across the missing notch
    with pytest.raises(ValueError, match="crosses the panel edge"):
        g.calculate(l_shape, [[(500, 500), (3000, 500), (3000, 900), (900, 2500), (500, 2500)]], 150)


def test_zero_thickness_rejected():
    with pytest.raises(ValueError, match="Thickness"):
        g.calculate(g.rectangle(0, 0, 1000, 1000), [], 0)


def _dxf_bytes(build, units=4):
    import io
    import ezdxf
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = units
    build(doc.modelspace())
    buf = io.StringIO(); doc.write(buf)
    return buf.getvalue().encode()


def test_dxf_two_panels_with_opening_and_marks():
    def build(msp):
        msp.add_lwpolyline(g.rectangle(10000, 5000, 6000, 3000), close=True)
        msp.add_lwpolyline(g.rectangle(11000, 6000, 1200, 900), close=True)   # window in P1
        msp.add_text("P01", height=100).set_placement((13000, 7500))
        # second panel drawn with loose LINEs that join up
        pts = g.rectangle(20000, 5000, 4000, 3000)
        for a, b in zip(pts, pts[1:] + pts[:1]):
            msp.add_line(a, b)
        msp.add_text("P02", height=100).set_placement((22000, 6500))
    res = g.parse_dxf(_dxf_bytes(build))
    assert res["units"] == "mm"
    marks = {p["mark"]: p for p in res["panels"]}
    assert set(marks) == {"P01", "P02"}
    p1 = marks["P01"]
    assert (p1["width_mm"], p1["height_mm"]) == (6000.0, 3000.0)
    assert len(p1["openings"]) == 1
    assert min(x for x, _ in p1["outline"]) == 0 and min(y for _, y in p1["outline"]) == 0
    assert p1["valid"] and marks["P02"]["valid"]
    assert marks["P02"]["openings"] == []


def test_dxf_in_metres_is_scaled():
    res = g.parse_dxf(_dxf_bytes(lambda m: m.add_lwpolyline(g.rectangle(0, 0, 2.4, 3.2), close=True), units=6))
    p = res["panels"][0]
    assert (p["width_mm"], p["height_mm"]) == (2400.0, 3200.0)
    assert p["mark"] == "P01"   # no text -> auto mark


def test_dxf_round_penetration_from_circle():
    def build(msp):
        msp.add_lwpolyline(g.rectangle(0, 0, 3000, 3000), close=True)
        msp.add_circle((1500, 1500), 150)
    p = g.parse_dxf(_dxf_bytes(build))["panels"][0]
    assert len(p["openings"]) == 1
    c = g.calculate(p["outline"], p["openings"], 150)
    assert c["openings_area_m2"] == pytest.approx(3.14159 * 0.15 ** 2, rel=0.01)


def test_garbage_file_gives_friendly_error():
    with pytest.raises(ValueError, match="DXF"):
        g.parse_dxf(b"this is not a dxf at all")


def test_export_then_reimport_round_trip():
    panel = {"mark": "W-12", "outline": g.rectangle(0, 0, 5000, 2800),
             "openings": [g.rectangle(500, 500, 900, 900)], "lifting": {"lifters": []}}
    res = g.parse_dxf(g.export_dxf([panel]))
    assert res["panels"][0]["mark"] == "W-12"
    assert len(res["panels"][0]["openings"]) == 1


def test_svg_contains_dimensions_cog_and_lifters():
    calc = g.calculate(g.rectangle(0, 0, 6000, 3000), [g.rectangle(1000, 1000, 1000, 1000)], 150)
    svg = g.render_svg(g.rectangle(0, 0, 6000, 3000), [g.rectangle(1000, 1000, 1000, 1000)], calc,
                       [{"label": "L1", "type": "edge", "x_mm": 1500, "y_mm": 3000},
                        {"label": "<L2>", "type": "face", "x_mm": 4500, "y_mm": 2000}], mark="P01")
    assert svg.startswith("<svg") and svg.endswith("</svg>")
    assert ">6000<" in svg and ">3000<" in svg
    assert "CoG" in svg and "L1" in svg
    assert "&lt;L2&gt;" in svg   # labels are escaped
