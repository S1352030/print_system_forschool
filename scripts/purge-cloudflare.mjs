const zoneId = (process.env.CF_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID)?.trim();
const apiToken = (process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN)?.trim();
const mode = (
  process.env.CF_PURGE_MODE
  || process.env.CLOUDFLARE_PURGE_MODE
  || 'tag'
).trim().toLowerCase();
const cacheTag = (
  process.env.CF_CACHE_TAG
  || process.env.CLOUDFLARE_CACHE_TAG
  || 'print-app'
).trim();
const publicOrigin = process.env.PUBLIC_ORIGIN?.trim();
const maxAttempts = 3;

if (!zoneId || !apiToken) {
  throw new Error('CF_ZONE_ID and CF_API_TOKEN are required.');
}
if (!/^[A-Za-z0-9_-]{1,64}$/.test(zoneId)) {
  throw new Error('CF_ZONE_ID has an invalid format.');
}

function preciseUrls(originText) {
  if (!originText) {
    throw new Error('PUBLIC_ORIGIN is required when CF_PURGE_MODE=urls.');
  }
  const origin = new URL(originText);
  if (
    origin.protocol !== 'https:'
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
    || (origin.pathname !== '/' && origin.pathname !== '')
  ) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query, or hash.');
  }
  return [`${origin.origin}/`, `${origin.origin}/sw.js`];
}

let payload;
if (mode === 'tag') {
  if (!/^[\x21-\x7E]{1,1024}$/.test(cacheTag) || cacheTag.includes(',')) {
    throw new Error('CF_CACHE_TAG must be one printable ASCII tag.');
  }
  payload = { tags: [cacheTag] };
} else if (mode === 'urls') {
  payload = { files: preciseUrls(publicOrigin) };
} else {
  throw new Error('CF_PURGE_MODE must be either tag or urls.');
}

const endpoint = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`;
let lastError;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const responseBody = await response.json().catch(() => null);

    if (response.ok && responseBody?.success === true) {
      console.log(
        mode === 'tag'
          ? `Cloudflare cache tag purged: ${cacheTag}`
          : `Cloudflare URLs purged: ${payload.files.join(', ')}`,
      );
      process.exit(0);
    }

    const detail = responseBody?.errors
      ?.map((error) => `${error.code ?? 'unknown'}:${error.message ?? 'unknown error'}`)
      .join('; ');
    lastError = new Error(
      `Cloudflare purge failed with HTTP ${response.status}${detail ? ` (${detail})` : ''}.`,
    );

    if (![408, 429, 500, 502, 503, 504].includes(response.status)) break;
  } catch (error) {
    lastError = error;
  }

  if (attempt < maxAttempts) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2 ** (attempt - 1) * 1_000));
  }
}

console.error(`Cloudflare purge pending: ${lastError?.message || 'unknown error'}`);
process.exit(1);
