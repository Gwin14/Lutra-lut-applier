"""
Lutra icon: one source for every icon asset.

Full-bleed violet square, a frosted disc (the "lens") and a bold white S tone
curve with one control node: the grading gesture. Shapes are built as plain
filled paths (strokes outlined, no clip-path/mask) so the same geometry feeds
both the app assets and the Icon Composer layers.

Deps (any venv): pip install skia-pathops resvg-py
Run:  python scripts/make-icons.py
Out:  assets/icon.png, android-icon-*.png, splash-icon.png, favicon.png
      assets/icon-composer/{svg,png}/NN-layer.* + preview.png
"""
import io
import os
import shutil

import pathops
import resvg_py

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "assets")
LAYERS = os.path.join(ASSETS, "icon-composer")
C = 512.0
K = 0.5522847498

DISC_R = 360
CURVE_R = 280      # curve spans x in [-0.9, 0.9] * CURVE_R, kept inside the disc
CURVE_W = 64
NODE_R = 62
DOT_R = 26
SQUIRCLE = 0.2237  # iOS corner radius ratio, for previews / splash / favicon


def circle(r, cx=C, cy=C):
    p = pathops.Path()
    k = r * K
    p.moveTo(cx + r, cy)
    p.cubicTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    p.cubicTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    p.cubicTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    p.cubicTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    p.close()
    return p


def tone_curve():
    R, a = CURVE_R, 0.5
    P = lambda x, y: (C + x * R, C + y * R)
    p = pathops.Path()
    p.moveTo(*P(-0.9, a))
    p.cubicTo(*P(0.1, a * 1.7), *P(-0.1, -a * 1.7), *P(0.9, -a))
    p.stroke(CURVE_W, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    p.convertConicsToQuads()
    return pathops.simplify(p)


def ring(r_out, r_in):
    return pathops.op(circle(r_out), circle(r_in), pathops.PathOp.DIFFERENCE)


def d(path):
    verbs = {"moveTo": "M", "lineTo": "L", "qCurveTo": "Q", "curveTo": "C", "closePath": "Z", "endPath": ""}
    fmt = lambda pts: "".join(f" {x:.2f},{y:.2f}" for x, y in pts)
    out = []
    for verb, pts in path.segments:
        if verb == "qCurveTo" and len(pts) > 2:
            # Pen-style quad runs carry implied on-curve midpoints; SVG Q needs them explicit.
            offs, end = pts[:-1], pts[-1]
            for i, a in enumerate(offs):
                b = offs[i + 1] if i + 1 < len(offs) else None
                on = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) if b else end
                out.append("Q" + fmt([a, on]))
            continue
        out.append(verbs[verb] + fmt(pts))
    return " ".join(o for o in out if o)


# --- layers (bottom -> top). Each: name, defs, body (gradient id is "g") ---
BG_GRAD = ('<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="512" y1="0" x2="512" y2="1024">'
           '<stop offset="0" stop-color="#A08BFF"/><stop offset="1" stop-color="#4A2CD6"/></linearGradient>')
DOT_GRAD = (f'<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="512" y1="{C - DOT_R}" x2="512" y2="{C + DOT_R}">'
            '<stop offset="0" stop-color="#8E78FF"/><stop offset="1" stop-color="#5A3FE0"/></linearGradient>')

LAYER_DEFS = [
    ("00-background", BG_GRAD, '<rect width="1024" height="1024" fill="url(#g)"/>'),
    ("01-disc", "", f'<path d="{d(circle(DISC_R))}" fill="#FFFFFF" fill-opacity="0.16"/>'),
    ("02-disc-rim", "", f'<path d="{d(ring(DISC_R + 3, DISC_R - 3))}" fill="#FFFFFF" fill-opacity="0.35" fill-rule="evenodd"/>'),
    ("03-curve", "", f'<path d="{d(tone_curve())}" fill="#FFFFFF"/>'),
    ("04-node", "", f'<path d="{d(circle(NODE_R))}" fill="#FFFFFF"/>'),
    ("05-node-dot", DOT_GRAD, f'<path d="{d(circle(DOT_R))}" fill="url(#g)"/>'),
]


def svg(defs, body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
            + (f"<defs>{defs}</defs>" if defs else "") + body + "</svg>\n")


def stack(layers, scale=1.0):
    """Merge layers into one SVG, giving each gradient a unique id."""
    defs, body = [], []
    for i, (_, ldefs, lbody) in enumerate(layers):
        defs.append(ldefs.replace('id="g"', f'id="g{i}"'))
        body.append(lbody.replace("url(#g)", f"url(#g{i})"))
    inner = "".join(body)
    if scale != 1.0:
        t = C * (1 - scale)
        inner = f'<g transform="translate({t:.2f},{t:.2f}) scale({scale})">{inner}</g>'
    return svg("".join(defs), inner)


def masked(markup, radius=SQUIRCLE * 1024):
    # Rounded-square mask; only used for assets that iOS/Android don't mask themselves.
    return markup.replace("<defs>", f'<defs><clipPath id="sq"><rect width="1024" height="1024" rx="{radius:.1f}"/></clipPath>', 1) \
                 .replace("</defs>", "</defs><g clip-path=\"url(#sq)\">", 1).replace("</svg>", "</g></svg>")


def render(markup, path, size=1024):
    png = bytes(resvg_py.svg_to_bytes(svg_string=markup, width=size, height=size))
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", os.path.relpath(path, ROOT))


bg, disc, rim, curve, node, dot = LAYER_DEFS
glyph = [disc, rim, curve, node, dot]

# App assets
render(stack(LAYER_DEFS), os.path.join(ASSETS, "icon.png"))
render(stack([bg]), os.path.join(ASSETS, "android-icon-background.png"))
render(stack(glyph, scale=0.72), os.path.join(ASSETS, "android-icon-foreground.png"))
mono = pathops.op(pathops.op(tone_curve(), circle(NODE_R), pathops.PathOp.UNION),
                  circle(DOT_R), pathops.PathOp.DIFFERENCE)
render(stack([("m", "", f'<path d="{d(mono)}" fill="#FFFFFF"/>')], scale=0.72),
       os.path.join(ASSETS, "android-icon-monochrome.png"))
render(masked(stack(LAYER_DEFS)), os.path.join(ASSETS, "splash-icon.png"))
render(masked(stack(LAYER_DEFS)), os.path.join(ASSETS, "favicon.png"), size=48)

# Icon Composer layers
shutil.rmtree(LAYERS, ignore_errors=True)
os.makedirs(os.path.join(LAYERS, "svg"))
os.makedirs(os.path.join(LAYERS, "png"))
for name, ldefs, lbody in LAYER_DEFS:
    s = svg(ldefs, lbody)
    with open(os.path.join(LAYERS, "svg", f"{name}.svg"), "w") as f:
        f.write(s)
    render(s, os.path.join(LAYERS, "png", f"{name}.png"))
render(masked(stack(LAYER_DEFS)), os.path.join(LAYERS, "preview.png"))
