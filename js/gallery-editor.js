// Temporary photo-order editor for the Commercial and Residential pages.
// Only loads when the page address ends in ?edit (see site.js), so visitors
// never see it. Drag photos to reorder, use the bin to remove one, then
// "Copy order" and send the result to have it applied to the real site.
(function () {
  'use strict';
  var grid = document.querySelector('.pg-grid');
  if (!grid) return;
  var KEY = 'mach-order:' + location.pathname;
  var nameOf = function (el) {
    return el.classList.contains('pg-sep') ? '#' + el.id : el.getAttribute('href').replace('/assets/', '');
  };
  var items = function () { return Array.prototype.slice.call(grid.children); };
  var removed = [];

  document.body.classList.add('pg-editing');

  // Lightbox stays shut while editing.
  document.addEventListener('click', function (e) {
    if (e.target.closest('.pg-item') && !e.target.closest('.pg-bin')) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Restore a saved order from this browser.
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.order) {
      var byName = {};
      items().forEach(function (el) { byName[nameOf(el)] = el; });
      saved.order.forEach(function (n) { if (byName[n]) { grid.appendChild(byName[n]); delete byName[n]; } });
      (saved.removed || []).forEach(function (n) { if (byName[n]) { byName[n].remove(); removed.push(byName[n]); delete byName[n]; } });
      Object.keys(byName).forEach(function (n) { grid.appendChild(byName[n]); });
    }
  } catch (e) {}

  var bar = document.createElement('div');
  bar.className = 'pg-editbar';
  bar.innerHTML = '<strong>Editing photo order</strong><span class="pg-editcount"></span>' +
    '<button type="button" data-act="undo">Undo delete</button>' +
    '<button type="button" data-act="copy">Copy order</button>' +
    '<button type="button" data-act="reset">Reset</button>';
  document.body.appendChild(bar);
  var count = bar.querySelector('.pg-editcount');

  var save = function () {
    var data = { page: location.pathname, order: items().map(nameOf), removed: removed.map(nameOf) };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    count.textContent = grid.querySelectorAll('.pg-item').length + ' photos, ' + removed.length + ' removed';
    bar.querySelector('[data-act=undo]').disabled = !removed.length;
    return data;
  };

  var addBin = function (el) {
    if (!el.classList.contains('pg-item') || el.querySelector('.pg-bin')) return;
    el.setAttribute('draggable', 'true');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg-bin';
    b.setAttribute('aria-label', 'Remove this photo');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      el._next = el.nextSibling; removed.push(el); el.remove(); save();
    });
    el.appendChild(b);
  };
  items().forEach(addBin);
  items().forEach(function (el) { if (el.classList.contains('pg-sep')) el.setAttribute('draggable', 'true'); });

  // Drag and drop (mouse). Photos and the project lines can both be moved.
  var dragging = null;
  grid.addEventListener('dragstart', function (e) {
    dragging = e.target.closest('.pg-item, .pg-sep');
    if (!dragging) return;
    dragging.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', ''); } catch (err) {}
  });
  grid.addEventListener('dragover', function (e) {
    if (!dragging) return;
    e.preventDefault();
    var t = e.target.closest('.pg-item, .pg-sep');
    if (!t || t === dragging) return;
    var r = t.getBoundingClientRect();
    var after = t.classList.contains('pg-sep') ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    grid.insertBefore(dragging, after ? t.nextSibling : t);
  });
  grid.addEventListener('dragend', function () {
    if (dragging) dragging.classList.remove('is-dragging');
    dragging = null; save();
  });

  // Touch: press and hold a photo, then slide it into place.
  var held = null, timer = null;
  grid.addEventListener('touchstart', function (e) {
    var t = e.target.closest('.pg-item, .pg-sep');
    if (!t || e.target.closest('.pg-bin')) return;
    timer = setTimeout(function () { held = t; held.classList.add('is-dragging'); }, 350);
  }, { passive: true });
  grid.addEventListener('touchmove', function (e) {
    if (!held) { clearTimeout(timer); return; }
    e.preventDefault();
    var p = e.touches[0];
    var under = document.elementFromPoint(p.clientX, p.clientY);
    var t = under && under.closest('.pg-item, .pg-sep');
    if (!t || t === held || !grid.contains(t)) return;
    var r = t.getBoundingClientRect();
    grid.insertBefore(held, p.clientX > r.left + r.width / 2 ? t.nextSibling : t);
  }, { passive: false });
  grid.addEventListener('touchend', function () {
    clearTimeout(timer);
    if (held) { held.classList.remove('is-dragging'); held = null; save(); }
  });

  bar.addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'undo' && removed.length) {
      var el = removed.pop(); grid.insertBefore(el, el._next && grid.contains(el._next) ? el._next : null); save();
    } else if (act === 'reset') {
      if (confirm('Throw away your changes on this page?')) { try { localStorage.removeItem(KEY); } catch (err) {} location.reload(); }
    } else if (act === 'copy') {
      var text = JSON.stringify(save());
      var done = function () { e.target.textContent = 'Copied!'; setTimeout(function () { e.target.textContent = 'Copy order'; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { prompt('Copy this:', text); });
      else prompt('Copy this:', text);
    }
  });
  save();
})();
