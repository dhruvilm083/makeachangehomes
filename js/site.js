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

  // Hide the bar while scrolling down, bring it back when scrolling up.
  if (nav) {
    var lastY = window.scrollY;
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      if (Math.abs(y - lastY) < 4) return;
      var down = y > lastY && y > 10;
      if (down && button && button.classList.contains('w--open')) down = false;
      nav.classList.toggle('nav-hidden', down);
      lastY = y;
    }, { passive: true });
    nav.addEventListener('focusin', function () { nav.classList.remove('nav-hidden'); });
  }

  // ---- Photo lightbox ---------------------------------------------------
  var thumbs = Array.prototype.slice.call(document.querySelectorAll('.skate-img[href]'));
  if (thumbs.length) {
    var box, img, count, index = 0, lastFocus = null, touchX = null;

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
    var show = function (i) {
      index = (i + thumbs.length) % thumbs.length;
      img.src = thumbs[index].getAttribute('href');
      img.alt = thumbs[index].getAttribute('alt') || '';
      count.textContent = (index + 1) + ' of ' + thumbs.length;
      var next = new Image();
      next.src = thumbs[(index + 1) % thumbs.length].getAttribute('href');
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
    var open = function (i) {
      if (!box) build();
      lastFocus = document.activeElement;
      show(i);
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

    thumbs.forEach(function (t, i) {
      t.setAttribute('role', 'button');
      t.setAttribute('tabindex', '0');
      t.addEventListener('click', function (e) { e.preventDefault(); open(i); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); }
      });
    });
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
