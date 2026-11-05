"""Builds the line drawing on the 404 page (worker + house dissolving into binary).

Run: python3 scripts/build_404_art.py   (rewrites the <svg> between the markers in 404.html)
"""
import math, random, re, pathlib

random.seed(404)
INK = "#212121"
GROUND = 320

# ---- House, as line segments (so the same lines can be drawn and dissolved) ----
segs = []
def line(*pts):
    for a, b in zip(pts, pts[1:]):
        segs.append((a, b))
def rect(x1, y1, x2, y2):
    line((x1, y1), (x2, y1), (x2, y2), (x1, y2), (x1, y1))
def circle(cx, cy, r, n=20):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
    line(*pts)

rect(80, 190, 380, GROUND)                                  # walls
line((62, 192), (230, 92), (398, 192), (62, 192))           # roof
def roof_x(y):  # left/right x of roof at height y
    t = (y - 92) / 100
    return 230 - 168 * t, 230 + 168 * t
for y in (117, 142, 167):                                   # shingle rows
    l, r = roof_x(y)
    line((l + 6, y), (r - 6, y))
ry = lambda x: 92 + (x - 230) * 100 / 168
line((300, ry(300) - 0.5), (300, 108), (322, 108), (322, ry(322) - 0.5))   # chimney
rect(296, 100, 326, 108)
circle(230, 150 + 0, 11)                                     # attic window
line((219, 150), (241, 150)); line((230, 139), (230, 161))
for x1 in (110, 290):                                        # windows
    rect(x1, 214, x1 + 50, 264)
    line((x1 + 25, 214), (x1 + 25, 264)); line((x1, 239), (x1 + 50, 239))
    line((x1 - 5, 268), (x1 + 55, 268))                      # sill
rect(205, 244, 245, GROUND)                                  # door
circle(237, 284, 2.5, 10)
# siding, broken around the openings and the new board
holes = [(105, 165, 210, 272), (285, 345, 210, 272), (200, 250, 240, 330), (358, 380, 0, 999)]
for y in range(204, GROUND, 14):
    xs = [80]
    for (a, b, t, btm) in holes:
        if t <= y <= btm:
            xs += [a, b]
    xs.append(380)
    xs = sorted(xs)
    for a, b in zip(xs[0::2], xs[1::2]):
        if b - a > 4:
            line((a, y), (b, y))

# ---- Fade: fully gone at FADE0, fully intact at FADE1 ----
FADE0, FADE1 = 70, 300
def op(x):
    t = min(1, max(0, (x - FADE0) / (FADE1 - FADE0)))
    return t * t * (3 - 2 * t)

def seg_path():
    d = []
    last = None
    for a, b in segs:
        if a != last:
            d.append("M%.1f %.1f" % a)
        d.append("L%.1f %.1f" % b)
        last = b
    return "".join(d)

# ---- Binary digits along the fading lines ----
digits = []
for (x1, y1), (x2, y2) in segs:
    n = max(1, int(math.hypot(x2 - x1, y2 - y1) / 5))
    for i in range(n):
        t = (i + random.random()) / n
        x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        gone = 1 - op(x)
        if gone < 0.12 or random.random() > gone ** 1.2 * 0.95:
            continue
        drift = gone ** 1.6
        dx = -random.uniform(0, 70) * drift + random.gauss(0, 10 * drift)
        dy = random.gauss(0, 14 * drift) - random.uniform(0, 30) * drift
        px, py = x + dx, y + dy
        if px < 4 or py < 40 or py > GROUND + 6:
            continue
        size = 8 - 4 * drift + random.uniform(-0.5, 0.5)
        alpha = max(0.18, 0.95 - 0.7 * drift - random.uniform(0, 0.2))
        digits.append((px, py, size, alpha, random.choice("01")))
# a little loose dust drifting off the far left
for _ in range(70):
    px = random.uniform(8, 120); py = random.uniform(70, 315)
    digits.append((px, py, random.uniform(3.5, 5.5), random.uniform(0.12, 0.35), random.choice("01")))

def text_el(i, d):
    x, y, s, a, c = d
    cls = ' class="tw%d"' % (i % 3 + 1) if i % 5 == 0 else ""
    return '<text x="%.1f" y="%.1f" font-size="%.1f" opacity="%.2f"%s>%s</text>' % (x, y, s, a, cls, c)

