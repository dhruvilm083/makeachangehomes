"""Post-process the mirrored Webflow pages for static hosting on Cloudflare Pages."""
import os, re, sys

ROOT = sys.argv[1]
WEB3FORMS_KEY = "YOUR_WEB3FORMS_ACCESS_KEY"

FOOTER_OLD = re.compile(r'(<div class="footer-copyright">)© 2024 Make A Change Homes\. All rights reserved\. Proudly created by dmtechnology\.ca\s*(</div>)')
FOOTER_NEW = (r'\1© <span class="js-year">2026</span> Make A Change Homes. All rights reserved. '
              r'Made with <span role="img" aria-label="love">🧡</span> by '
              r'<a href="https://daedalus.productions" target="_blank" rel="noopener" class="footer-credit">daedalus</a>\2')

HEAD_EXTRA = """<style>
.w-webflow-badge{display:none!important}
.footer-credit{color:inherit;text-decoration:underline}
</style>"""

BODY_EXTRA = """<script src="/js/site.js" defer></script>"""

FORM_OPEN = re.compile(r'<form id="wf-form-Email-Form"[^>]*>')
FORM_NEW = ('<form id="contact-form" name="contact-form" action="https://api.web3forms.com/submit" method="POST" class="form">'
            f'<input type="hidden" name="access_key" value="{WEB3FORMS_KEY}"/>'
            '<input type="hidden" name="subject" value="Construction Inquiry - Website"/>'
            '<input type="hidden" name="from_name" value="makeachangehomes.ca"/>'
            '<input type="checkbox" name="botcheck" class="hidden-botcheck" style="display:none" tabindex="-1" autocomplete="off"/>')

for dirpath, _, files in os.walk(ROOT):
    for fn in files:
        if not fn.endswith(".html"):
            continue
        p = os.path.join(dirpath, fn)
        h = open(p, encoding="utf-8").read()
        h = h.replace('data-wf-domain="make-a-change-homes.webflow.io"', 'data-wf-domain="www.makeachangehomes.ca"')
        h = h.replace(' data-wf-status="1"', "")
        h = h.replace('<link href="https://cdn.prod.website-files.com" rel="preconnect" crossorigin="anonymous"/>', "")
        h = re.sub(r'\s(integrity|crossorigin)="[^"]*"', "", h)
        h, n = FOOTER_OLD.subn(FOOTER_NEW, h)
        if fn != "404.html" and n != 1:
            print("footer not replaced in", p)
        h = h.replace('<a href="#" class="link">+1 (587) 832-6660</a>', '<a href="tel:+15878326660" class="link">+1 (587) 832-6660</a>')
        if FORM_OPEN.search(h):
            h = FORM_OPEN.sub(FORM_NEW, h)
            h = h.replace('class="form-wrapper w-form"', 'class="form-wrapper"')
        h = h.replace("</head>", HEAD_EXTRA + "</head>", 1)
        h = h.replace("</body>", BODY_EXTRA + "</body>", 1)
        open(p, "w", encoding="utf-8").write(h)
        print("done", p)
