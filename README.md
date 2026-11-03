# Make A Change Homes

Static copy of makeachangehomes.ca, mirrored from the old Webflow site and hosted on Cloudflare Pages.

## Pages

| URL | File |
| --- | --- |
| `/` | `index.html` |
| `/home-showcase` (Residential) | `home-showcase.html` |
| `/images-residential/rebuilt-homes` | `images-residential/rebuilt-homes.html` |
| `/images-residential/basements` | `images-residential/basements.html` |
| `/commercial-showcase` (Commercial) | `commercial-showcase.html` |
| `/images-commercial/office` | `images-commercial/office.html` |
| `/images-commercial/restaurants` | `images-commercial/restaurants.html` |
| `/images-commercial/healthcare` | `images-commercial/healthcare.html` |
| `/images-commercial/education` | `images-commercial/education.html` |
| `/about-us` | `about-us.html` |
| `/contact-us` | `contact-us.html` |
| 404 | `404.html` |

Images and the original Webflow stylesheet live in `assets/`. The site no longer loads Webflow's runtime, jQuery or any third-party scripts:

- `css/site.css`: everything added on top of the Webflow stylesheet (self-hosted fonts, phone menu, hover effects, lightbox, gallery headings, contact layout).
- `js/site.js`: phone menu, hide-on-scroll navigation, photo lightbox, testimonial slider, footer year, and the contact form.
- `fonts/`: Droid Sans and Oswald, self-hosted.
- `_headers`: tells Cloudflare to let browsers cache `assets/` and `fonts/` for a year.
- `sitemap.xml` and `robots.txt`: for search engines. Add any new page to `sitemap.xml`.

## Adding photos

Put the JPG/PNG in `assets/`, reference it from the page, then run `python3 scripts/optimize_images.py`. It makes a WebP copy (and a small `-thumb.webp` for gallery tiles) and points the pages at it. Because assets are cached for a year, give a changed photo a new file name rather than overwriting an old one.

## Contact form

The form posts to [Web3Forms](https://web3forms.com) (free). The access key in `contact-us.html` belongs to the Web3Forms account for the business email; it is meant to be public.

## Deploying

Cloudflare Pages, connected to this repo: no build command, output directory `/`. Every push to `main` deploys.

## Editing

Edit the HTML directly. To preview locally: `python3 scripts/serve.py .` and open http://127.0.0.1:8765.

`scripts/mirror.py` and `scripts/finish.py` are the one-off scripts used to copy the site from Webflow; they are kept for reference.
