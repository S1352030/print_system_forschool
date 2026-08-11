/**
 * 註冊 Service Worker，並只在「已受舊版 SW 控制」的頁面更新時重載一次。
 * 首次安裝時 controller 由 null 變成新 worker，不應重載首頁。
 */
export async function registerServiceWorker(options = {}) {
  const serviceWorker = options.serviceWorker === undefined
    ? globalThis.navigator?.serviceWorker
    : options.serviceWorker;
  if (!serviceWorker) return null;

  const reload = options.reload ?? (() => globalThis.location?.reload());
  const logger = options.logger ?? globalThis.console;
  const scriptUrl = options.scriptUrl ?? '/sw.js';
  let wasControlled = Boolean(serviceWorker.controller);
  let reloaded = false;

  serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled) {
      wasControlled = true;
      return;
    }
    if (reloaded) return;
    reloaded = true;
    logger?.info?.('[SW] Controller changed after an update; reloading once.');
    reload();
  });

  try {
    const registration = await serviceWorker.register(scriptUrl);
    logger?.info?.('[SW] Registered correctly:', registration.scope);
    return registration;
  } catch (error) {
    logger?.error?.('[SW] Registration failed:', error);
    return null;
  }
}
