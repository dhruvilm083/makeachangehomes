"""Write the project galleries into the Commercial and Residential pages.

The list of projects and their photos lives in scripts/galleries.json. Each
project becomes its own section on the page, with a "jump to project" list at
the top. Edit the JSON (add, rename, reorder projects or photos), then run
from the repo root:

    python3 scripts/build_galleries.py

Only the part of each page between <!-- projects:start --> and
<!-- projects:end --> is replaced.
"""
import html, json, re

PAGES = {'commercial': 'commercial-showcase.html', 'residential': 'home-showcase.html'}
SHOWN = 8  # photos visible before "Show all"

def esc(s):
    return html.escape(s, quote=True)

def section(p):
    n = len(p['photos'])
    items = []
    for i, ph in enumerate(p['photos'], 1):
        alt = f"{p['name']}, photo {i} of {n}"
        items.append(
            f'<a class="pg-item" href="/assets/{esc(ph["full"])}">'
            f'<img src="/assets/{esc(ph["thumb"])}" loading="lazy" decoding="async" alt="{esc(alt)}"/></a>')
    more = ''
    if n > SHOWN:
        more = (f'<button type="button" class="pg-more" aria-expanded="false" '
                f'data-more="Show all {n} photos" data-less="Show fewer photos">Show all {n} photos</button>')
    return (
        f'<section class="pg-project" id="{esc(p["id"])}" data-gallery="{esc(p["name"])}">'
        f'<div class="pg-project-head"><h2>{esc(p["name"])}</h2>'
        f'<p class="pg-meta">{esc(p["type"])} &middot; {n} photo{"s" if n != 1 else ""}</p></div>'
        f'<div class="pg-grid{" is-collapsed" if n > SHOWN else ""}">{"".join(items)}</div>{more}</section>')

def block(projects):
    jump = ''.join(
        f'<li><a href="#{esc(p["id"])}">{esc(p["name"])}</a></li>' for p in projects)
    return (
        '<div class="pg-wrap">'
        f'<nav class="pg-jump" aria-label="Projects on this page"><h2 class="pg-jump-title">Projects</h2><ul>{jump}</ul></nav>'
        + ''.join(section(p) for p in projects)
        + '<div class="gallery-cta"><p>Like what you see? Let&#x27;s talk about your project.</p>'
          '<a href="/contact-us" class="button-primary-2 w-button">Contact us</a></div>'
        '</div>')

data = json.load(open('scripts/galleries.json'))
for key, page in PAGES.items():
    s = open(page).read()
    s, n = re.subn(r'<!-- projects:start -->.*?<!-- projects:end -->',
                   lambda m: '<!-- projects:start -->' + block(data[key]) + '<!-- projects:end -->',
                   s, flags=re.S)
    assert n == 1, page + ' is missing the projects markers'
    open(page, 'w').write(s)
    print(page, len(data[key]), 'projects,', sum(len(p['photos']) for p in data[key]), 'photos')
