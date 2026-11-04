// Site behaviour. Replaces Webflow's runtime, jQuery and Magnific Popup.
(function () {
  'use strict';

  // Keep the footer year current.
  document.querySelectorAll('.js-year').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // ---- Navigation -------------------------------------------------------
  var nav = document.querySelector('.navbar-logo-left-container.shadow-three');
  var menu = nav && nav.querySelector('.w-nav-menu');
  var button = nav && nav.querySelector('.w-nav-button');
  var mobile = window.matchMedia('(max-width: 991px)');

  function setMenu(open) {
    if (!menu || !button) return;
    button.classList.toggle('w--open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      menu.setAttribute('data-nav-menu-open', '');
      requestAnimationFrame(function () { menu.classList.add('is-open'); });
    } else {
      menu.classList.remove('is-open');
      menu.removeAttribute('data-nav-menu-open');
    }
  }
  if (menu && button) {
    menu.id = menu.id || 'site-menu';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', 'Menu');
    button.setAttribute('aria-controls', menu.id);
    button.setAttribute('aria-expanded', 'false');
    var toggle = function () { setMenu(!button.classList.contains('w--open')); };
    button.addEventListener('click', toggle);
    button.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    document.addEventListener('click', function (e) {
      if (button.classList.contains('w--open') && !nav.contains(e.target)) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && button.classList.contains('w--open')) { setMenu(false); button.focus(); }
    });
    var onBreakpoint = function () { if (!mobile.matches) setMenu(false); };
    if (mobile.addEventListener) mobile.addEventListener('change', onBreakpoint);
  }

  // Header motion: slides away while scrolling down past the top of the page,
  // slides back as soon as you scroll up, and gets a soft shadow once the page
  // has moved. Small jitters (trackpads, iOS bounce) are ignored.
  if (nav) {
    var lastY = Math.max(window.scrollY, 0), ticking = false;
    var update = function () {
      ticking = false;
      var y = Math.max(window.scrollY, 0);
      var dy = y - lastY;
      nav.classList.toggle('nav-scrolled', y > 8);
      if (button && button.classList.contains('w--open')) { nav.classList.remove('nav-hidden'); lastY = y; return; }
      if (y < nav.offsetHeight) nav.classList.remove('nav-hidden');
      else if (dy > 6) nav.classList.add('nav-hidden');
      else if (dy < -6) nav.classList.remove('nav-hidden');
      else return;
      lastY = y;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    nav.addEventListener('focusin', function () { nav.classList.remove('nav-hidden'); });
    update();
  }

  // ---- Photo lightbox ---------------------------------------------------
  // Tiles are .pg-item links (photo galleries) or older .skate-img[href]
  // images. Arrows and swipes move through every photo on the page, or only
  // the nearest [data-gallery] group when there is one.
  var tiles = Array.prototype.slice.call(document.querySelectorAll('a.pg-item, .skate-img[href]'));
  if (tiles.length) {
    var box, img, count, set = [], label = '', index = 0, lastFocus = null, touchX = null;

    var build = function () {
      box = document.createElement('div');
      box.className = 'lb';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Photo viewer');
      box.innerHTML =
        '<img alt="">' +
        '<button type="button" class="lb-close" aria-label="Close">&times;</button>' +
        '<button type="button" class="lb-prev" aria-label="Previous photo">&#8249;</button>' +
        '<button type="button" class="lb-next" aria-label="Next photo">&#8250;</button>' +
        '<div class="lb-count" aria-live="polite"></div>';
      img = box.querySelector('img');
      count = box.querySelector('.lb-count');
      box.querySelector('.lb-close').addEventListener('click', close);
      box.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); show(index - 1); });
      box.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); show(index + 1); });
      img.addEventListener('click', function (e) { e.stopPropagation(); show(index + 1); });
      box.addEventListener('click', close);
      box.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
      box.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
      });
      document.body.appendChild(box);
    };
    var altOf = function (t) {
      var i = t.tagName === 'IMG' ? t : t.querySelector('img');
      return (i && i.getAttribute('alt')) || '';
    };
    var show = function (i) {
      index = (i + set.length) % set.length;
      img.src = set[index].getAttribute('href');
      img.alt = altOf(set[index]);
      // Gallery photos carry "Project, photo 3 of 12" in their alt text:
      // show the place within that project, e.g. "3 of 12 | 3Twelve Beauty Lounge".
      var m = /^(.*), photo (\d+) of (\d+)$/.exec(img.alt);
      count.textContent = m ? m[2] + ' of ' + m[3] + ' | ' + m[1]
        : (label ? label + ' \u00b7 ' : '') + (index + 1) + ' of ' + set.length;
      // Fetch the photos either side so swiping feels instant.
      [1, -1, 2].forEach(function (d) {
        new Image().src = set[(index + d + set.length) % set.length].getAttribute('href');
      });
    };
    var onKey = function (e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(index + 1);
      else if (e.key === 'ArrowLeft') show(index - 1);
      else if (e.key === 'Tab') {
        var f = box.querySelectorAll('button');
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    var open = function (t) {
      if (!box) build();
      var group = t.closest('[data-gallery]');
      set = group ? tiles.filter(function (x) { return group.contains(x); }) : tiles;
      label = group ? group.getAttribute('data-gallery') : '';
      lastFocus = document.activeElement;
      show(set.indexOf(t));
      box.style.display = 'flex';
      requestAnimationFrame(function () { box.classList.add('is-open'); });
      document.body.classList.add('no-scroll');
      document.addEventListener('keydown', onKey);
      box.querySelector('.lb-close').focus();
    };
    function close() {
      box.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { box.style.display = 'none'; }, 250);
      if (lastFocus) lastFocus.focus();
    }

    tiles.forEach(function (t) {
      if (t.tagName === 'IMG') {
        t.setAttribute('role', 'button');
        t.setAttribute('tabindex', '0');
        t.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(t); }
        });
      }
      t.addEventListener('click', function (e) { e.preventDefault(); open(t); });
    });
  }

  // ---- Faster photos --------------------------------------------------
  // Skip the extra downloads when the visitor asked to save data or is on a very slow line.
  var conn = navigator.connection || {};
  var roomy = !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '');
  var whenIdle = function (fn) {
    window.addEventListener('load', function () {
      (window.requestIdleCallback || function (f) { setTimeout(f, 300); })(fn);
    });
  };
  // Gallery pages: once the first rows are in, keep loading the rest a few at a
  // time in page order, so photos are already there when you scroll to them.
  var lazy = [].slice.call(document.querySelectorAll('.pg-item img[loading="lazy"]'));
  if (lazy.length && roomy) {
    whenIdle(function () {
      var next = function () {
        var im = lazy.shift();
        if (!im) return;
        if (im.complete) return next();
        im.addEventListener('load', next, { once: true });
        im.addEventListener('error', next, { once: true });
        im.loading = 'eager';
      };
      for (var n = 0; n < 4; n++) next();
    });
  }
  // Home page: warm up both gallery pages and their first photos in the background.
  if (document.querySelector('.homepage-logo') && roomy && window.fetch) {
    whenIdle(function () {
      ['/home-showcase', '/commercial-showcase'].forEach(function (url) {
        fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
          var re = /<img src="(\/assets\/[^"]+-thumb\.webp)"/g, m, n = 0;
          while ((m = re.exec(html)) && n++ < 16) new Image().src = m[1];
        }).catch(function () {});
      });
    });
  }

  // ---- Temporary photo-order editor: only with ?edit in the address ----
  if (/[?&]edit\b/.test(location.search) && document.querySelector('.pg-grid')) {
    var ed = document.createElement('script');
    ed.src = '/js/gallery-editor.js';
    document.body.appendChild(ed);
  }

  // ---- Pinned contact button: steps aside while the footer is on screen --
  var fab = document.querySelector('.contact-fab');
  // Phones text Andrew; computers and tablets opens an email. Without JS it still goes to /contact-us.
  if (fab) {
    var phone = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent);
    fab.href = phone ? 'sms:+15878326660'
      : 'mailto:andrew@makeachangehomes.ca?subject=' + encodeURIComponent('Construction Inquiry - Website');
  }
  var foot = document.querySelector('.footer-subscribe');
  if (fab && foot && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      fab.classList.toggle('is-away', entries[0].isIntersecting);
    }).observe(foot);
  }

  // ---- Testimonial slider -----------------------------------------------
  document.querySelectorAll('.w-slider').forEach(function (slider) {
    var mask = slider.querySelector('.w-slider-mask');
    var slides = mask ? Array.prototype.slice.call(mask.querySelectorAll(':scope > .w-slide')) : [];
    if (slides.length < 2) return;
    var left = slider.querySelector('.w-slider-arrow-left');
    var right = slider.querySelector('.w-slider-arrow-right');
    var dotsWrap = slider.querySelector('.w-slider-nav');
    var current = 0, dots = [], startX = null;

    slider.setAttribute('role', 'region');
    slider.setAttribute('aria-roledescription', 'carousel');
    slider.setAttribute('aria-label', 'Client testimonials');

    var go = function (i) {
      current = (i + slides.length) % slides.length;
      slides.forEach(function (s, n) {
        s.style.transform = 'translateX(' + (-100 * current) + '%)';
        s.setAttribute('aria-hidden', n === current ? 'false' : 'true');
        s.querySelectorAll('a,button').forEach(function (a) { a.tabIndex = n === current ? 0 : -1; });
      });
      dots.forEach(function (d, n) {
        d.classList.toggle('w-active', n === current);
        d.setAttribute('aria-pressed', n === current ? 'true' : 'false');
      });
    };

    slides.forEach(function (s, n) {
      s.setAttribute('role', 'group');
      s.setAttribute('aria-roledescription', 'slide');
      s.setAttribute('aria-label', (n + 1) + ' of ' + slides.length);
      if (dotsWrap) {
        var d = document.createElement('div');
        d.className = 'w-slider-dot';
        var gap = (parseInt(slider.getAttribute('data-nav-spacing'), 10) || 6) / 2;
        d.style.marginLeft = d.style.marginRight = gap + 'px';
        d.setAttribute('role', 'button');
        d.setAttribute('tabindex', '0');
        d.setAttribute('aria-label', 'Show testimonial ' + (n + 1));
        d.addEventListener('click', function () { go(n); });
        d.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(n); }
        });
        dotsWrap.appendChild(d);
        dots.push(d);
      }
    });

    [[left, -1, 'Previous testimonial'], [right, 1, 'Next testimonial']].forEach(function (a) {
      var el = a[0];
      if (!el) return;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', a[2]);
      el.addEventListener('click', function () { go(current + a[1]); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(current + a[1]); }
      });
    });

    mask.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    mask.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1));
    });

    go(0);
  });

  // ---- Contact form: send to Web3Forms ------------------------------------
  var form = document.getElementById('contact-form');
  if (form) {
    var wrapper = form.parentElement;
    var done = wrapper.querySelector('.w-form-done');
    var fail = wrapper.querySelector('.w-form-fail');
    var submit = form.querySelector('[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (fail) fail.style.display = 'none';
      var label = submit.value;
      submit.value = submit.getAttribute('data-wait') || 'Please wait...';
      submit.disabled = true;

      fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form)
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.success) throw new Error(data.message || 'Failed');
          form.style.display = 'none';
          if (done) done.style.display = 'block';
        })
        .catch(function () {
          if (fail) fail.style.display = 'block';
        })
        .finally(function () {
          submit.value = label;
          submit.disabled = false;
        });
    });
  }
})();
