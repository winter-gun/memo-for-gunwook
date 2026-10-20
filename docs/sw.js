'use strict';

// Only the application shell belongs in this cache. Memo contents stay in the
// page's local storage; this worker never reads them or caches arbitrary URLs.
const SCOPE_URL = new URL(self.registration.scope);
const CACHE_NAME = `memo-board-shell-v1:${SCOPE_URL.pathname}`;
const APP_MARKER = '<meta name="application-name" content="메모 한눈에">';
const SHELL = [
  ['./', 'html'],
  ['./manifest.webmanifest', 'manifest'],
  ['./app-icon-192.png', 'png'],
  ['./app-icon-512.png', 'png'],
  ['./apple-touch-icon.png', 'png']
].map(([path, kind]) => ({ url: new URL(path, SCOPE_URL).href, kind }));
const SHELL_BY_URL = new Map(SHELL.map(item => [item.url, item]));
const NAVIGATION_URLS = new Set([SCOPE_URL.href, new URL('./index.html', SCOPE_URL).href]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function hasTrustedScope() {
  // Browsers also enforce a secure context when registering a service worker.
  return SCOPE_URL.protocol === 'https:' && SCOPE_URL.origin === self.location.origin;
}

async function isShellResponse(response, item) {
  if (!response || !item || response.status !== 200 || response.redirected ||
      response.type === 'opaque' || response.type === 'opaqueredirect' ||
      response.type === 'error' || response.url !== item.url) {
    return false;
  }

  try {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (item.kind === 'html') {
      return contentType.includes('text/html') &&
        (await response.clone().text()).includes(APP_MARKER);
    }
    if (item.kind === 'manifest') {
      if (contentType.includes('text/html')) return false;
      const manifest = await response.clone().json();
      return manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest);
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  } catch (_) {
    return false;
  }
}

async function cachedShell(url) {
  try {
    const response = await (await caches.open(CACHE_NAME)).match(url);
    return await isShellResponse(response, SHELL_BY_URL.get(url)) ? response : undefined;
  } catch (_) {
    return undefined;
  }
}

async function cacheShell(url, response) {
  if (!await isShellResponse(response, SHELL_BY_URL.get(url))) return;
  try {
    await (await caches.open(CACHE_NAME)).put(url, response.clone());
  } catch (_) {
    // A storage/quota failure must not replace a successful network response.
  }
}

async function cacheReady() {
  if (!hasTrustedScope()) return false;
  const entries = await Promise.all(SHELL.map(item => cachedShell(item.url)));
  return entries.every(Boolean);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!hasTrustedScope()) throw new Error('The memo app requires a same-origin HTTPS scope.');

    // Validate every download before writing any. In particular, a sign-in page
    // returned as HTTP 200 is not a usable offline application shell.
    const downloads = await Promise.all(SHELL.map(async item => {
      const response = await fetch(item.url, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'manual'
      });
      if (!await isShellResponse(response, item)) {
        throw new Error('An application shell file is unavailable or requires sign-in.');
      }
      return { item, response };
    }));

    const cache = await caches.open(CACHE_NAME);
    for (const { item, response } of downloads) {
      await cache.put(item.url, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  // Do not delete another app's caches or any memo data.
  event.waitUntil(self.clients.claim());
});

async function navigationResponse(request) {
  let response;
  try {
    // Navigation requests keep their browser redirect policy. An auth redirect,
    // login page or HTTP error is returned unchanged, never replaced by a cache.
    response = await fetch(request);
  } catch (networkError) {
    // Managed hosts may redirect index.html to the scope root. Only the root is
    // precached; index.html is an offline alias, never a separately trusted page.
    const cached = await cachedShell(SCOPE_URL.href);
    if (cached) return cached;
    throw networkError;
  }
  if (request.url === SCOPE_URL.href) await cacheShell(request.url, response);
  return response;
}

async function assetResponse(request) {
  const cached = await cachedShell(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  await cacheShell(request.url, response);
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!hasTrustedScope() || request.method !== 'GET') return;

  // Exact URLs intentionally exclude query strings, sign-in routes, unrelated
  // pages and every external origin. Those requests follow normal browser rules.
  if (request.mode === 'navigate') {
    if (NAVIGATION_URLS.has(request.url)) event.respondWith(navigationResponse(request));
    return;
  }
  const item = SHELL_BY_URL.get(request.url);
  if (!item) return;
  if (item.kind !== 'html') event.respondWith(assetResponse(request));
});

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'MEMO_CACHE_STATUS' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    let ready = false;
    try {
      ready = await cacheReady();
    } catch (_) {
      // Keep the answer conservative if storage is unavailable.
    }
    port.postMessage({ ready });
  })());
});
