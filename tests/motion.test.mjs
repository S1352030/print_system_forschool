import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewTransitionRunner, waitForElementAnimations } from '../static/js/motion.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function transitionDocument() {
  const classes = new Set();
  const transitions = [];
  return {
    classes, transitions,
    documentElement: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } },
    startViewTransition(update) {
      const end = deferred();
      const updated = Promise.resolve().then(update);
      const transition = {
        ready: updated,
        finished: updated.then(() => end.promise),
        skipTransition: () => end.resolve(),
        complete: () => end.resolve(),
      };
      transitions.push(transition);
      return transition;
    },
  };
}

test('rapid tab/theme requests preserve every update and only the current transition owns its class', async () => {
  const doc = transitionDocument();
  const run = createViewTransitionRunner(doc, () => false);
  const updates = [];
  const first = run(() => updates.push('history'), 'tab-transition');
  await Promise.resolve();
  await Promise.resolve();
  const second = run(() => updates.push('dark'), 'theme-transition');
  const third = run(() => updates.push('upload'), 'tab-transition');
  await first;
  await second;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(updates, ['history', 'dark', 'upload']);
  assert.equal(doc.transitions.length, 2, 'the superseded middle request should not animate');
  assert.deepEqual([...doc.classes], ['tab-transition']);
  doc.transitions[1].complete();
  await third;
  assert.equal(doc.classes.size, 0);
});

test('reduced motion and unsupported browsers still apply updates without snapshots', async () => {
  for (const reduced of [true, false]) {
    const doc = transitionDocument();
    if (!reduced) delete doc.startViewTransition;
    const run = createViewTransitionRunner(doc, () => reduced);
    let updated = 0;
    await run(() => { updated++; }, 'theme-transition');
    assert.equal(updated, 1);
    assert.equal(doc.transitions.length, 0);
    assert.equal(doc.classes.size, 0);
  }
});

test('a rejected update cleans up and does not poison later interactions', async () => {
  const doc = transitionDocument();
  const run = createViewTransitionRunner(doc, () => false);
  await assert.rejects(run(() => { throw new Error('failed update'); }, 'theme-transition'), /failed update/);
  assert.equal(doc.classes.size, 0);
  const next = run(() => {}, 'tab-transition');
  await Promise.resolve();
  doc.transitions.at(-1).complete();
  await next;
  assert.equal(doc.classes.size, 0);
});

test('dialog waits for all actual animations, tolerates cancellation, and supports no-motion paths', async () => {
  const opacity = deferred();
  const transform = deferred();
  let closed = false;
  const waiting = waitForElementAnimations({ getAnimations: () => [
    { finished: opacity.promise }, { finished: transform.promise },
  ] }).then(() => { closed = true; });
  opacity.resolve();
  await Promise.resolve();
  assert.equal(closed, false);
  transform.reject(new Error('animation cancelled'));
  await waiting;
  assert.equal(closed, true);
  await waitForElementAnimations({ getAnimations: () => [] });
  await waitForElementAnimations({});
});
