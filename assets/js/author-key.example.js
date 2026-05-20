// Template for assets/js/author-key.js — the real file is gitignored.
//
// In production, this file is generated at deploy time by a Netlify build
// step that reads OMEKA_AUTHOR_KEY_ID and OMEKA_AUTHOR_KEY_CRED from the
// site's environment variables and writes them here. The Omeka API key
// belongs to the iowa-letters-author user (Researcher/Author role) created
// by setup-author-user.mjs in the omeka-lab repo. The role's blast radius is
// bounded to creating new items.
//
// For local development, generate the key with:
//   cd omeka-lab && node setup-author-user.mjs
// then copy the KEY_ID + KEY_CRED into a local author-key.js (gitignored).

window.OMEKA_AUTHOR_KEY = {
  // 32-char base62 string, the "key_identity" field shown once on key creation
  KEY_ID:   "REPLACE_WITH_KEY_IDENTITY",
  // 32-char base62 string, the "key_credential" field shown once on key creation
  KEY_CRED: "REPLACE_WITH_KEY_CREDENTIAL",

  // The Omeka REST API root. For local development this points at the
  // local Docker container; in production it points at the public ngrok or
  // institutional hostname.
  API_BASE: "https://iowa.dev.01.ngrok.dev/api",

  // The Resource Template id ("Civil War Letter") and Item Set id ("Iowa
  // Letters, 1862-1865") that new items are attached to. These come from
  // omeka-lab/populate.py and are stable across re-runs of that script.
  RESOURCE_TEMPLATE_ID: 2,
  ITEM_SET_ID: 1,

  // Dublin Core property ids in Omeka S 4.1.1. Stable.
  PROPS: {
    title:       1,
    creator:     2,
    subject:     3,
    description: 4,
    date:        7,
    type:        8,
    format:      9,
    source:     11,
    language:   12,
    rights:     15,
    spatial:    40,
    temporal:   41,
  },
};
