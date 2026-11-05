// Shared by the uploader and admin pages: sending files, and making the
// web-sized copies (a large one and a grid thumbnail) in the browser.
//
// Originals are always stored untouched. The copies are WebP (JPEG where the
// browser can't write WebP). HEIC is decoded natively where the browser can,
// otherwise with heic2any. DNG and other camera raw files carry a full-size
// JPEG preview inside them, which is what gets used.
(function () {
  'use strict';

  var WEB_MAX = 2000, THUMB_MAX = 800;
  var PART = 50 * 1024 * 1024;          // multipart chunk size
  var SINGLE_MAX = 90 * 1024 * 1024;    // bigger files go up in parts
  var RAW = /\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|srw|3fr|iiq|tif|tiff)$/i;
  var HEIC = /\.(heic|heif|hif)$/i;
  var IMG = /\.(jpe?g|jfif|png|webp|gif|avif|bmp)$/i;

  function canPreview(name, type) {
    return RAW.test(name) || HEIC.test(name) || IMG.test(name) || /^image\//.test(type || '');
  }

  function extOf(name) {
    var m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
    return m ? m[1].toUpperCase() : 'FILE';
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  // ---- Requests ------------------------------------------------------------

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    }).then(function (r) {
      if (r.status === 401) { location.href = '/portal/'; throw new Error('Logged out'); }
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || ('Error ' + r.status)); e.status = r.status; e.data = d; throw e; }
        return d;
      });
    });
  }

  // PUT/POST a blob with upload progress (fetch can't report progress).
  function send(method, url, blob, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, url);
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      if (x.upload && onProgress) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded); };
      x.onload = function () {
        var d = {};
        try { d = JSON.parse(x.responseText); } catch (e) {}
        if (x.status === 401) { location.href = '/portal/'; return reject(new Error('Logged out')); }
        if (x.status >= 200 && x.status < 300) resolve(d);
        else reject(new Error(d.error || ('Upload failed (' + x.status + ')')));
      };
      x.onerror = function () { reject(new Error('Network problem')); };
      x.send(blob);
    });
  }

  function withRetry(fn, tries) {
    return fn().catch(function (e) {
      if (tries <= 1 || /Logged out/.test(e.message)) throw e;
      return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return withRetry(fn, tries - 1); });
    });
  }

  // Upload one original. Resolves to its id.
  function uploadOriginal(file, batch, onProgress) {
    var q = 'name=' + encodeURIComponent(file.name) + '&type=' + encodeURIComponent(file.type || '') + '&batch=' + batch;
    if (file.size <= SINGLE_MAX) {
      return withRetry(function () { return send('POST', '/api/upload?' + q, file, onProgress); }, 3)
        .then(function (d) { return d.id; });
    }
    return api('POST', '/api/upload/multipart?' + q).then(function (m) {
      var parts = [], n = Math.ceil(file.size / PART), done = 0;
      var next = function (i) {
        if (i > n) return Promise.resolve();
        var chunk = file.slice((i - 1) * PART, Math.min(i * PART, file.size));
        var u = '/api/upload/part?key=' + encodeURIComponent(m.key) + '&uploadId=' + encodeURIComponent(m.uploadId) + '&part=' + i;
        return withRetry(function () {
          return send('PUT', u, chunk, function (l) { onProgress && onProgress(done + l); });
        }, 4).then(function (p) {
          parts.push({ partNumber: p.partNumber, etag: p.etag });
          done += chunk.size;
          return next(i + 1);
        });
      };
      return next(1)
        .then(function () { return api('POST', '/api/upload/complete', { key: m.key, uploadId: m.uploadId, parts: parts }); })
        .then(function () { return m.id; })
        .catch(function (e) {
          api('POST', '/api/upload/abort', { key: m.key, uploadId: m.uploadId }).catch(function () {});
          throw e;
        });
    });
  }

  // Make and upload the web and thumbnail copies. Resolves to {web, thumb} urls, or null.
  function uploadPreviews(id, file) {
    return makePreviews(file).then(function (pv) {
      if (!pv) return null;
      var put = function (kind, b) {
        return withRetry(function () {
          return send('PUT', '/api/preview/' + id + '?kind=' + kind + '&ext=' + b.ext, b.blob);
        }, 3);
      };
      return put('thumb', pv.thumb).then(function (t) {
        return put('web', pv.web).then(function (w) { return { thumb: t.url, web: w.url }; });
      });
    }).catch(function (e) { console.warn('No preview for', file.name, e); return null; });
  }

  // ---- Decoding ------------------------------------------------------------

  function makePreviews(file) {
    var name = file.name || '';
    if (!canPreview(name, file.type)) return Promise.resolve(null);
    return decode(file).then(function (src) {
      return encode(src, WEB_MAX, 0.85).then(function (web) {
        return encode(src, THUMB_MAX, 0.8).then(function (thumb) {
          if (src.bitmap && src.bitmap.close) src.bitmap.close();
          return { web: web, thumb: thumb };
        });
      });
    });
  }

  function decode(file) {
    var name = file.name || '';
    if (RAW.test(name)) return decodeRaw(file);
    if (HEIC.test(name) || /hei[cf]/i.test(file.type)) {
      return bitmap(file, true).catch(function () {
        return loadHeic2any().then(function (h) {
          return h({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        }).then(function (out) { return bitmap(Array.isArray(out) ? out[0] : out, true); });
      });
    }
    return bitmap(file, true);
  }

  function bitmap(blob, fromImage) {
    var opts = { imageOrientation: fromImage ? 'from-image' : 'none' };
    var viaImg = function () {
      return new Promise(function (resolve, reject) {
        var u = URL.createObjectURL(blob), im = new Image();
        im.onload = function () { URL.revokeObjectURL(u); resolve({ bitmap: im, w: im.naturalWidth, h: im.naturalHeight, orient: 1 }); };
        im.onerror = function () { URL.revokeObjectURL(u); reject(new Error('Cannot decode')); };
        im.src = u;
      });
    };
    if (!window.createImageBitmap) return viaImg();
    return createImageBitmap(blob, opts).then(function (b) {
      return { bitmap: b, w: b.width, h: b.height, orient: 1 };
    }, viaImg);
  }

  var heicPromise = null;
  function loadHeic2any() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (!heicPromise) {
      heicPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
        s.onload = function () { window.heic2any ? resolve(window.heic2any) : reject(new Error('heic2any missing')); };
        s.onerror = function () { heicPromise = null; reject(new Error('Could not load HEIC decoder')); };
        document.head.appendChild(s);
      });
    }
    return heicPromise;
  }

  // Camera raw (DNG etc.): find the JPEG previews stored inside the TIFF
  // structure and use the biggest one a browser can decode.
  function decodeRaw(file) {
    return file.arrayBuffer().then(function (buf) {
      var found = tiffJpegs(buf);
      var tryAt = function (i) {
        if (i >= found.list.length) return Promise.reject(new Error('No usable preview inside ' + file.name));
        var c = found.list[i];
        var blob = new Blob([new Uint8Array(buf, c.off, c.len)], { type: 'image/jpeg' });
        return bitmap(blob, false).then(function (src) {
          if (src.w < 64) throw new Error('too small');
          src.orient = found.orient;
          return src;
        }).catch(function () { return tryAt(i + 1); });
      };
      return tryAt(0);
    });
  }

  function tiffJpegs(buf) {
    var dv = new DataView(buf), size = buf.byteLength, list = [], orient = 1, seen = {};
    if (size < 16) return { list: list, orient: 1 };
    var bo = dv.getUint16(0);
    if (bo !== 0x4949 && bo !== 0x4d4d) return { list: list, orient: 1 };
    var le = bo === 0x4949;
    var u16 = function (o) { return dv.getUint16(o, le); };
    var u32 = function (o) { return dv.getUint32(o, le); };
    if (u16(2) !== 42) return { list: list, orient: 1 };
    var TS = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 };

    var values = function (e) {
      var type = u16(e + 2), count = u32(e + 4), ts = TS[type] || 1;
      var at = ts * count <= 4 ? e + 8 : u32(e + 8), out = [];
      for (var i = 0; i < Math.min(count, 4096); i++) {
        var o = at + i * ts;
        if (o + ts > size) break;
        out.push(type === 3 || type === 8 ? u16(o) : u32(o));
      }
      return out;
    };
    var add = function (off, len) {
      if (off > 0 && len > 2000 && off + len <= size && dv.getUint8(off) === 0xff && dv.getUint8(off + 1) === 0xd8 && browserJpeg(dv, off, len)) {
        list.push({ off: off, len: len });
      }
    };
    var walk = function (off, depth) {
      var guard = 0;
      while (off && off + 2 <= size && !seen[off] && depth < 6 && guard++ < 64) {
        seen[off] = true;
        var n = u16(off);
        if (off + 2 + n * 12 + 4 > size) return;
        var tags = {};
        for (var i = 0; i < n; i++) { var e = off + 2 + i * 12; tags[u16(e)] = e; }
        if (depth === 0 && orient === 1 && tags[0x112]) orient = values(tags[0x112])[0] || 1;
        if (tags[0x201] && tags[0x202]) add(values(tags[0x201])[0], values(tags[0x202])[0]);
        var comp = tags[0x103] ? values(tags[0x103])[0] : 0;
        if ((comp === 6 || comp === 7) && tags[0x111] && tags[0x117]) {
          var so = values(tags[0x111]), sc = values(tags[0x117]);
          // One strip, or strips stored back to back, make one JPEG.
          var total = 0, ok = true;
          for (var k = 0; k < so.length; k++) {
            if (so[k] !== so[0] + total) { ok = false; break; }
            total += sc[k] || 0;
          }
          if (ok) add(so[0], total);
        }
        if (tags[0x14a]) values(tags[0x14a]).forEach(function (s) { walk(s, depth + 1); });
        if (tags[0x8769]) walk(values(tags[0x8769])[0], depth + 1);
        off = u32(off + 2 + n * 12);
      }
    };
    walk(u32(4), 0);
    list.sort(function (a, b) { return b.len - a.len; });
    return { list: list, orient: orient };
  }

  // True for normal (baseline or progressive) JPEGs; raw sensor data is often
  // stored as lossless JPEG, which browsers can't open.
  function browserJpeg(dv, off, len) {
    var p = off + 2, end = Math.min(off + len, off + 262144);
    while (p + 4 <= end) {
      if (dv.getUint8(p) !== 0xff) return false;
      var m = dv.getUint8(p + 1);
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) return true;
      if ((m >= 0xc3 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) || m === 0xda) return false;
      p += 2 + dv.getUint16(p + 2);
    }
    return false;
  }

  function encode(src, max, quality) {
    var swap = src.orient >= 5 && src.orient <= 8;
    var w = swap ? src.h : src.w, h = swap ? src.w : src.h;
    var scale = Math.min(1, max / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    // Undo the camera's rotation flag (only set for raw files; other formats are rotated while decoding).
    var dw = swap ? ch : cw, dh = swap ? cw : ch;
    switch (src.orient) {
      case 2: g.setTransform(-1, 0, 0, 1, cw, 0); break;
      case 3: g.setTransform(-1, 0, 0, -1, cw, ch); break;
      case 4: g.setTransform(1, 0, 0, -1, 0, ch); break;
      case 5: g.setTransform(0, 1, 1, 0, 0, 0); break;
      case 6: g.setTransform(0, 1, -1, 0, cw, 0); break;
      case 7: g.setTransform(0, -1, -1, 0, cw, ch); break;
      case 8: g.setTransform(0, -1, 1, 0, 0, ch); break;
    }
    g.drawImage(src.bitmap, 0, 0, dw, dh);
    var toBlob = function (type) {
      return new Promise(function (resolve) { c.toBlob(resolve, type, quality); });
    };
    return toBlob('image/webp').then(function (b) {
      if (b && b.type === 'image/webp') return { blob: b, ext: 'webp' };
      return toBlob('image/jpeg').then(function (j) {
        if (!j) throw new Error('Could not encode');
        return { blob: j, ext: 'jpg' };
      });
    });
  }

  window.Mach = {
    api: api,
    uploadOriginal: uploadOriginal,
    uploadPreviews: uploadPreviews,
    makePreviews: makePreviews,
    canPreview: canPreview,
    extOf: extOf,
    fmtSize: fmtSize,
    logout: function () {
      api('POST', '/api/logout').catch(function () {}).then(function () { location.href = '/portal/'; });
    }
  };
})();
