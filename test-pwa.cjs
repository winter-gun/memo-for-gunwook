'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const workerSource = fs.readFileSync(require.resolve('./src/pwa/sw.js'), 'utf8');
const scope = 'https://memo.example/app/';
const marker = '<meta name="application-name" content="메모 한눈에">';
const required = ['', 'manifest.webmanifest', 'app-icon-192.png', 'app-icon-512.png', 'apple-touch-icon.png'];

function withMetadata(response, metadata) {
  for (const [key, value] of Object.entries(metadata)) {
    Object.defineProperty(response, key, { value, configurable: true });
  }
  const clone = response.clone.bind(response);
  response.clone = () => withMetadata(clone(), metadata);
  return response;
}

function networkResponse(url, { body, status = 200, type = 'basic', redirected = false, contentType } = {}) {
  const path = new URL(url).pathname;
  if (body === undefined) {
    if (path.endsWith('.png')) body = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    else if (path.endsWith('.webmanifest')) body = JSON.stringify({ name: '메모 한눈에', start_url: './' });
    else body = `<!doctype html><html><head>${marker}</head><body>Application shell</body></html>`;
  }
  const inferredType = path.endsWith('.png') ? 'image/png' : path.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html; charset=utf-8';
  return withMetadata(new Response(body, { status, headers: { 'content-type': contentType || inferredType } }), { url, type, redirected });
}

function harness() {
  const listeners = new Map();
  const stores = new Map();
  const calls = [];
  let claimed = false;
  let skipped = false;
  let fetchImpl = async input => networkResponse(typeof input === 'string' ? input : input.url);
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async put(input, response) { entries.set(typeof input === 'string' ? input : input.url, response.clone()); },
        async match(input) { return entries.get(typeof input === 'string' ? input : input.url)?.clone(); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  vm.runInNewContext(workerSource, {
    self: {
      registration: { scope },
      location: { origin: new URL(scope).origin },
      addEventListener(type, fn) { listeners.set(type, fn); },
      async skipWaiting() { skipped = true; },
      clients: { async claim() { claimed = true; } }
    },
    caches, URL, Uint8Array,
    async fetch(input, init) {
      calls.push({ input, init });
      return fetchImpl(input, init);
    }
  });
  return {
    stores, calls, caches,
    get claimed() { return claimed; },
    get skipped() { return skipped; },
    setFetch(fn) { fetchImpl = fn; },
    async lifecycle(type) {
      let pending;
      listeners.get(type)({ waitUntil(promise) { pending = promise; } });
      await pending;
    },
    navigation(url = scope, overrides = {}) {
      let pending;
      listeners.get('fetch')({ request: { url, method: 'GET', mode: 'navigate', redirect: 'manual', ...overrides }, respondWith(promise) { pending = promise; } });
      return pending;
    },
    async ready() {
      let pending;
      let answer;
      listeners.get('message')({ data: { type: 'MEMO_CACHE_STATUS' }, ports: [{ postMessage(value) { answer = value; } }], waitUntil(promise) { pending = promise; } });
      await pending;
      return answer.ready;
    }
  };
}

test('설치는 검증된 셸 다섯 파일만 저장하고 상태를 보고하며 다른 앱 캐시를 보존한다', async () => {
  const app = harness();
  const unrelated = await app.caches.open('another-app-cache');
  await unrelated.put('https://memo.example/other', networkResponse('https://memo.example/other'));
  assert.equal(await app.ready(), false);
  await app.lifecycle('install');
  await app.lifecycle('activate');
  const ownCache = [...app.stores.entries()].find(([key]) => key.startsWith('memo-board-shell-v1'))[1];
  assert.deepEqual([...ownCache.keys()].sort(), required.map(path => new URL(path, scope).href).sort());
  assert.equal(app.stores.has('another-app-cache'), true);
  assert.equal(app.claimed, true);
  assert.equal(app.skipped, true);
  assert.equal(await app.ready(), true);
  assert.equal(app.calls.length, 5);
  assert.ok(app.calls.every(({ input }) => !input.endsWith('/index.html')));
  assert.ok(app.calls.every(({ init }) => init.credentials === 'same-origin' && init.redirect === 'manual'));
  ownCache.delete(new URL('apple-touch-icon.png', scope).href);
  assert.equal(await app.ready(), false);
});

test('HTTP 200 로그인 HTML은 설치 캐시에 저장하지 않는다', async () => {
  const app = harness();
  app.setFetch(async input => networkResponse(input, input === scope ? { body: '<html>Please sign in</html>' } : {}));
  await assert.rejects(app.lifecycle('install'), /unavailable or requires sign-in/);
  assert.ok([...app.stores.values()].every(entries => entries.size === 0));
  assert.equal(app.skipped, false);
  assert.equal(await app.ready(), false);
});

test('리다이렉트·다른 최종 URL·HTTP 오류와 위장한 아이콘은 설치를 거절한다', async () => {
  for (const makeBad of [
    () => networkResponse(scope, { redirected: true }),
    () => networkResponse('https://memo.example/sign-in'),
    () => networkResponse(scope, { status: 403 }),
    () => networkResponse(scope, { type: 'opaqueredirect' })
  ]) {
    const app = harness();
    app.setFetch(async input => input === scope ? makeBad() : networkResponse(input));
    await assert.rejects(app.lifecycle('install'));
    assert.ok([...app.stores.values()].every(entries => entries.size === 0));
  }
  const app = harness();
  app.setFetch(async input => networkResponse(input, input.endsWith('.png') ? { body: '<html>Sign in</html>', contentType: 'image/png' } : {}));
  await assert.rejects(app.lifecycle('install'));
  assert.equal(await app.ready(), false);
});

test('네트워크 실패일 때만 루트와 index 탐색에 검증된 루트 셸을 제공한다', async () => {
  const app = harness();
  await app.lifecycle('install');
  app.setFetch(async () => { throw new TypeError('Network unavailable'); });
  for (const path of ['', 'index.html']) {
    const response = await app.navigation(new URL(path, scope).href);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Application shell/);
  }
  const emptyApp = harness();
  emptyApp.setFetch(async () => { throw new TypeError('Network unavailable'); });
  await assert.rejects(emptyApp.navigation(), /Network unavailable/);
});

