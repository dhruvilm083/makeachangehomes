// Worker for makeachangehomes.ca: the hidden photo portal and the live galleries.
//
// Everything else on the site is static files served straight from the assets
// folder; this code only runs for the paths listed in wrangler.jsonc.
//
//   /portal/         login page (one link, two passwords)
//   /portal/upload   uploader: send files, see what was sent
//   /portal/admin    admin: sort uploads into projects, push to the site
//   /api/*           JSON API used by those pages
//   /media/*         uploaded files and their web-sized copies
//   /home-showcase, /commercial-showcase
//                    the gallery pages, with the photo grid filled from the
//                    galleries last pushed from the admin page
//
// Storage is one R2 bucket (binding BUCKET):
//   orig/<id>/<file name>   the file exactly as uploaded
//   web/<id>.<webp|jpg>     large copy for the site and lightbox (made in the browser)
//   thumb/<id>.<webp|jpg>   grid-sized copy
//   state/draft.json        the admin's projects, autosaved
//   state/published.json    what the live gallery pages show, written by Push
//
// Passwords are Worker secrets UPLOAD_PASSWORD and ADMIN_PASSWORD. They never
// reach the browser; logging in sets a signed, HttpOnly cookie.

import seed from '../scripts/galleries.json';

const COOKIE = 'mach_portal';
const SESSION_DAYS = 30;
const ID_RE = /^[a-z0-9]{10,32}$/;
const PART_SIZE_MAX = 95 * 1024 * 1024; // Workers accept up to 100 MB per request
const CATEGORIES = ['commercial', 'residential'];
const GALLERY_PAGES = { 'home-showcase': 'residential', 'commercial-showcase': 'commercial' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) return await api(request, env, url);
      if (path.startsWith('/media/')) return await media(request, env, url, ctx);
      if (path === '/portal' || path.startsWith('/portal/')) return await portal(request, env, url);
      const g = /^\/(home-showcase|commercial-showcase)(?:\.html)?\/?$/.exec(path);
      if (g) return await gallery(request, env, GALLERY_PAGES[g[1]]);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err && err.stack || err);
      if (path.startsWith('/api/')) return json({ error: 'Something went wrong on the server.' }, 500);
      // Never let a portal problem take the public pages down.
      if (!path.startsWith('/portal') && !path.startsWith('/media/')) return env.ASSETS.fetch(request);
      return new Response('Something went wrong.', { status: 500 });
    }
  },
};

// ---- Helpers -----------------------------------------------------------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = (s) => crypto.subtle.digest('SHA-256', enc.encode(s));

