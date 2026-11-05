// Uploader page: pick files, press Upload, see the history below.
(function () {
  'use strict';
  var M = window.Mach;
  var form = document.getElementById('form');
  var input = document.getElementById('files');
  var drop = document.getElementById('drop');
  var queueEl = document.getElementById('queue');
  var msg = document.getElementById('msg');
  var submit = document.getElementById('submit');
  var historyEl = document.getElementById('history');
  var picked = [];   // files waiting to be sent
  var busy = false;

  document.getElementById('logout').addEventListener('click', M.logout);

  function row(file) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="q-name"></span><span class="q-state"></span><span class="q-bar"><i></i></span>';
    li.querySelector('.q-name').textContent = file.name;
    li.querySelector('.q-state').textContent = M.fmtSize(file.size);
    queueEl.appendChild(li);
    return li;
  }

  function addFiles(list) {
    if (busy) return;
    Array.prototype.forEach.call(list, function (f) {
      if (!f.size && !f.type) return; // folders dropped by mistake
      picked.push({ file: f, li: row(f) });
    });
    msg.textContent = picked.length ? picked.length + (picked.length === 1 ? ' file' : ' files') + ' ready.' : '';
    submit.disabled = !picked.length;
  }

  input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function () { drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });
  // A file dropped anywhere else on the page shouldn't open it in the tab.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  window.addEventListener('beforeunload', function (e) {
    if (busy) { e.preventDefault(); e.returnValue = ''; }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !picked.length) return;
    busy = true;
    submit.disabled = true;
    input.disabled = true;
    var jobs = picked.slice();
    picked = [];
    var batch = String(Date.now());
    var ok = 0, failed = 0, i = 0;
    msg.textContent = 'Uploading... keep this page open until it says done.';

    var one = function (job) {
      var bar = job.li.querySelector('.q-bar i');
      var state = job.li.querySelector('.q-state');
      var f = job.file;
      state.textContent = '0%';
      return M.uploadOriginal(f, batch, function (loaded) {
        var pct = Math.min(99, Math.floor(loaded / Math.max(1, f.size) * 100));
        bar.style.width = pct + '%';
        state.textContent = pct + '%';
      }).then(function (id) {
        bar.style.width = '100%';
        state.textContent = M.canPreview(f.name, f.type) ? 'Finishing...' : 'Done';
        return M.uploadPreviews(id, f);
      }).then(function () {
        ok++;
        job.li.classList.add('done');
        state.textContent = 'Done';
      }).catch(function (err) {
        failed++;
        job.li.classList.add('fail');
        state.textContent = 'Failed: ' + err.message;
        picked.push({ file: f, li: job.li }); // can be retried with Upload
      });
    };
    // Three at a time.
    var worker = function () {
      if (i >= jobs.length) return Promise.resolve();
      return one(jobs[i++]).then(worker);
    };
    Promise.all([worker(), worker(), worker()]).then(function () {
      busy = false;
      input.disabled = false;
      submit.disabled = !picked.length;
      msg.textContent = failed
        ? ok + ' uploaded, ' + failed + ' failed. Press Upload to try the failed ones again.'
        : 'Done. ' + ok + (ok === 1 ? ' file' : ' files') + ' uploaded.';
      if (!failed) setTimeout(function () { if (!busy && !picked.length) queueEl.innerHTML = ''; }, 4000);
      loadHistory();
    });
  });

  // ---- History, grouped by day, newest first -------------------------------
  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  function loadHistory() {
    M.api('GET', '/api/uploads').then(function (d) {
      var ups = d.uploads.slice().sort(function (a, b) {
        return a.uploaded < b.uploaded ? 1 : a.uploaded > b.uploaded ? -1 : a.name.localeCompare(b.name);
      });
      var open = {};
      historyEl.querySelectorAll('details').forEach(function (el) { open[el.dataset.day] = el.open; });
      historyEl.innerHTML = '';
      if (!ups.length) { historyEl.innerHTML = '<p class="muted">Nothing uploaded yet.</p>'; return; }
      var groups = [], byDay = {};
      ups.forEach(function (u) {
        var d = new Date(u.uploaded), k = dayKey(d);
        if (!byDay[k]) { byDay[k] = { key: k, date: d, items: [] }; groups.push(byDay[k]); }
        byDay[k].items.push(u);
      });
      groups.forEach(function (g, n) {
        var det = document.createElement('details');
        det.dataset.day = g.key;
        det.open = g.key in open ? open[g.key] : n === 0;
        var sum = document.createElement('summary');
        var a = document.createElement('span');
        a.textContent = g.date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        var b = document.createElement('span');
        b.className = 'muted';
        b.textContent = g.items.length + (g.items.length === 1 ? ' file' : ' files');
        sum.appendChild(a); sum.appendChild(b);
        det.appendChild(sum);
        var ul = document.createElement('ul');
        g.items.forEach(function (u) {
          var li = document.createElement('li');
          var link = document.createElement('a');
          link.href = u.orig;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = u.name;
          var meta = document.createElement('span');
          meta.className = 'muted';
          meta.textContent = M.fmtSize(u.size) + ', ' + new Date(u.uploaded).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          li.appendChild(link); li.appendChild(meta);
          ul.appendChild(li);
        });
        det.appendChild(ul);
        historyEl.appendChild(det);
      });
    }).catch(function (e) {
      historyEl.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Could not load the history: ' + e.message;
      historyEl.appendChild(p);
    });
  }
  loadHistory();
})();
