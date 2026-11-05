# Make A Change Homes

Static copy of makeachangehomes.ca, mirrored from the old Webflow site and hosted on Cloudflare Pages.

## Pages

| URL | File |
| --- | --- |
| `/` | `index.html` |
| `/home-showcase` (Residential, all residential projects) | `home-showcase.html` |
| `/commercial-showcase` (Commercial, all commercial projects) | `commercial-showcase.html` |
| `/about-us` | `about-us.html` |
| `/contact-us` | `contact-us.html` |
| 404 | `404.html` |

Images and the original Webflow stylesheet live in `assets/`. The site no longer loads Webflow's runtime, jQuery or any third-party scripts:

- `css/site.css`: everything added on top of the Webflow stylesheet (self-hosted fonts, phone menu, hover effects, lightbox, gallery headings, contact layout).
- `js/site.js`: phone menu, hide-on-scroll navigation, photo lightbox, testimonial slider, footer year, and the contact form.
- `fonts/`: Droid Sans and Oswald, self-hosted.
- `_headers`: tells Cloudflare to let browsers cache `assets/` and `fonts/` for a year.
- `sitemap.xml` and `robots.txt`: for search engines. Add any new page to `sitemap.xml`.

## Project galleries

Since the photo portal (below) went in, gallery photos are managed there. The steps in this section are how the galleries were built before it, and how the portal's starting projects were made.

The Commercial and Residential pages each show a heading, a short intro, and one grid of every photo (4 across on desktop), with a thin line between projects. The lightbox pages through every photo on the page. Each project line keeps its id, so the old category pages under `/images-commercial/` and `/images-residential/` still redirect to the right spot (`_redirects`).

To add a project:

1. `python3 scripts/add_project_photos.py "<folder of photos>" <project-slug>` makes `assets/<slug>-NN.webp` and `-thumb.webp` files.
2. Add the project (id, name, type, photos) to `scripts/galleries.json`, in the order it should appear. The page heading and intro text live in the same file.
3. `python3 scripts/build_galleries.py` rewrites the galleries on both pages.

## Photo portal (hidden)

`https://www.makeachangehomes.ca/portal/` is a login page that is not linked from the site. One page, two passwords:

- **Uploader password**: opens `/portal/upload`, a simple page to send any number of files of any type (JPG, PNG, WebP, HEIC, DNG, videos...), with an upload history grouped by day.
- **Admin password**: opens `/portal/admin`, which shows every upload not yet in a project. Select photos (click, Ctrl/Cmd+click, Shift+click, arrow keys, Ctrl+A), press **Group into project**, pick Residential or Commercial and a name. The project column on the right lists every project on the site; inside a project you can reorder (drag, or Alt+arrow keys), trash, move, rename or delete. Undo/Redo cover every change. Changes autosave as a draft; **Push to website** publishes them to the Residential and Commercial pages.

How it works:

- `worker/index.js` is a Cloudflare Worker (config in `wrangler.jsonc`). It only runs for `/portal/*`, `/api/*`, `/media/*` and the two gallery pages; every other page is a plain static file as before.
- Files live in the R2 bucket `mach-photos`: originals untouched under `orig/`, plus a large WebP (`web/`) and a grid thumbnail (`thumb/`) that the browser makes while uploading. DNG and other raw files use the JPEG preview stored inside them; HEIC is decoded in the browser.
- Passwords are the Worker secrets `UPLOAD_PASSWORD` and `ADMIN_PASSWORD`, checked on the server. Changing either one logs everybody out.
- After the first Push, the gallery pages are filled from `state/published.json` in the bucket, and **the portal is the source of truth for the gallery photos**. `scripts/galleries.json` only seeds the portal the first time it opens; editing it later does nothing to the live galleries. The page headings and intros still come from the HTML files.
- To preview locally: `npx wrangler dev --var UPLOAD_PASSWORD:x --var ADMIN_PASSWORD:y` (uses a local, empty copy of the bucket).

## Adding other photos

Put the JPG/PNG in `assets/`, reference it from the page, then run `python3 scripts/optimize_images.py`. It makes a WebP copy (and a small `-thumb.webp` for gallery tiles) and points the pages at it. Because assets are cached for a year, give a changed photo a new file name rather than overwriting an old one.

## Contact form

The form posts to [Web3Forms](https://web3forms.com) (free). The access key in `contact-us.html` belongs to the Web3Forms account for the business email; it is meant to be public.

## Deploying

A Cloudflare Worker with static assets ("makeachangehomes"), connected to this repo with Workers Builds. Every push to `main` deploys with `wrangler deploy`, using `wrangler.jsonc`. `.assetsignore` keeps the Worker code, scripts and this README off the public site.

## Editing

Edit the HTML directly. To preview locally: `python3 scripts/serve.py .` and open http://127.0.0.1:8765.

`scripts/mirror.py` and `scripts/finish.py` are the one-off scripts used to copy the site from Webflow; they are kept for reference.
