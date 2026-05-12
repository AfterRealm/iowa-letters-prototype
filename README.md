# Iowa Letters · A Civil War Digital Edition (Prototype)

A small prototype digital edition of letters home from Iowa volunteers serving in the American Civil War.

Built by **Meredith Sealy** as a portfolio piece for the **Web Application Developer (Digital Scholarship & Publishing Support)** role at University of Iowa Libraries Information Technology (LIT), May 2026.

## Live URLs

- **The prototype site:** https://iowa-letters.netlify.app
- **Live Omeka S 4.1.1 backend:** https://iowa.dev.01.ngrok.dev/s/iowa-letters
- **Omeka backend Docker stack:** https://github.com/AfterRealm/iowa-omeka-lab

## What this is

A demonstration of how I would partner with the Digital Scholarship and Publishing Studio (DSPS) Research Manager and the LIT Application Development lead to deliver a faculty-led digital edition project. The medium is the message: the site itself is the prototype, and it is paired with a real Omeka S 4.1.1 backend running the same six items in a real Resource Template.

## What this is not

A finished publication. Transcriptions are fabricated for the portfolio piece. The metadata structure, accessibility, IIIF-readiness, and architecture decisions are real; the scholarly content is not.

## Stack

- **HTML5, CSS3, vanilla JavaScript.** No build step in the prototype phase, for maximum portability.
- **Dublin Core Terms (DCMI)** for descriptive metadata vocabulary.
- **IIIF Presentation API 3.0** for image delivery readiness (manifests are placeholders in this prototype).
- **WCAG 2.2 AA** accessibility target, audited end-to-end with [Curb Cut](https://github.com/AfterRealm) (axe-core). 100/100 across all pages.

## Production version

A production version would be rebuilt on **Astro 5 + Bootstrap 5** to match LIT's current pattern on newer digital edition projects, and would consume the [Omeka S 4.1.1 backend](https://github.com/AfterRealm/iowa-omeka-lab) directly via its JSON-LD API. The data shape in `data/items.json` is intentionally aligned with Omeka S's response format so that the migration is a one-line change in `assets/js/site.js`.

## Structure

```
iowa-demo/
├── index.html                       # Landing page
├── items.html                       # Searchable item index
├── item.html                        # Item detail (loads by ?id= query param)
├── methodology.html                 # Standards, decisions, trade-offs
├── about-this-build.html            # The cover letter, in long form
├── data/
│   └── items.json                   # Omeka S-shaped JSON-LD data
├── assets/
│   ├── css/site.css                 # Custom stylesheet
│   ├── js/site.js                   # Index + detail rendering, search/filter
│   └── img/
│       ├── manuscript-placeholder.svg
│       └── omeka-screenshots/       # Real Omeka S 4.1.1 admin + public screenshots
└── README.md
```

## Running locally

```bash
cd iowa-demo
python -m http.server 8765
# Open http://localhost:8765
```

No build step. No dependencies.

## Contact

Meredith Sealy
meredithsealycasa@gmail.com
[Portfolio](https://meredithsealyportfolio.netlify.app) · [GitHub](https://github.com/AfterRealm)
