// Admin photo page.
//
// Left: a grid of photos. "Uploads" shows everything the uploader sent that
// isn't in a project yet. Select photos (click, Ctrl/Cmd+click, Shift+click,
// arrow keys, Ctrl+A) and Group them into a project. Inside a project you can
// reorder (drag, or Alt+arrow keys) and trash photos.
// Right: the projects that are on the site, Trash, and the Push button.
//
// Every change autosaves to the server as a draft. Nothing on the live site
// changes until Push.
(function () {
  'use strict';
  var M = window.Mach;
  var $ = function (id) { return document.getElementById(id); };
  var bar = $('bar'), hint = $('hint'), grid = $('grid'), plist = $('plist');
  var pushBtn = $('push'), pushInfo = $('pushInfo'), saveState = $('saveState');

  var uploads = {};          // id -> upload record from the server
  var draft = null;          // { rev, projects: [...], trash: [{photo, from}] }
  var published = null;      // { rev, at } of the last push
  var view = { kind: 'uploads' };
  var list = [];             // photo ids shown in the grid, in order
  var sel = new Set();
  var cursorId = null, anchorId = null;
  var undoStack = [], redoStack = [];
  var CAT_LABEL = { residential: 'Residential', commercial: 'Commercial' };

  $('logout').addEventListener('click', function () {
    flushSave().then(M.logout);
  });

  // ---- Photos ----------------------------------------------------------------
  function info(pid) {
    if (pid.indexOf('a:') === 0) {
      var f = pid.slice(2);
      var thumb = /\.webp$/.test(f) ? f.replace(/\.webp$/, '-thumb.webp') : f;
      return { name: f, thumb: '/assets/' + thumb, web: '/assets/' + f, orig: '/assets/' + f, ext: '' };
    }
    var u = uploads[pid.slice(2)];
    if (!u) return { name: 'Missing file', thumb: null, web: null, orig: null, ext: '?' };
    return { name: u.name, thumb: u.thumb, web: u.web || u.thumb, orig: u.orig, ext: M.extOf(u.name), size: u.size };
  }

  function placed() {
    var s = new Set();
    draft.projects.forEach(function (p) { p.photos.forEach(function (x) { s.add(x); }); });
    draft.trash.forEach(function (t) { s.add(t.photo); });
    return s;
  }

  function ungrouped() {
    var s = placed();
    return Object.keys(uploads).map(function (id) { return uploads[id]; })
      .filter(function (u) { return !s.has('u:' + u.id); })
      .sort(function (a, b) {
        // Newest upload batch first; inside a batch, by file name.
        var ba = a.batch || a.uploaded, bb = b.batch || b.uploaded;
        if (ba !== bb) return ba < bb ? 1 : -1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      })
      .map(function (u) { return 'u:' + u.id; });
  }

  function project(id) {
    for (var i = 0; i < draft.projects.length; i++) if (draft.projects[i].id === id) return draft.projects[i];
    return null;
  }

  // ---- Changes, undo, autosave ------------------------------------------------
  var snapshot = function () { return JSON.stringify({ projects: draft.projects, trash: draft.trash }); };

  function change(fn) {
    var before = snapshot();
    fn();
    if (snapshot() === before) return;
    undoStack.push(before);
    if (undoStack.length > 300) undoStack.shift();
    redoStack = [];
    dirty();
    render();
  }

  function restore(s) {
    var o = JSON.parse(s);
    draft.projects = o.projects;
    draft.trash = o.trash;
    if (view.kind === 'project' && !project(view.id)) goTo('');
    dirty();
    render();
  }
  function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); } }
  function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); } }

  var saveTimer = null, saving = false, pending = false;
  function setSave(text, bad) {
    saveState.textContent = text;
    saveState.classList.toggle('bad', !!bad);
  }
  function dirty() {
    pending = true;
    setSave('Saving...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
    renderPush();
  }
  function save() {
    if (saving || !pending) return;
    saving = true;
    pending = false;
    var body = { baseRev: draft.rev, projects: draft.projects, trash: draft.trash };
    M.api('PUT', '/api/state', body).then(function (r) {
      draft.rev = r.rev;
      saving = false;
      if (pending) save();
      else setSave('All changes saved');
      renderPush();
    }).catch(function (e) {
      saving = false;
      if (e.status === 409 && e.data && e.data.draft) {
        // Someone saved from another tab or device: take theirs.
        draft = e.data.draft;
        undoStack = []; redoStack = [];
        pending = false;
        setSave('All changes saved');
        toast('This was changed in another tab or device, so the latest version was loaded.');
        if (view.kind === 'project' && !project(view.id)) goTo('');
        render();
        return;
      }
      pending = true;
      setSave('Could not save (' + e.message + '). Retrying...', true);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 4000);
    });
  }
  function flushSave() {
    return new Promise(function (resolve) {
      clearTimeout(saveTimer);
      var check = function () {
        if (!pending && !saving) return resolve();
        save();
        setTimeout(check, 150);
      };
      check();
    });
  }
  window.addEventListener('beforeunload', function (e) {
    if (pending || saving) { save(); e.preventDefault(); e.returnValue = ''; }
  });

  // ---- Actions ------------------------------------------------------------------
  function selectedInOrder() { return list.filter(function (id) { return sel.has(id); }); }

  function takeOut(ids) {
    var s = new Set(ids);
    draft.projects.forEach(function (p) { p.photos = p.photos.filter(function (x) { return !s.has(x); }); });
    draft.trash = draft.trash.filter(function (t) { return !s.has(t.photo); });
  }

  function slug(name) {
    var base = name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
    var id = base, n = 2;
    while (project(id)) id = base + '-' + n++;
    return id;
  }

  function newProject(name, category, ids) {
    var p = { id: slug(name), name: name, type: '', category: category, photos: [] };
    // New projects go first in their section; drag them in the list to move them.
    var at = -1;
    for (var i = 0; i < draft.projects.length; i++) if (draft.projects[i].category === category) { at = i; break; }
    if (at < 0) draft.projects.push(p); else draft.projects.splice(at, 0, p);
    takeOut(ids);
    p.photos = ids.slice();
    return p;
  }

  function addTo(p, ids) {
    var mine = ids.filter(function (x) { return p.photos.indexOf(x) < 0; });
    takeOut(mine);
    p.photos = p.photos.concat(mine);
  }

  function trashSelected() {
    if (view.kind !== 'project' || !sel.size) return;
    var p = project(view.id), ids = selectedInOrder();
    change(function () {
      takeOut(ids);
      ids.forEach(function (x) { draft.trash.push({ photo: x, from: p.id }); });
    });
    sel.clear();
    toast(ids.length + (ids.length === 1 ? ' photo' : ' photos') + ' moved to Trash. Undo brings ' + (ids.length === 1 ? 'it' : 'them') + ' back.');
    render();
  }

  function restoreSelected() {
    if (view.kind !== 'trash' || !sel.size) return;
    var ids = selectedInOrder(), stuck = 0;
    change(function () {
      ids.forEach(function (x) {
        var t = draft.trash.filter(function (t2) { return t2.photo === x; })[0];
        var p = t && t.from && project(t.from);
        draft.trash = draft.trash.filter(function (t2) { return t2.photo !== x; });
        if (p) p.photos.push(x);
        else if (x.indexOf('u:') !== 0) { draft.trash.push(t); stuck++; } // site photo whose project is gone
        // An upload without its project goes back to Uploads.
      });
    });
    sel.clear();
    toast(stuck ? stuck + ' could not go back because their project was deleted. Use Undo to bring the project back.'
      : 'Restored ' + ids.length + (ids.length === 1 ? ' photo.' : ' photos.'));
    render();
  }

  function deleteProject() {
    var p = project(view.id);
    if (!p) return;
    if (!confirm('Delete the project "' + p.name + '"?\n\nUploaded photos in it go back to Uploads, and site photos go to Trash. Undo can bring it back.')) return;
    change(function () {
      draft.projects = draft.projects.filter(function (x) { return x !== p; });
      p.photos.forEach(function (x) { if (x.indexOf('a:') === 0) draft.trash.push({ photo: x, from: p.id }); });
    });
    goTo('');
    toast('Deleted "' + p.name + '".');
  }

  // Move the selected photos (inside a project) so they start at index `at` of the current list.
  function moveSelectedTo(at) {
    if (view.kind !== 'project' || !sel.size) return;
    var p = project(view.id);
    var moving = p.photos.filter(function (x) { return sel.has(x); });
    var before = p.photos.slice(0, at).filter(function (x) { return !sel.has(x); }).length;
    var rest = p.photos.filter(function (x) { return !sel.has(x); });
    change(function () {
      p.photos = rest.slice(0, before).concat(moving, rest.slice(before));
    });
  }

  function nudge(step) {
    var idx = list.map(function (x, i) { return sel.has(x) ? i : -1; }).filter(function (i) { return i >= 0; });
    if (!idx.length) return;
    var lo = idx[0], hi = idx[idx.length - 1];
    if (step < 0) moveSelectedTo(Math.max(0, lo + step));
    else moveSelectedTo(Math.min(list.length, hi + 1 + step));
    scrollToCursor();
  }

  // ---- Dialog: new project / move / edit -------------------------------------------
  var dlg = $('dlg'), dlgForm = $('dlgForm'), dlgMode = null;
  function openDialog(mode) {
    dlgMode = mode;
    var n = sel.size;
    var p = view.kind === 'project' ? project(view.id) : null;
    $('dlgErr').textContent = '';
    dlgForm.pname.value = mode === 'edit' ? p.name : '';
    dlgForm.querySelectorAll('input[name=cat]').forEach(function (r) { r.checked = mode === 'edit' && r.value === p.category; });
    $('dlgTitle').textContent = mode === 'edit' ? 'Edit project' : mode === 'move' ? 'Move to another project' : 'Make a project';
    $('dlgSub').textContent = mode === 'edit' ? '' : n + (n === 1 ? ' photo selected' : ' photos selected');
    $('dlgOk').textContent = mode === 'edit' ? 'Save' : 'Create project';
    var sl = dlgForm.existing;
    sl.innerHTML = '<option value="">Choose a project...</option>';
    ['residential', 'commercial'].forEach(function (c) {
      var g = document.createElement('optgroup');
      g.label = CAT_LABEL[c];
      draft.projects.forEach(function (x) {
        if (x.category !== c || (p && x.id === p.id)) return;
        var o = document.createElement('option');
        o.value = x.id;
        o.textContent = x.name;
        g.appendChild(o);
      });
      if (g.children.length) sl.appendChild(g);
    });
    $('dlgExisting').hidden = mode === 'edit' || sl.options.length < 2;
    syncDialog();
    dlg.showModal();
    setTimeout(function () { dlgForm.pname.focus(); }, 0);
  }
  function syncDialog() {
    var useExisting = !!dlgForm.existing.value && dlgMode !== 'edit';
    dlgForm.pname.disabled = useExisting;
    dlgForm.querySelectorAll('input[name=cat]').forEach(function (r) { r.disabled = useExisting; });
    if (dlgMode !== 'edit') $('dlgOk').textContent = useExisting ? 'Add to project' : 'Create project';
  }
  dlgForm.existing.addEventListener('change', syncDialog);
  $('dlgCancel').addEventListener('click', function () { dlg.close(); });
  dlgForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = dlgForm.pname.value.trim().replace(/\s+/g, ' ');
    var catEl = dlgForm.querySelector('input[name=cat]:checked');
    var existing = dlgMode !== 'edit' && dlgForm.existing.value;
    if (!existing) {
      if (!catEl) { $('dlgErr').textContent = 'Pick Residential or Commercial.'; return; }
      if (!name) { $('dlgErr').textContent = 'Give the project a name.'; dlgForm.pname.focus(); return; }
    }
    var ids = selectedInOrder();
    var target;
    if (dlgMode === 'edit') {
      var p = project(view.id);
      change(function () { p.name = name; p.category = catEl.value; });
      dlg.close();
      render();
      return;
    }
    change(function () {
      if (existing) { target = project(existing); addTo(target, ids); }
      else target = newProject(name, catEl.value, ids);
    });
    dlg.close();
    sel.clear();
    toast((existing ? 'Added ' : 'Made "' + target.name + '" with ') + ids.length + (ids.length === 1 ? ' photo' : ' photos') + (existing ? ' to "' + target.name + '".' : '.'));
    flash(target.id);
    render();
  });

  // ---- Views -----------------------------------------------------------------------
  function goTo(hash) {
    if (location.hash.replace(/^#/, '') === hash) applyHash();
    else location.hash = hash;
  }
  function applyHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    var m = /^project=(.+)$/.exec(h);
    if (m && project(m[1])) view = { kind: 'project', id: m[1] };
    else if (h === 'trash') view = { kind: 'trash' };
    else view = { kind: 'uploads' };
    sel.clear();
    cursorId = anchorId = null;
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', applyHash);

  function btn(label, fn, opts) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (opts && opts.cls ? ' ' + opts.cls : '');
    b.textContent = label;
    if (opts && opts.title) b.title = opts.title;
    if (opts && opts.disabled) b.disabled = true;
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  }

  function render() {
    if (!draft) return;
    if (view.kind === 'project') list = project(view.id).photos.slice();
    else if (view.kind === 'trash') list = draft.trash.map(function (t) { return t.photo; }).reverse();
    else list = ungrouped();
    var still = new Set(list);
    sel.forEach(function (x) { if (!still.has(x)) sel.delete(x); });
    if (cursorId && !still.has(cursorId)) cursorId = null;
    if (anchorId && !still.has(anchorId)) anchorId = null;
    renderBar();
    renderGrid();
    renderSide();
    renderPush();
  }

  function renderBar() {
    bar.innerHTML = '';
    var h = document.createElement('h1');
    var p = view.kind === 'project' ? project(view.id) : null;
    if (view.kind !== 'uploads') btn('← Back', function () { goTo(''); }, { title: 'Back to Uploads' });
    var nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = p ? p.name : view.kind === 'trash' ? 'Trash' : 'Uploads';
    h.appendChild(nm);
    if (p) {
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = CAT_LABEL[p.category];
      h.appendChild(tag);
    }
    bar.appendChild(h);
    if (p) {
      btn('Edit', function () { openDialog('edit'); }, { title: 'Rename, or switch Residential/Commercial' });
      btn('Delete project', deleteProject, { cls: 'btn-danger' });
    }

    var count = document.createElement('span');
    count.className = 'count';
    count.id = 'count';
    bar.appendChild(count);
    var grow = document.createElement('span');
    grow.className = 'grow';
    bar.appendChild(grow);

    btn('Select all', selectAll, { title: 'Ctrl+A', disabled: !list.length });
    btn('Deselect all', deselectAll, { title: 'Esc', disabled: !sel.size }).dataset.needsSel = '1';
    if (view.kind === 'uploads') {
      btn('Group into project', function () { openDialog('group'); }, { cls: 'btn-primary', title: 'G', disabled: !sel.size }).dataset.needsSel = '1';
    } else if (view.kind === 'project') {
      btn('Move to...', function () { openDialog('move'); }, { title: 'M', disabled: !sel.size }).dataset.needsSel = '1';
      btn('Trash', trashSelected, { cls: 'btn-danger', title: 'Delete key', disabled: !sel.size }).dataset.needsSel = '1';
    } else {
      btn('Restore', restoreSelected, { cls: 'btn-primary', disabled: !sel.size }).dataset.needsSel = '1';
    }
    btn('Undo', undo, { title: 'Ctrl+Z', disabled: !undoStack.length });
    btn('Redo', redo, { title: 'Ctrl+Shift+Z', disabled: !redoStack.length });

    hint.textContent = view.kind === 'project'
      ? 'Drag photos to reorder them (or select and press Alt + arrow keys). Delete moves selected photos to Trash. Double-click or Enter opens a photo.'
      : view.kind === 'trash'
        ? 'Photos trashed from projects. Select and Restore to put them back where they were.'
        : 'Click to select, Ctrl+click to add, Shift+click for a range. Arrow keys move, Shift+arrows extend. Double-click or Enter opens a photo. Group turns the selection into a project.';
    updateCount();
  }

  function updateCount() {
    var c = $('count');
    if (c) c.textContent = (sel.size ? sel.size + ' of ' : '') + list.length + (list.length === 1 ? ' photo' : ' photos');
    bar.querySelectorAll('[data-needs-sel]').forEach(function (b) { b.disabled = !sel.size; });
  }

  function renderGrid() {
    var y = window.scrollY;
    grid.innerHTML = '';
    grid.classList.toggle('can-drag', view.kind === 'project');
    if (!list.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = view.kind === 'uploads' ? 'No new uploads. Everything uploaded is in a project.'
        : view.kind === 'trash' ? 'Trash is empty.' : 'This project has no photos.';
      grid.appendChild(e);
      return;
    }
    var frag = document.createDocumentFragment();
    list.forEach(function (pid, i) {
      var inf = info(pid);
      var t = document.createElement('div');
      t.className = 'tile';
      t.dataset.id = pid;
      t.title = inf.name;
      t.draggable = view.kind !== 'trash';
      if (inf.thumb) {
        var img = document.createElement('img');
        img.loading = i < 40 ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.alt = inf.name;
        img.src = inf.thumb;
        t.appendChild(img);
      } else {
        var f = document.createElement('div');
        f.className = 'file';
        f.innerHTML = '<b></b><span></span>';
        f.firstChild.textContent = inf.ext;
        f.lastChild.textContent = inf.name;
        t.appendChild(f);
      }
      if (inf.ext && inf.thumb && !/^(JPE?G|PNG|WEBP)$/.test(inf.ext)) {
        var x = document.createElement('span');
        x.className = 'ext';
        x.textContent = inf.ext;
        t.appendChild(x);
      }
      var ck = document.createElement('span');
      ck.className = 'check';
      t.appendChild(ck);
      var z = document.createElement('button');
      z.type = 'button';
      z.className = 'zoom';
      z.tabIndex = -1;
      z.setAttribute('aria-label', 'Open large');
      z.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h6v2H7.4l4.3 4.3-1.4 1.4L6 7.4V10H4V4zm16 16h-6v-2h2.6l-4.3-4.3 1.4-1.4 4.3 4.3V14h2v6z"/></svg>';
      t.appendChild(z);
      frag.appendChild(t);
    });
    grid.appendChild(frag);
    updateSel();
    window.scrollTo(0, y);
  }

  function tileOf(pid) { return grid.querySelector('.tile[data-id="' + CSS.escape(pid) + '"]'); }

  function updateSel() {
    grid.querySelectorAll('.tile').forEach(function (t) {
      t.classList.toggle('is-sel', sel.has(t.dataset.id));
      t.classList.toggle('is-cursor', t.dataset.id === cursorId);
    });
    updateCount();
  }

  function renderSide() {
    plist.innerHTML = '';
    var item = function (label, count, thumb, active, onClick, pid) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'proj' + (active ? ' is-active' : '');
      b.innerHTML = '<span class="pt"></span><span class="pn"></span><span class="pc"></span>';
      if (thumb) b.firstChild.style.backgroundImage = 'url("' + thumb.replace(/"/g, '%22') + '")';
      b.children[1].textContent = label;
      b.children[2].textContent = count;
      b.addEventListener('click', onClick);
      if (pid) { b.dataset.pid = pid; b.draggable = true; }
      plist.appendChild(b);
      return b;
    };
    var ug = ungrouped();
    var firstThumb = ug.map(function (x) { return info(x).thumb; }).filter(Boolean)[0];
    item('Uploads', ug.length, firstThumb, view.kind === 'uploads', function () { goTo(''); })
      .dataset.target = 'uploads';
    ['residential', 'commercial'].forEach(function (c) {
      var h = document.createElement('h3');
      h.textContent = CAT_LABEL[c];
      plist.appendChild(h);
      draft.projects.forEach(function (p) {
        if (p.category !== c) return;
        item(p.name, p.photos.length, p.photos[0] && info(p.photos[0]).thumb,
          view.kind === 'project' && view.id === p.id,
          function () { goTo('project=' + encodeURIComponent(p.id)); }, p.id);
      });
    });
    var h = document.createElement('h3');
    h.textContent = ' ';
    plist.appendChild(h);
    item('Trash', draft.trash.length, null, view.kind === 'trash', function () { goTo('trash'); });
  }

  function flash(pid) {
    setTimeout(function () {
      var b = plist.querySelector('[data-pid="' + CSS.escape(pid) + '"]');
      if (!b) return;
      b.scrollIntoView({ block: 'nearest' });
      b.animate([{ background: 'rgba(162,14,21,.18)' }, { background: 'transparent' }], { duration: 1400 });
    }, 50);
  }

  function renderPush() {
    if (!draft) return;
    var behind = pending || saving || !published || published.rev !== draft.rev;
    if (!published) {
      pushInfo.textContent = 'Not pushed yet. The site shows the galleries as they were before this page.';
    } else if (behind) {
      pushInfo.textContent = 'You have changes that are not on the website yet. Last push ' + when(published.at) + '.';
    } else {
      pushInfo.textContent = 'The website is up to date. Pushed ' + when(published.at) + '.';
    }
  }
  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  pushBtn.addEventListener('click', function () {
    pushBtn.disabled = true;
    pushBtn.textContent = 'Pushing...';
    flushSave().then(function () {
      return M.api('POST', '/api/publish');
    }).then(function (r) {
      published = { rev: r.rev, at: r.at };
      toast('Pushed. The galleries now show ' + r.photos + ' photos' + (r.skipped ? ' (' + r.skipped + ' files skipped: no picture to show, e.g. videos)' : '') + '.');
    }).catch(function (e) {
      toast('Push failed: ' + e.message);
    }).then(function () {
      pushBtn.disabled = false;
      pushBtn.textContent = 'Push to website';
      renderPush();
    });
  });

  // ---- Selection ------------------------------------------------------------------
  function selectAll() { list.forEach(function (x) { sel.add(x); }); updateSel(); }
  function deselectAll() { sel.clear(); updateSel(); }
  function range(a, b) {
    var i = list.indexOf(a), j = list.indexOf(b);
    if (i < 0) i = j;
    var lo = Math.min(i, j), hi = Math.max(i, j);
    return list.slice(lo, hi + 1);
  }
  function scrollToCursor() {
    var t = cursorId && tileOf(cursorId);
    if (t) t.scrollIntoView({ block: 'nearest' });
  }

  grid.addEventListener('click', function (e) {
    var t = e.target.closest('.tile');
    if (!t) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) deselectAll();
      return;
    }
    var id = t.dataset.id;
    if (e.target.closest('.zoom')) { openLightbox(list.indexOf(id)); return; }
    var ctrl = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchorId) {
      if (!ctrl) sel.clear();
      range(anchorId, id).forEach(function (x) { sel.add(x); });
    } else if (ctrl) {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      anchorId = id;
    } else {
      sel.clear();
      sel.add(id);
      anchorId = id;
    }
    cursorId = id;
    grid.focus({ preventScroll: true });
    updateSel();
  });
  grid.addEventListener('dblclick', function (e) {
    var t = e.target.closest('.tile');
    if (t && !e.target.closest('.zoom')) openLightbox(list.indexOf(t.dataset.id));
  });

  function columns() {
    var cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  }

  document.addEventListener('keydown', function (e) {
    if (dlg.open) return;
    if (lbOpen) return lightboxKey(e);
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    var ctrl = e.ctrlKey || e.metaKey, k = e.key;

    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); selectAll(); return; }
    if (k === 'Escape') { deselectAll(); return; }
    if (!list.length) return;

    if (tag === 'button' && (k === 'Enter' || k === ' ')) return; // let the button work
    var cols = columns();
    var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k];
    if (k === 'Home') step = -list.length;
    if (k === 'End') step = list.length;

    if (step !== undefined) {
      e.preventDefault();
      if (e.altKey) {
        if (view.kind === 'project') nudge(step);
        return;
      }
      var cur = list.indexOf(cursorId);
      var ni = cur < 0 ? 0 : Math.max(0, Math.min(list.length - 1, cur + step));
      var nid = list[ni];
      if (e.shiftKey) {
        if (!anchorId) anchorId = cur < 0 ? nid : list[cur];
        if (!ctrl) sel.clear();
        range(anchorId, nid).forEach(function (x) { sel.add(x); });
      } else if (!ctrl) {
        sel.clear();
        sel.add(nid);
        anchorId = nid;
      }
      cursorId = nid;
      updateSel();
      scrollToCursor();
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      var id = cursorId || list[0];
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      cursorId = anchorId = id;
      updateSel();
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      var start = cursorId ? list.indexOf(cursorId) : list.indexOf(selectedInOrder()[0]);
      openLightbox(Math.max(0, start));
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && view.kind === 'project') { e.preventDefault(); trashSelected(); return; }
    if (!ctrl && !e.altKey && (k === 'g' || k === 'G') && view.kind === 'uploads' && sel.size) { e.preventDefault(); openDialog('group'); return; }
    if (!ctrl && !e.altKey && (k === 'm' || k === 'M') && view.kind === 'project' && sel.size) { e.preventDefault(); openDialog('move'); return; }
  });

  // ---- Drag and drop ------------------------------------------------------------------
  // Photos: reorder inside a project, or drop on a project in the list to add them.
  // Projects: drag in the list to change their order on the site.
  var drag = null; // { kind: 'photos' | 'project', id }
  var clearMarks = function () {
    document.querySelectorAll('.drop-before,.drop-after,.is-dragging').forEach(function (el) {
      el.classList.remove('drop-before', 'drop-after', 'is-dragging');
    });
  };

  grid.addEventListener('dragstart', function (e) {
    var t = e.target.closest && e.target.closest('.tile');
    if (!t) return;
    var id = t.dataset.id;
    if (!sel.has(id)) { sel.clear(); sel.add(id); anchorId = id; }
    cursorId = id;
    updateSel();
    drag = { kind: 'photos' };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', sel.size + ' photos'); } catch (err) {}
    grid.querySelectorAll('.tile.is-sel').forEach(function (x) { x.classList.add('is-dragging'); });
  });

  var dropAt = -1;
  grid.addEventListener('dragover', function (e) {
    if (!drag || drag.kind !== 'photos' || view.kind !== 'project') return;
    e.preventDefault();
    var t = e.target.closest('.tile');
    grid.querySelectorAll('.drop-before,.drop-after').forEach(function (el) { el.classList.remove('drop-before', 'drop-after'); });
    if (!t) { dropAt = -1; return; }
    var r = t.getBoundingClientRect();
    var after = e.clientX > r.left + r.width / 2;
    t.classList.add(after ? 'drop-after' : 'drop-before');
    dropAt = list.indexOf(t.dataset.id) + (after ? 1 : 0);
  });
  grid.addEventListener('drop', function (e) {
    if (!drag || drag.kind !== 'photos' || view.kind !== 'project') return;
    e.preventDefault();
    if (dropAt >= 0) moveSelectedTo(dropAt);
  });

  plist.addEventListener('dragstart', function (e) {
    var b = e.target.closest && e.target.closest('.proj[data-pid]');
    if (!b) return;
    drag = { kind: 'project', id: b.dataset.pid };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', b.dataset.pid); } catch (err) {}
    b.classList.add('is-dragging');
  });
  plist.addEventListener('dragover', function (e) {
    if (!drag) return;
    var b = e.target.closest('.proj');
    plist.querySelectorAll('.drop-before,.drop-after').forEach(function (el) { el.classList.remove('drop-before', 'drop-after'); });
    if (!b) return;
    if (drag.kind === 'photos') {
      // Drop photos on a project to add them (not on the one they're in).
      if (!b.dataset.pid || (view.kind === 'project' && b.dataset.pid === view.id)) return;
      e.preventDefault();
      b.classList.add('drop-before', 'drop-after');
      return;
    }
    var from = project(drag.id), to = b.dataset.pid && project(b.dataset.pid);
    if (!to || to === from || to.category !== from.category) return;
    e.preventDefault();
    var r = b.getBoundingClientRect();
    b.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  });
  plist.addEventListener('drop', function (e) {
    if (!drag) return;
    var b = e.target.closest('.proj[data-pid]');
    if (!b) return;
    e.preventDefault();
    var to = project(b.dataset.pid);
    if (drag.kind === 'photos') {
      var ids = selectedInOrder();
      change(function () { addTo(to, ids); });
      sel.clear();
      toast('Added ' + ids.length + (ids.length === 1 ? ' photo' : ' photos') + ' to "' + to.name + '".');
      flash(to.id);
      render();
      return;
    }
    var from = project(drag.id);
    if (!to || to === from || to.category !== from.category) return;
    var r = b.getBoundingClientRect();
    var after = e.clientY > r.top + r.height / 2;
    change(function () {
      var arr = draft.projects.filter(function (x) { return x !== from; });
      var at = arr.indexOf(to) + (after ? 1 : 0);
      arr.splice(at, 0, from);
      draft.projects = arr;
    });
  });
  document.addEventListener('dragend', function () { drag = null; dropAt = -1; clearMarks(); });

  // ---- Lightbox -----------------------------------------------------------------------
  var lbx = $('lbx'), lbImg = $('lbxImg'), lbFile = $('lbxFile'), lbCount = $('lbxCount'), lbSel = $('lbxSel'), lbOrig = $('lbxOrig');
  var lbOpen = false, lbList = [], lbIndex = 0;
  function openLightbox(i) {
    if (i < 0 || !list.length) return;
    lbList = list.slice();
    lbIndex = i;
    lbOpen = true;
    lbx.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    showLb();
  }
  function closeLightbox() {
    lbOpen = false;
    lbx.classList.remove('is-open');
    document.body.style.overflow = '';
    lbImg.removeAttribute('src');
    cursorId = lbList[lbIndex];
    updateSel();
    scrollToCursor();
    grid.focus({ preventScroll: true });
  }
  function showLb() {
    lbIndex = (lbIndex + lbList.length) % lbList.length;
    var pid = lbList[lbIndex], inf = info(pid);
    if (inf.web) {
      lbImg.hidden = false;
      lbFile.hidden = true;
      lbImg.src = inf.web;
      lbImg.alt = inf.name;
    } else {
      lbImg.hidden = true;
      lbFile.hidden = false;
      lbFile.textContent = inf.name + ' (no preview for this file type)';
    }
    lbCount.textContent = (lbIndex + 1) + ' of ' + lbList.length + '  ·  ' + inf.name + (inf.size ? ' (' + M.fmtSize(inf.size) + ')' : '');
    lbSel.textContent = sel.has(pid) ? 'Selected' : 'Select';
    lbSel.classList.toggle('on', sel.has(pid));
    if (inf.orig) { lbOrig.hidden = false; lbOrig.href = inf.orig; } else lbOrig.hidden = true;
    [1, -1].forEach(function (d) {
      var n = info(lbList[(lbIndex + d + lbList.length) % lbList.length]);
      if (n.web) new Image().src = n.web;
    });
  }
  function lbToggle() {
    var pid = lbList[lbIndex];
    if (sel.has(pid)) sel.delete(pid); else sel.add(pid);
    anchorId = pid;
    updateSel();
    showLb();
  }
  function lightboxKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); lbIndex++; showLb(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); lbIndex--; showLb(); }
    else if (e.key === 'Home') { e.preventDefault(); lbIndex = 0; showLb(); }
    else if (e.key === 'End') { e.preventDefault(); lbIndex = lbList.length - 1; showLb(); }
    else if (e.key === ' ') { e.preventDefault(); lbToggle(); }
  }
  lbx.querySelector('.lx-close').addEventListener('click', closeLightbox);
  lbx.querySelector('.lx-prev').addEventListener('click', function () { lbIndex--; showLb(); });
  lbx.querySelector('.lx-next').addEventListener('click', function () { lbIndex++; showLb(); });
  lbSel.addEventListener('click', lbToggle);
  lbx.addEventListener('click', function (e) { if (e.target === lbx) closeLightbox(); });
  var touchX = null;
  lbx.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
  lbx.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) { lbIndex += dx < 0 ? 1 : -1; showLb(); }
  });

  // ---- Toast --------------------------------------------------------------------------
  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4500);
  }

  // ---- Loading ------------------------------------------------------------------------
  function setUploads(arr) {
    var next = {};
    arr.forEach(function (u) { next[u.id] = u; });
    uploads = next;
  }

  // Uploads whose web copies weren't made (tab closed early, or a format the
  // uploader's browser couldn't read): try again here, one at a time.
  var tried = {};
  try { tried = JSON.parse(localStorage.getItem('mach-preview-tried') || '{}'); } catch (e) {}
  var backfilling = false;
  function backfill() {
    if (backfilling) return;
    var todo = Object.keys(uploads).map(function (id) { return uploads[id]; }).filter(function (u) {
      return !u.thumb && !tried[u.id] && M.canPreview(u.name, u.type) && u.size < 200 * 1024 * 1024;
    });
    if (!todo.length) return;
    backfilling = true;
    var i = 0;
    var next = function () {
      if (i >= todo.length) { backfilling = false; return; }
      var u = todo[i++];
      setSave('Making previews ' + i + ' of ' + todo.length + '...');
      fetch(u.orig, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('fetch ' + r.status);
        return r.blob();
      }).then(function (b) {
        var f = new File([b], u.name, { type: u.type || b.type });
        return M.uploadPreviews(u.id, f);
      }).then(function (r) {
        if (r) {
          u.thumb = r.thumb; u.web = r.web;
          render();
        } else {
          tried[u.id] = 1;
          try { localStorage.setItem('mach-preview-tried', JSON.stringify(tried)); } catch (e) {}
        }
      }).catch(function (e) { console.warn(e); }).then(function () {
        if (i >= todo.length) setSave(pending ? 'Saving...' : 'All changes saved');
        next();
      });
    };
    next();
  }

  function refreshUploads() {
    if (document.hidden) return;
    M.api('GET', '/api/uploads').then(function (d) {
      var before = Object.keys(uploads).length;
      var changedPreview = d.uploads.some(function (u) { var o = uploads[u.id]; return o && !o.thumb && u.thumb; });
      setUploads(d.uploads);
      if (d.uploads.length !== before || changedPreview) {
        if (d.uploads.length > before) toast((d.uploads.length - before) + ' new upload' + (d.uploads.length - before === 1 ? '' : 's') + ' arrived.');
        render();
      }
      backfill();
    }).catch(function () {});
  }

  bar.innerHTML = '<h1>Loading...</h1>';
  Promise.all([M.api('GET', '/api/state'), M.api('GET', '/api/uploads')]).then(function (r) {
    draft = r[0].draft;
    published = r[0].published;
    setUploads(r[1].uploads);
    setSave('All changes saved');
    applyHash();
    backfill();
    setInterval(refreshUploads, 60000);
    document.addEventListener('visibilitychange', refreshUploads);
  }).catch(function (e) {
    bar.innerHTML = '';
    var h = document.createElement('h1');
    h.textContent = 'Could not load: ' + e.message;
    bar.appendChild(h);
  });
})();
