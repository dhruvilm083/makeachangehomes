"""Write the photo galleries into the Commercial and Residential pages.

Everything lives in scripts/galleries.json: each page has a title, a short
intro, and its projects in order. The page shows one grid of every photo,
with a thin line between projects. Edit the JSON (add, rename, reorder
projects or photos), then run from the repo root:

    python3 scripts/build_galleries.py

Only the part of each page between <!-- projects:start --> and
<!-- projects:end --> is replaced.
"""
import html, json, re

PAGES = {'commercial': 'commercial-showcase.html', 'residential': 'home-showcase.html'}

def esc(s):
    return html.escape(s, quote=True)

def block(page):
    parts = []
    for i, p in enumerate(page['projects']):
        # A line between projects. Its id keeps old links like #kidzpen working.
        parts.append(f'<div class="pg-sep{" pg-sep-first" if i == 0 else ""}" id="{esc(p["id"])}" role="presentation"></div>')
        n = len(p['photos'])
        for j, ph in enumerate(p['photos'], 1):
            alt = f"{p['name']}, photo {j} of {n}"
            parts.append(
                f'<a class="pg-item" href="/assets/{esc(ph["full"])}">'
                f'<img src="/assets/{esc(ph["thumb"])}" loading="lazy" decoding="async" alt="{esc(alt)}"/></a>')
    return (
        '<div class="pg-wrap">'
        f'<header class="pg-head"><h1>{esc(page["title"])}</h1><p>{esc(page["intro"])}</p></header>'
        f'<div class="pg-grid">{"".join(parts)}</div>'
        '</div>')

data = json.load(open('scripts/galleries.json'))
for key, file in PAGES.items():
    s = open(file).read()
    s, n = re.subn(r'<!-- projects:start -->.*?<!-- projects:end -->',
                   lambda m: '<!-- projects:start -->' + block(data[key]) + '<!-- projects:end -->',
                   s, flags=re.S)
    assert n == 1, file + ' is missing the projects markers'
    open(file, 'w').write(s)
    ps = data[key]['projects']
    print(file, len(ps), 'projects,', sum(len(p['photos']) for p in ps), 'photos')
