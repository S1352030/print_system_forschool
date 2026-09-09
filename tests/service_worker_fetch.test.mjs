import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://print.test';
const appCache = 'print-system-app-20260810';
const pdfCache = 'print-system-pdf-engine-5.7.284';
const asset = '/static/builds/test/assets/index-123.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function basicResponse(body = 'fresh', options = {}) {
  const response = new Response(body, options);
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

function harness(options = {}) {
  const listeners = new Map();
  const stores = new Map([[appCache, new Map()], [pdfCache, new Map()]]);
  const state = { fetches: [], puts: 0, enables: 0, claims: 0, skips: 0, deletedCaches: [] };
  const caches = {
    async open(name) {
      if (options.openError) throw new Error('storage unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) {
          if (options.matchError) throw new Error('read failed');
          return store.get(request.url)?.clone();
        },
        async put(request, response) {
          state.puts += 1;
          options.putStarted?.resolve();
          if (options.putGate) await options.putGate.promise;
          if (options.putError) throw new Error('quota exceeded');
          // Cache.put consumes the complete stream, unlike returning the response.
          const bytes = await response.arrayBuffer();
          store.set(request.url, new Response(bytes, { status: response.status, headers: response.headers }));
        },
        async keys() { return [...store.keys()].map((url) => ({ url })); },
        async delete(request) {
          if (options.trimError) throw new Error('delete failed');
          return store.delete(request.url);
        },
      };
    },
    async keys() {
      if (options.openError) throw new Error('storage unavailable');
      return [...stores.keys()];
    },
    async delete(name) { state.deletedCaches.push(name); return stores.delete(name); },
  };
  const worker = {
    location: { origin },
    registration: options.noPreload ? {} : {
      navigationPreload: { async enable() {
        state.enables += 1;
        if (options.enableError) throw new Error('preload unavailable');
      } },
    },
    clients: { async claim() { state.claims += 1; } },
    async skipWaiting() { state.skips += 1; },
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  vm.runInNewContext(source, {
    self: worker, caches, URL, Response, Promise,
    fetch: async (request) => {
      state.fetches.push(request.url);
      return options.fetch ? options.fetch(request) : basicResponse();
    },
  });
  function dispatch(type, properties = {}) {
    const lifetimes = [];
    let response;
    let dispatching = true;
    listeners.get(type)({ ...properties,
      respondWith(value) { response = value; },
      waitUntil(value) {
        assert.ok(dispatching, 'lifetime must be registered synchronously');
        lifetimes.push(value);
      },
    });
    dispatching = false;
    return { response, done: () => Promise.all(lifetimes), lifetimes };
  }
  function request(pathname = '/', overrides = {}) {
    return dispatch('fetch', {
      request: { url: new URL(pathname, origin).href, method: 'GET', headers: new Headers(),
        mode: pathname === '/' ? 'navigate' : 'cors', ...overrides.request },
      preloadResponse: overrides.preloadResponse,
    });
  }
  return { state, stores, request, dispatch };
}

test('navigation preload enables before claim; active caches survive', async () => {
  const h = harness();
  h.stores.set('print-system-app-old', new Map());
  await h.dispatch('install').done();
  await h.dispatch('activate').done();
  assert.equal(h.state.enables, 1);
  assert.equal(h.state.claims, 1);
  assert.equal(h.state.skips, 1);
  assert.deepEqual(h.state.deletedCaches, ['print-system-app-old']);
  assert.ok(h.stores.has(appCache) && h.stores.has(pdfCache));
});

