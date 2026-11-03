// Keep the footer year current.
document.querySelectorAll('.js-year').forEach(function (el) {
  el.textContent = new Date().getFullYear();
});

// Contact form: send to Web3Forms and show the original success/error messages.
(function () {
  var form = document.getElementById('contact-form');
  if (!form) return;
  var wrapper = form.parentElement;
  var done = wrapper.querySelector('.w-form-done');
  var fail = wrapper.querySelector('.w-form-fail');
  var button = form.querySelector('[type="submit"]');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (fail) fail.style.display = 'none';
    var label = button.value;
    button.value = button.getAttribute('data-wait') || 'Please wait...';
    button.disabled = true;

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
        button.value = label;
        button.disabled = false;
      });
  });
})();
