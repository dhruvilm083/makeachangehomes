"""Make WebP copies of every photo the pages use and point the pages at them.

- Every referenced JPG/PNG gets a .webp twin (max 2000px wide, quality 80).
  The original stays in assets/ untouched.
- Gallery thumbnails (CSS background images on the gallery pages) get a
  smaller -thumb.webp (800px wide), since they show at about 300px.
Run from the repo root: python3 scripts/optimize_images.py
"""
import glob, os, re
from PIL import Image

MAX_W, THUMB_W, Q = 2000, 800, 80
pages = glob.glob('*.html') + glob.glob('*/*.html')
ref = re.compile(r'/assets/([^"\'\s)&]+?\.(?:jpe?g|png))', re.I)
SKIP = {'63225a5675f24afedf28b650_Transparent.png'}

def webp(src, dst, width):
    if os.path.exists(dst):
        return True
    im = Image.open(src)
    has_alpha = im.mode in ('RGBA', 'LA', 'P')
    im = im.convert('RGBA' if has_alpha else 'RGB')
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=Q, method=6)
    if os.path.getsize(dst) >= os.path.getsize(src):
        os.remove(dst)
        return False
    return True

names = set()
for p in pages:
    names |= set(ref.findall(open(p).read()))
done = {}
for n in sorted(names - SKIP):
    src = 'assets/' + n
    if not os.path.exists(src):
        print('missing', src); continue
    out = os.path.splitext(n)[0] + '.webp'
    if webp(src, 'assets/' + out, MAX_W):
        done[n] = out

thumb = re.compile(r'background-image:url\(&quot;/assets/([^&]+?\.(?:jpe?g|png))&quot;\)', re.I)
for p in pages:
    s = open(p).read()
    def bg(m):
        n = m.group(1)
        t = os.path.splitext(n)[0] + '-thumb.webp'
        if webp('assets/' + n, 'assets/' + t, THUMB_W):
            return m.group(0).replace(n, t)
        return m.group(0)
    s = thumb.sub(bg, s)
    s = ref.sub(lambda m: '/assets/' + done.get(m.group(1), m.group(1)), s)
    open(p, 'w').write(s)

before = sum(os.path.getsize('assets/' + n) for n in done)
after = sum(os.path.getsize('assets/' + v) for v in done.values())
print(f'{len(done)} images converted: {before/1e6:.1f} MB -> {after/1e6:.1f} MB')