for (const options of [{ noPreload: true }, { enableError: true }, { openError: true }]) {
  test(`worker activates with unavailable optional features: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    await h.dispatch('install').done();
    await h.dispatch('activate').done();
    assert.equal(h.state.skips, 1);
    assert.equal(h.state.claims, 1);
  });
}

test('successful navigation preload is returned without another fetch', async () => {
  const h = harness();
  const event = h.request('/', { preloadResponse: Promise.resolve(basicResponse('preloaded')) });
  assert.equal(await (await event.response).text(), 'preloaded');
  await event.done();
  assert.equal(h.state.fetches.length, 0);
  assert.equal(await h.stores.get(appCache).get(`${origin}/`).text(), 'preloaded');
});

for (const scenario of ['unsupported', 'rejected']) {
  test(`navigation preload ${scenario} falls back to one normal fetch`, async () => {
    const h = harness();
    const event = h.request('/', { preloadResponse: scenario === 'rejected'
      ? Promise.reject(new Error('preload failed')) : undefined });
    assert.equal(await (await event.response).text(), 'fresh');
    await event.done();
    assert.equal(h.state.fetches.length, 1);
  });
}

for (const pathname of ['/', asset]) {
  test(`${pathname}: slow cache write does not hold the response or lose background work`, async () => {
    const putGate = deferred();
    const putStarted = deferred();
    const h = harness({ putGate, putStarted });
    const event = h.request(pathname);
    await putStarted.promise;
    let lifetimeFinished = false;
    const lifetime = event.done().then(() => { lifetimeFinished = true; });
    // A race against a task turn verifies ordering without a speed threshold.
    const response = await Promise.race([event.response, new Promise((resolve) => setImmediate(() => resolve(null)))]);
    try {
      assert.ok(response, 'response must be available before releasing Cache.put');
      assert.equal(await response.text(), 'fresh');
      assert.equal(lifetimeFinished, false);
    } finally {
      putGate.resolve();
      await lifetime;
    }
    assert.equal(h.state.puts, 1);
  });

  for (const error of ['openError', 'matchError', 'putError', 'trimError']) {
    test(`${pathname}: ${error} preserves a successful network response`, async () => {
      const h = harness({ [error]: true });
      for (let index = 0; index < 61; index += 1) {
        h.stores.get(appCache).set(`${origin}/old-${index}`, basicResponse('old'));
      }
      const event = h.request(pathname);
      assert.equal(await (await event.response).text(), 'fresh');
      await event.done();
      assert.equal(h.state.fetches.length, 1);
    });
  }
}

test('HTML stream reaches the page before the entire body has downloaded', async () => {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; controller.enqueue(new TextEncoder().encode('first')); } });
  const h = harness({ fetch: async () => basicResponse(body) });
  const event = h.request();
  const response = await event.response;
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  controller.enqueue(new TextEncoder().encode('last'));
  controller.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'last');
  await event.done();
  assert.equal(await h.stores.get(appCache).get(`${origin}/`).text(), 'firstlast');
});

test('network-first returns fresh HTML, then offline returns the cached page', async () => {
  let offline = false;
  const h = harness({ fetch: async () => { if (offline) throw new Error('offline'); return basicResponse('new'); } });
  h.stores.get(appCache).set(`${origin}/`, basicResponse('old'));
  const online = h.request();
  assert.equal(await (await online.response).text(), 'new');
  await online.done();
  offline = true;
  const cached = h.request();
  assert.equal(await (await cached.response).text(), 'new');
  await cached.done();
});

for (const openError of [false, true]) {
  test(`offline without usable cache gives 503 (storage unavailable=${openError})`, async () => {
    const h = harness({ openError, fetch: async () => { throw new Error('offline'); } });
    for (const pathname of ['/', asset]) {
      const event = h.request(pathname);
      assert.equal((await event.response).status, 503);
      await event.done();
    }
  });
}

for (const [pathname, cacheName] of [[asset, appCache], ['/static/pdfjs/5.7.284/build/pdf.min.mjs', pdfCache]]) {
  test(`${cacheName} serves existing assets without downloads or rewrites`, async () => {
    const h = harness();
    h.stores.get(cacheName).set(`${origin}${pathname}`, basicResponse('cached'));
    const event = h.request(pathname);
    assert.equal(await (await event.response).text(), 'cached');
    await event.done();
    assert.equal(h.state.fetches.length, 0);
    assert.equal(h.state.puts, 0);
  });
}

test('sensitive requests and versioned assets with query strings bypass the worker', () => {
  const h = harness();
  for (const pathname of ['/api/announcements', '/api/orders', '/api/orders/1/file/preview', '/admin', '/admin.css', '/health', '/sw.js', '/document.pdf', 'https://other.test/script.js', `${asset}?v=1`, '/static/pdfjs/5.7.284/build/pdf.min.mjs?v=1']) {
    assert.equal(h.request(pathname).response, undefined, pathname);
  }
  assert.equal(h.request('/', { request: { method: 'POST' } }).response, undefined);
  assert.equal(h.request(asset, { request: { headers: new Headers({ Authorization: 'Basic example' }) } }).response, undefined);
  assert.equal(h.state.puts, 0);
});

for (const [status, control] of [[200, 'private'], [200, 'no-store'], [404, 'public'], [500, 'public']]) {
  test(`response ${status} ${control} is delivered without cache writes`, async () => {
    const h = harness({ fetch: async () => basicResponse('body', { status, headers: { 'Cache-Control': control } }) });
    const event = h.request();
    assert.equal((await event.response).status, status);
    await event.done();
    assert.equal(h.state.puts, 0);
  });
}

test('an HTTP error preload is not retried as a second download', async () => {
  const h = harness();
  const event = h.request('/', { preloadResponse: Promise.resolve(basicResponse('error', { status: 503 })) });
  assert.equal((await event.response).status, 503);
  await event.done();
  assert.equal(h.state.fetches.length, 0);
  assert.equal(h.state.puts, 0);
});