# ---- Worker (facing left), drawn on top, not faded ----
def limb(pts, w=11):
    p = " ".join("%d,%d" % q for q in pts)
    return ('<polyline points="%s" stroke="%s" stroke-width="%d"/>'
            '<polyline points="%s" stroke="#fff" stroke-width="%d"/>') % (p, INK, w, p, w - 4)

worker = f'''
<g class="w" stroke-linecap="round" stroke-linejoin="round" fill="none">
  <rect x="362" y="186" width="14" height="134" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <line x1="365" y1="214" x2="373" y2="214" stroke="{INK}" stroke-width="2"/>
  <circle cx="369" cy="300" r="1.6" fill="{INK}"/>
  {limb([(447,196),(424,232),(384,256)])}
  <circle cx="382" cy="256" r="5.5" fill="#fff" stroke="{INK}" stroke-width="2"/>
  {limb([(468,254),(478,288),(482,312)], 14)}
  {limb([(454,254),(442,288),(436,312)], 14)}
  <path d="M470 320 L472 310 L488 310 Q491 315 490 320 Z" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <path d="M424 320 Q424 313 430 310 L444 310 L445 320 Z" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <path d="M440 192 Q452 184 466 191 L474 252 L446 252 Q441 222 440 192 Z" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <path d="M452 186 L452 200 M446 252 L444 260 M474 252 L476 260" stroke="{INK}" stroke-width="2"/>
  <rect x="443" y="243" width="33" height="9" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <path d="M466 252 L466 268 L480 268 L480 252" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <line x1="459" y1="243" x2="459" y2="252" stroke="{INK}" stroke-width="2"/>
  <circle cx="452" cy="170" r="12" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <path d="M440 172 L437 175 L440 176" stroke="{INK}" stroke-width="1.6"/>
  <circle cx="446" cy="168" r="1.2" fill="{INK}"/>
  <path d="M439 163 Q440 147 453 146 Q466 147 466 163 Z" fill="#fff" stroke="{INK}" stroke-width="2"/>
  <path d="M430 164 L469 164 M453 146 L453 163" stroke="{INK}" stroke-width="2"/>
  <g class="swing">
    {limb([(456,198),(432,224),(406,212)])}
    <line x1="414" y1="212" x2="379" y2="214" stroke="{INK}" stroke-width="3"/>
    <rect x="369" y="203" width="11" height="21" rx="1.5" fill="#fff" stroke="{INK}" stroke-width="2"/>
    <circle cx="406" cy="212" r="5.5" fill="#fff" stroke="{INK}" stroke-width="2"/>
  </g>
  <path class="spark" d="M362 200 L354 192 M360 214 L350 214 M362 228 L354 236" stroke="{INK}" stroke-width="1.6"/>
</g>'''

svg = f'''<svg class="e404-art" viewBox="0 0 560 340" role="img" aria-label="A construction worker hammering a board onto a house. The left side of the house dissolves into ones and zeros.">
<defs>
  <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="{FADE0}" y1="0" x2="{FADE1}" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".5" stop-color="#fff" stop-opacity=".5"/>
    <stop offset="1" stop-color="#fff"/>
  </linearGradient>
  <mask id="fadeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="560" height="340"><rect width="560" height="340" fill="url(#fade)"/></mask>
</defs>
<path d="{seg_path()}" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" mask="url(#fadeMask)"/>
<line x1="20" y1="{GROUND}" x2="540" y2="{GROUND}" stroke="{INK}" stroke-width="2" stroke-linecap="round" mask="url(#fadeMask)"/>
<line x1="300" y1="{GROUND}" x2="540" y2="{GROUND}" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>
<g class="bits" fill="{INK}" font-family="ui-monospace,Menlo,Consolas,monospace" text-anchor="middle">
{"".join(text_el(i, d) for i, d in enumerate(digits))}
</g>
{worker}
</svg>'''

page = pathlib.Path(__file__).resolve().parent.parent / "404.html"
html = page.read_text()
html = re.sub(r"<!-- art -->.*?<!-- /art -->", lambda m: "<!-- art -->" + svg + "<!-- /art -->", html, flags=re.S)
page.write_text(html)
print(len(digits), "digits")