test('index 별칭의 정상 리다이렉트는 그대로 반환하고 오프라인 때만 루트 캐시를 사용한다', async () => {
  const app = harness();
  await app.lifecycle('install');
  const indexUrl = new URL('index.html', scope).href;
  const redirect = networkResponse(scope, { redirected: true, body: 'Canonical redirect response' });
  app.setFetch(async () => redirect);
  assert.equal(await app.navigation(indexUrl), redirect);

  const login = networkResponse(indexUrl, { body: '<html>Sign in</html>' });
  app.setFetch(async () => login);
  assert.equal(await app.navigation(indexUrl), login);

  app.setFetch(async () => { throw new TypeError('Network unavailable'); });
  assert.match(await (await app.navigation(indexUrl)).text(), /Application shell/);
  const ownCache = [...app.stores.entries()].find(([key]) => key.startsWith('memo-board-shell-v1'))[1];
  assert.equal(ownCache.has(indexUrl), false);
  assert.equal(await app.ready(), true);
});

test('인증 거절·리다이렉트·로그인 페이지를 기존 오프라인 셸로 바꾸지 않는다', async () => {
  const app = harness();
  await app.lifecycle('install');
  const replies = [
    networkResponse(scope, { status: 401, body: 'Unauthorized' }),
    networkResponse(scope, { status: 403, body: 'Forbidden' }),
    networkResponse(scope, { status: 503, body: 'Unavailable' }),
    networkResponse(scope, { body: '<html>Sign in</html>' }),
    networkResponse(scope, { type: 'opaqueredirect', body: 'Redirect' }),
    networkResponse('https://memo.example/sign-in', { redirected: true, body: 'Sign in' })
  ];
  for (const reply of replies) {
    app.setFetch(async () => reply);
    assert.equal(await app.navigation(), reply);
  }
  app.setFetch(async () => { throw new TypeError('Network unavailable'); });
  assert.match(await (await app.navigation()).text(), /Application shell/);
});

test('외부 URL·로그인 경로·쿼리·POST·목록 외 파일은 가로채지 않는다', async () => {
  const app = harness();
  for (const [url, overrides] of [
    ['https://other.example/app/', {}],
    ['https://memo.example/sign-in', {}],
    [scope + '?token=example', {}],
    [scope + 'private-memos.json', {}],
    [scope, { method: 'POST' }],
    [scope, { mode: 'cors' }],
    [scope + 'app-icon-192.png', {}]
  ]) {
    assert.equal(app.navigation(url, overrides), undefined);
  }
  assert.equal(app.calls.length, 0);
});

test('검증된 아이콘 캐시는 오프라인 요청에 쓰되 목록 밖 자산은 무시한다', async () => {
  const app = harness();
  await app.lifecycle('install');
  app.setFetch(async () => { throw new TypeError('Network unavailable'); });
  const response = await app.navigation(scope + 'app-icon-192.png', { mode: 'no-cors' });
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(app.navigation(scope + 'photo.png', { mode: 'no-cors' }), undefined);
});
