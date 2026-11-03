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

Images, CSS and Webflow's runtime JS live in `assets/`. `js/site.js` keeps the footer year current and sends the contact form.

## Contact form

The form posts to [Web3Forms](https://web3forms.com) (free). Replace `YOUR_WEB3FORMS_ACCESS_KEY` in `contact-us.html` with the access key for andrew@makeachangehomes.ca. The key is meant to be public.

## Deploying

Cloudflare Pages, connected to this repo: no build command, output directory `/`. Every push to `main` deploys.

## Editing

Edit the HTML directly. To preview locally: `python3 scripts/serve.py .` and open http://127.0.0.1:8765.

`scripts/mirror.py` and `scripts/finish.py` are the one-off scripts used to copy the site from Webflow; they are kept for reference.
