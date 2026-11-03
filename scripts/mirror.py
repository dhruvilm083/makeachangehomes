"""Mirror a Webflow site (webflow.io) into a static folder with local assets."""
import os, re, sys, urllib.parse, urllib.request, hashlib, collections

BASE = "https://make-a-change-homes.webflow.io"
OUT = sys.argv[1]
CDN_HOSTS = r"(?:cdn\.prod\.website-files\.com|assets\.website-files\.com|assets-global\.website-files\.com|uploads-ssl\.webflow\.com|d3e54v103j8qbb\.cloudfront\.net)"
URL_RE = re.compile(r"https:(?:\\?/){2}" + CDN_HOSTS + r"(?:\\?/[^\s\"'<>,&\\]*)+")
HREF_RE = re.compile(r'href="(/[^"#?]*)')

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (site-migration)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

asset_map = {}   # remote url -> local name under /assets/
used = set()

def local_name(url):
    if url in asset_map:
        return asset_map[url]
    path = urllib.parse.urlparse(url).path
    base = urllib.parse.unquote(os.path.basename(path)) or "file"
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", base)
    name = base
    if name in used:
        name = hashlib.sha1(url.encode()).hexdigest()[:8] + "_" + base
    used.add(name)
    asset_map[url] = name
    return name

def fix(m, prefix=""):
    u = m.group(0)
    tail = ""
    while u.endswith(")") and u.count("(") < u.count(")"):
        u, tail = u[:-1], ")" + tail
    return prefix + grab_asset(u.replace("\\/", "/")) + tail

def grab_asset(url):
    name = local_name(url)
    dest = os.path.join(OUT, "assets", name)
    if os.path.exists(dest):
        return name
    try:
        data = fetch(url)
    except Exception as e:
        print("FAIL", url, e)
        return name
    if name.endswith(".css"):
        text = data.decode("utf-8")
        text = URL_RE.sub(fix, text)
        data = text.encode()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return name

def page_file(path):
    if path in ("", "/"):
        return "index.html"
    return path.strip("/") + ".html"

seen, queue = set(), collections.deque(["/", "/404"])
pages = []
while queue:
    p = queue.popleft()
    if p in seen:
        continue
    seen.add(p)
    try:
        html = fetch(BASE + p).decode("utf-8")
    except Exception as e:
        print("PAGE FAIL", p, e)
        continue
    for link in HREF_RE.findall(html):
        if link not in seen and not re.search(r"\.\w{2,4}$", link):
            queue.append(link.rstrip("/") or "/")
    html = URL_RE.sub(lambda m: fix(m, "/assets/"), html)
    out = os.path.join(OUT, page_file(p))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write(html)
    pages.append(p)
    print("page", p, "->", page_file(p))

print("pages", len(pages), "assets", len(asset_map))