function newId() {
  // Time first so ids sort by upload time, then 12 random characters so they can't be guessed.
  const r = crypto.getRandomValues(new Uint8Array(12));
  return Date.now().toString(36) + Array.from(r, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function cleanName(name) {
  const n = String(name || 'file').normalize('NFC').replace(/[\\/\x00-\x1f\x7f]+/g, '_').trim().slice(0, 180);
  return n || 'file';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Sessions ------------------------------------------------------------

async function hmacKey(env) {
  // Derived from both passwords, so changing either one signs everybody out.
  const raw = await sha256('mach-portal|' + (env.UPLOAD_PASSWORD || '') + '|' + (env.ADMIN_PASSWORD || ''));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signSession(env, role, exp) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(role + '.' + exp));
  return role + '.' + exp + '.' + b64url(sig);
}

async function getRole(request, env) {
  if (!env.UPLOAD_PASSWORD || !env.ADMIN_PASSWORD) return null;
  const m = /(?:^|;\s*)mach_portal=([^;]+)/.exec(request.headers.get('Cookie') || '');
  if (!m) return null;
  const [role, exp, sig] = m[1].split('.');
  if (!['upload', 'admin'].includes(role) || !(Number(exp) > Date.now() / 1000) || !sig) return null;
  const good = await signSession(env, role, exp);
  return (await sameSecret(good, m[1])) ? role : null;
}

async function sameSecret(a, b) {
  // Compare hashes in constant time so the comparison leaks nothing.
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ---- Portal pages ---------------------------------------------------------

async function portal(request, env, url) {
  const path = url.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const role = await getRole(request, env);
  const redirect = (to) => new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' } });

  let file = null;
  if (path === '/portal' || path === '/portal/index') {
    if (role === 'admin') return redirect('/portal/admin');
    if (role === 'upload') return redirect('/portal/upload');
    file = '/portal/';
  } else if (path === '/portal/upload') {
    if (!role) return redirect('/portal/');
    file = '/portal/upload';
  } else if (path === '/portal/admin') {
    if (role !== 'admin') return redirect('/portal/');
    file = '/portal/admin';
  }

  const res = file
    ? await env.ASSETS.fetch(new Request(new URL(file, url), { headers: { Accept: 'text/html' } }))
    : await env.ASSETS.fetch(request); // css and js for the portal pages (nothing secret in them)
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('Referrer-Policy', 'no-referrer');
  if (file) {
    out.headers.set('Cache-Control', 'no-store');
    out.headers.delete('ETag');
  } else {
    out.headers.set('Cache-Control', 'no-cache');
  }
  return out;
}

// ---- API --------------------------------------------------------------------

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (!env.BUCKET) return json({ error: 'The photo storage is not connected yet.' }, 503);

  // Only accept changes sent from our own pages.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Not allowed.' }, 403);
  }

  if (path === '/api/login' && method === 'POST') return login(request, env);
  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const role = await getRole(request, env);
  if (!role) return json({ error: 'Please log in again.' }, 401);
  if (path === '/api/me') return json({ role });

  // Uploader and admin
  if (path === '/api/uploads' && method === 'GET') return json({ uploads: await listUploads(env) });
  if (path === '/api/upload' && method === 'POST') return uploadSimple(request, env, url, role);
  if (path === '/api/upload/multipart' && method === 'POST') return multipartStart(env, url, role);
  if (path === '/api/upload/part' && method === 'PUT') return multipartPart(request, env, url);
  if (path === '/api/upload/complete' && method === 'POST') return multipartComplete(request, env);
  if (path === '/api/upload/abort' && method === 'POST') return multipartAbort(request, env);
  const pv = /^\/api\/preview\/([a-z0-9]+)$/.exec(path);
  if (pv && method === 'PUT') return putPreview(request, env, url, pv[1]);

  // Admin only
  if (role !== 'admin') return json({ error: 'Only the admin can do that.' }, 403);
  if (path === '/api/state' && method === 'GET') return getState(env);
  if (path === '/api/state' && method === 'PUT') return putState(request, env);
  if (path === '/api/publish' && method === 'POST') return publish(env);

  return json({ error: 'Not found.' }, 404);
}

async function login(request, env) {
  if (!env.UPLOAD_PASSWORD || !env.ADMIN_PASSWORD) {
    return json({ error: 'The portal passwords have not been set up yet.' }, 503);
  }
  let password = '';
  try { password = String((await request.json()).password || ''); } catch (e) {}
  let role = null;
  if (await sameSecret(password, env.ADMIN_PASSWORD)) role = 'admin';
  else if (await sameSecret(password, env.UPLOAD_PASSWORD)) role = 'upload';
  if (!role) {
    await new Promise((r) => setTimeout(r, 700)); // slow down guessing
    return json({ error: 'That password is not right.' }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const value = await signSession(env, role, exp);
  return json({ role, next: role === 'admin' ? '/portal/admin' : '/portal/upload' }, 200,
    { 'Set-Cookie': sessionCookie(value, SESSION_DAYS * 86400) });
}

// ---- Uploads ----------------------------------------------------------------

function uploadMeta(url, role) {
  const name = cleanName(url.searchParams.get('name'));
  const type = (url.searchParams.get('type') || '').slice(0, 100) || 'application/octet-stream';
  const batch = (url.searchParams.get('batch') || '').replace(/[^0-9]/g, '').slice(0, 16) || String(Date.now());
  const id = newId();
  return {
    id,
    key: `orig/${id}/${name}`,
    options: {
      httpMetadata: { contentType: type },
      customMetadata: { name: encodeURIComponent(name), uploaded: new Date().toISOString(), batch, by: role },
    },
  };
}

async function uploadSimple(request, env, url, role) {
  const len = Number(request.headers.get('Content-Length'));
  if (!request.body || !(len >= 0)) return json({ error: 'No file was sent.' }, 400);
  const m = uploadMeta(url, role);
  await env.BUCKET.put(m.key, request.body, m.options);
  return json({ id: m.id });
}

async function multipartStart(env, url, role) {
  const m = uploadMeta(url, role);
  const mpu = await env.BUCKET.createMultipartUpload(m.key, m.options);
  return json({ id: m.id, key: m.key, uploadId: mpu.uploadId });
}

function mpuKey(key) {
  return typeof key === 'string' && /^orig\/[a-z0-9]{10,32}\/[^/]+$/.test(key);
}

async function multipartPart(request, env, url) {
  const key = url.searchParams.get('key');
  const uploadId = url.searchParams.get('uploadId');
  const n = Number(url.searchParams.get('part'));
  const len = Number(request.headers.get('Content-Length'));
  if (!mpuKey(key) || !uploadId || !(n >= 1 && n <= 10000) || !request.body) return json({ error: 'Bad part.' }, 400);
  if (len > PART_SIZE_MAX) return json({ error: 'Part too large.' }, 413);
  const part = await env.BUCKET.resumeMultipartUpload(key, uploadId).uploadPart(n, request.body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function multipartComplete(request, env) {
  const { key, uploadId, parts } = await request.json();
  if (!mpuKey(key) || !uploadId || !Array.isArray(parts)) return json({ error: 'Bad upload.' }, 400);
  await env.BUCKET.resumeMultipartUpload(key, uploadId).complete(parts);
  return json({ ok: true });
}

async function multipartAbort(request, env) {
  const { key, uploadId } = await request.json();
  if (!mpuKey(key) || !uploadId) return json({ error: 'Bad upload.' }, 400);
  try { await env.BUCKET.resumeMultipartUpload(key, uploadId).abort(); } catch (e) {}
  return json({ ok: true });
}

async function putPreview(request, env, url, id) {
  if (!ID_RE.test(id)) return json({ error: 'Bad id.' }, 400);
  const kind = url.searchParams.get('kind');
  const ext = url.searchParams.get('ext');
  if (!['web', 'thumb'].includes(kind) || !['webp', 'jpg'].includes(ext)) return json({ error: 'Bad preview.' }, 400);
  const len = Number(request.headers.get('Content-Length'));
  if (!request.body || !(len > 0) || len > 20 * 1024 * 1024) return json({ error: 'Preview too large.' }, 413);
  const orig = await env.BUCKET.list({ prefix: `orig/${id}/`, limit: 1 });
  if (!orig.objects.length) return json({ error: 'No such upload.' }, 404);
  // Only one copy of each kind per photo.
  const other = ext === 'webp' ? 'jpg' : 'webp';
  await env.BUCKET.delete(`${kind}/${id}.${other}`);
  await env.BUCKET.put(`${kind}/${id}.${ext}`, request.body, {
    httpMetadata: { contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg' },
  });
  return json({ ok: true, url: `/media/${kind}/${id}.${ext}` });
}

async function listAll(env, prefix, include) {
  const out = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, include });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function previewMap(env) {
  const [web, thumb] = await Promise.all([listAll(env, 'web/'), listAll(env, 'thumb/')]);
  const map = (objs) => Object.fromEntries(objs.map((o) => [o.key.split('/')[1].split('.')[0], '/media/' + o.key]));
  return { web: map(web), thumb: map(thumb) };
}

async function listUploads(env) {
  const [orig, pv] = await Promise.all([listAll(env, 'orig/', ['customMetadata', 'httpMetadata']), previewMap(env)]);
  return orig.map((o) => {
    const [, id, file] = o.key.split('/');
    const cm = o.customMetadata || {};
    let name = file;
    try { name = decodeURIComponent(cm.name || file); } catch (e) {}
    return {
      id,
      name,
      size: o.size,
      type: (o.httpMetadata && o.httpMetadata.contentType) || '',
      uploaded: cm.uploaded || o.uploaded.toISOString(),
      batch: cm.batch || '',
      orig: '/media/' + o.key.split('/').map(encodeURIComponent).join('/'),
      web: pv.web[id] || null,
      thumb: pv.thumb[id] || null,
    };
  });
}

// ---- Media ---------------------------------------------------------------------

async function media(request, env, url, ctx) {
  if (!env.BUCKET) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  let key;
  try { key = decodeURIComponent(url.pathname.slice('/media/'.length)); } catch (e) { return new Response('Not found', { status: 404 }); }
  const isPublic = /^(web|thumb)\/[a-z0-9]{10,32}\.(webp|jpg)$/.test(key);
  const isOrig = /^orig\/[a-z0-9]{10,32}\/[^/]+$/.test(key);
  if (!isPublic && !isOrig) return new Response('Not found', { status: 404 });

  // Originals are only for people logged in to the portal. The web-sized
  // copies are public (the live galleries use them); their ids can't be guessed.
  if (isOrig && !(await getRole(request, env))) return new Response('Not found', { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
  if (isPublic) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  if (isPublic) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    const name = key.split('/').pop();
    const ascii = name.replace(/[^\x20-\x7e]|"/g, '_');
    const how = url.searchParams.has('download') ? 'attachment' : 'inline';
    headers.set('Content-Disposition', `${how}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  }
  headers.set('Content-Length', String(obj.size));
  const res = new Response(request.method === 'HEAD' ? null : obj.body, { headers });
  if (isPublic && request.method === 'GET') ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ---- Admin state ------------------------------------------------------------------

function seedState() {
  const projects = [];
  for (const category of CATEGORIES) {
    for (const p of seed[category].projects) {
      projects.push({
        id: p.id,
        name: p.name,
        type: p.type || '',
        category,
        photos: p.photos.map((ph) => 'a:' + ph.full),
      });
    }
  }
  return { rev: 0, savedAt: null, projects, trash: [] };
}

async function readJson(env, key) {
  const obj = await env.BUCKET.get(key);
  if (!obj) return { data: null, etag: null };
  return { data: await obj.json(), etag: obj.etag };
}

async function getState(env) {
  const [draft, pub] = await Promise.all([readJson(env, 'state/draft.json'), readJson(env, 'state/published.json')]);
  return json({
    draft: draft.data || seedState(),
    published: pub.data ? { rev: pub.data.rev, at: pub.data.at, photos: pub.data.photos } : null,
  });
}

function validState(s) {
  if (!s || !Array.isArray(s.projects) || !Array.isArray(s.trash)) return false;
  const ids = new Set();
  for (const p of s.projects) {
    if (!p || typeof p.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(p.id) || ids.has(p.id)) return false;
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120) return false;
    if (!CATEGORIES.includes(p.category) || !Array.isArray(p.photos)) return false;
    if (!p.photos.every((x) => typeof x === 'string' && x.length < 300)) return false;
    ids.add(p.id);
  }
  return s.trash.every((t) => t && typeof t.photo === 'string' && t.photo.length < 300);
}

async function putState(request, env) {
  const body = await request.json();
  if (!validState(body)) return json({ error: 'That change could not be saved (bad data).' }, 400);
  const cur = await readJson(env, 'state/draft.json');
  const curRev = cur.data ? cur.data.rev : 0;
  if (body.baseRev !== curRev) return json({ error: 'conflict', draft: cur.data || seedState() }, 409);
  const next = {
    rev: curRev + 1,
    savedAt: new Date().toISOString(),
    projects: body.projects.map((p) => ({ id: p.id, name: p.name.trim(), type: String(p.type || '').slice(0, 80), category: p.category, photos: p.photos })),
    trash: body.trash.map((t) => ({ photo: t.photo, from: typeof t.from === 'string' ? t.from : null })),
  };
  // Write only if nobody else saved in between.
  const put = await env.BUCKET.put('state/draft.json', JSON.stringify(next), {
    httpMetadata: { contentType: 'application/json' },
    ...(cur.etag ? { onlyIf: { etagMatches: cur.etag } } : {}),
  });
  if (!put) {
    const again = await readJson(env, 'state/draft.json');
    return json({ error: 'conflict', draft: again.data || seedState() }, 409);
  }
  return json({ rev: next.rev, savedAt: next.savedAt });
}

function assetThumb(file) {
  return /\.webp$/.test(file) ? file.replace(/\.webp$/, '-thumb.webp') : file;
}

async function publish(env) {
  const [{ data: draftData }, pv] = await Promise.all([readJson(env, 'state/draft.json'), previewMap(env)]);
  const draft = draftData || seedState();
  const out = { rev: draft.rev, at: new Date().toISOString(), photos: 0, skipped: 0, commercial: [], residential: [] };
  for (const p of draft.projects) {
    const photos = [];
    for (const ph of p.photos) {
      if (ph.startsWith('a:')) {
        const f = ph.slice(2);
        if (!/^[\w.-]+$/.test(f)) { out.skipped++; continue; }
        photos.push({ full: '/assets/' + f, thumb: '/assets/' + assetThumb(f) });
      } else if (ph.startsWith('u:')) {
        const id = ph.slice(2);
        const web = pv.web[id], thumb = pv.thumb[id];
        if (!web && !thumb) { out.skipped++; continue; } // not a photo the browser can show (e.g. a video)
        photos.push({ full: web || thumb, thumb: thumb || web });
      }
    }
    if (!photos.length) continue;
    out[p.category].push({ id: p.id, name: p.name, photos });
    out.photos += photos.length;
  }
  await env.BUCKET.put('state/published.json', JSON.stringify(out), { httpMetadata: { contentType: 'application/json' } });
  publishedCache = { at: 0, data: null };
  return json({ rev: out.rev, at: out.at, photos: out.photos, skipped: out.skipped });
}

// ---- Live gallery pages --------------------------------------------------------------

let publishedCache = { at: 0, data: null };

async function getPublished(env) {
  if (!env.BUCKET) return null;
  // Each Worker instance re-reads at most every 10 seconds.
  if (Date.now() - publishedCache.at < 10000) return publishedCache.data;
  const { data } = await readJson(env, 'state/published.json');
  publishedCache = { at: Date.now(), data };
  return data;
}

// Same markup as scripts/build_galleries.py.
function renderGrid(projects) {
  const parts = [];
  let k = 0;
  projects.forEach((p, i) => {
    parts.push(`<div class="pg-sep${i === 0 ? ' pg-sep-first' : ''}" id="${escapeHtml(p.id)}" role="presentation"></div>`);
    const n = p.photos.length;
    p.photos.forEach((ph, j) => {
      k++;
      const load = k <= 4 ? 'loading="eager" fetchpriority="high"' : k <= 12 ? 'loading="eager"' : 'loading="lazy"';
      const alt = `${p.name}, photo ${j + 1} of ${n}`;
      parts.push(`<a class="pg-item" href="${escapeHtml(ph.full)}"><img src="${escapeHtml(ph.thumb)}" ${load} decoding="async" alt="${escapeHtml(alt)}"/></a>`);
    });
  });
  return parts.join('');
}

async function gallery(request, env, category) {
  // Ask for the page without the browser's cache validators: the page we send
  // back is not the plain file, so the file's ETag must not be reused.
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');
  const res = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers }));
  if (res.status !== 200 || !(res.headers.get('Content-Type') || '').includes('text/html')) return res;

  let published = null;
  try { published = await getPublished(env); } catch (e) { console.error(e); }
  if (!published || !Array.isArray(published[category]) || !published[category].length) return res;

  const grid = renderGrid(published[category]);
  const out = new HTMLRewriter()
    .on('.pg-grid', { element(el) { el.setInnerContent(grid, { html: true }); } })
    .transform(res);
  const final = new Response(out.body, out);
  final.headers.delete('ETag');
  final.headers.delete('Content-Length');
  final.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  return final;
}
