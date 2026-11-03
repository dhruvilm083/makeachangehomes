"""Turn a folder of project photos into web-ready WebP files in assets/.

Usage (from the repo root):
    python3 scripts/add_project_photos.py <photo folder> <project-slug>

Each photo becomes assets/<slug>-NN.webp (max 2000px wide, quality 80) plus a
small assets/<slug>-NN-thumb.webp (800px wide) for the gallery tile. Phone
rotation (EXIF) is applied, and metadata such as GPS location is dropped.
Then add the project to scripts/galleries.json and run scripts/build_galleries.py.
"""
import os, sys
from PIL import Image, ImageOps

MAX_W, THUMB_W, Q = 2000, 800, 80
EXT = ('.jpg', '.jpeg', '.png', '.webp', '.heic')

def save(im, path, width):
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(path, 'WEBP', quality=Q, method=6)

src, slug = sys.argv[1], sys.argv[2]
files = sorted(f for f in os.listdir(src) if f.lower().endswith(EXT))
for n, f in enumerate(files, 1):
    im = ImageOps.exif_transpose(Image.open(os.path.join(src, f))).convert('RGB')
    base = f'assets/{slug}-{n:02d}'
    save(im, base + '.webp', MAX_W)
    save(im, base + '-thumb.webp', THUMB_W)
    print(f, '->', base + '.webp', im.size)
