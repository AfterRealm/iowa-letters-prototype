// Server-side proxy for the Iowa Letters authoring form.
//
// The browser POSTs to /.netlify/functions/post-letter with a passphrase
// and a Dublin Core item payload; this function validates the passphrase
// against an environment variable, then forwards the payload to Omeka
// using server-side credentials that the browser never sees.
//
// This replaces the previous architecture in which the Omeka Author key
// was materialized into assets/js/author-key.js at build time and shipped
// to the browser. That earlier posture relied on the Author role being
// blast-radius-bounded; the proxy below removes the exposure entirely.
//
// Required Netlify environment variables:
//   IOWA_LETTERS_PASSPHRASE     The shared secret from the cover letter
//   OMEKA_AUTHOR_KEY_ID         32-char base62 key identity
//   OMEKA_AUTHOR_KEY_CRED       32-char base62 key credential
//   OMEKA_API_BASE              e.g. https://iowa.dev.01.ngrok.dev/api
exports.handler = async function (event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const expected = process.env.IOWA_LETTERS_PASSPHRASE || 'IowaLetters';
  if (!body.passphrase || body.passphrase !== expected) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid or missing passphrase.' }),
    };
  }

  const KEY_ID = process.env.OMEKA_AUTHOR_KEY_ID;
  const KEY_CRED = process.env.OMEKA_AUTHOR_KEY_CRED;
  const API_BASE = process.env.OMEKA_API_BASE || 'https://iowa.dev.01.ngrok.dev/api';
  if (!KEY_ID || !KEY_CRED) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Server credentials not configured. Set OMEKA_AUTHOR_KEY_ID and OMEKA_AUTHOR_KEY_CRED in Netlify env vars.',
      }),
    };
  }

  // Strip the passphrase before forwarding — Omeka has no use for it.
  const { passphrase, ...payload } = body;

  const url = `${API_BASE}/items?key_identity=${encodeURIComponent(KEY_ID)}&key_credential=${encodeURIComponent(KEY_CRED)}`;
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Could not reach Omeka. The backend may be offline (the local Docker stack is exposed via ngrok and is reachable only while the host machine is on).',
        detail: e.message,
      }),
    };
  }

  const text = await r.text();
  return {
    statusCode: r.status,
    headers: { ...cors, 'Content-Type': r.headers.get('content-type') || 'application/json' },
    body: text,
  };
};
