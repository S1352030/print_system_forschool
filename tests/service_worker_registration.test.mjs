import assert from 'node:assert/strict';
import test from 'node:test';

import { registerServiceWorker } from '../static/js/service-worker-registration.js';

class FakeServiceWorkerContainer {
  constructor(controller = null) {
    this.controller = controller;
    this.listeners = new Map();
    this.registeredUrls = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async register(url) {
    this.registeredUrls.push(url);
    return { scope: '/' };
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const quietLogger = { info() {}, error() {} };

test('首次接管不重載，同頁後續更新只重載一次', async () => {
  const serviceWorker = new FakeServiceWorkerContainer(null);
  let reloadCount = 0;

  const registration = await registerServiceWorker({
    serviceWorker,
    reload: () => { reloadCount += 1; },
    logger: quietLogger,
  });
  serviceWorker.controller = { state: 'activated' };
  serviceWorker.dispatch('controllerchange');

  assert.equal(registration.scope, '/');
  assert.deepEqual(serviceWorker.registeredUrls, ['/sw.js']);
  assert.equal(reloadCount, 0);

  serviceWorker.dispatch('controllerchange');
  serviceWorker.dispatch('controllerchange');
  assert.equal(reloadCount, 1);
});

test('已有 controller 的後續更新最多重載一次', async () => {
  const serviceWorker = new FakeServiceWorkerContainer({ state: 'activated' });
  let reloadCount = 0;

  await registerServiceWorker({
    serviceWorker,
    reload: () => { reloadCount += 1; },
    logger: quietLogger,
  });
  serviceWorker.dispatch('controllerchange');
  serviceWorker.dispatch('controllerchange');

  assert.equal(reloadCount, 1);
});

test('不支援 Service Worker 時安全略過', async () => {
  const registration = await registerServiceWorker({
    serviceWorker: null,
    logger: quietLogger,
  });
  assert.equal(registration, null);
});
