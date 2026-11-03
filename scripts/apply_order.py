"""Apply a photo order copied from the ?edit tool to scripts/galleries.json.

Usage (from the repo root), with each page's copied text saved to a file:
    python3 scripts/apply_order.py order-commercial.json [order-residential.json]
then run python3 scripts/build_galleries.py.

Photos belong to the project line they sit after; removed photos are dropped.
"""
import json, sys

PAGES = {'/commercial-showcase': 'commercial', '/home-showcase': 'residential'}
data = json.load(open('scripts/galleries.json'))
for path in sys.argv[1:]:
    edit = json.load(open(path))
    page = data[PAGES[edit['page'].rstrip('/').replace('.html', '')]]
    projects = {p['id']: p for p in page['projects']}
    photos = {ph['full']: ph for p in page['projects'] for ph in p['photos']}
    out, current = [], None
    for name in edit['order']:
        if name.startswith('#'):
            current = dict(projects[name[1:]], photos=[])
            out.append(current)
        elif name in photos:
            if current is None:
                current = dict(page['projects'][0], photos=[])
                out.append(current)
            current['photos'].append(photos.pop(name))
    page['projects'] = [p for p in out if p['photos']]
    print(path, len(page['projects']), 'projects,', sum(len(p['photos']) for p in page['projects']), 'photos,',
          len(edit.get('removed', [])), 'removed')
json.dump(data, open('scripts/galleries.json', 'w'), indent=1, ensure_ascii=False)
