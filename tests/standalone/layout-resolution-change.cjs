const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {buildResolutionSave, needsConfirm} = require(
  '../../ui/src/layout-editor/device-resolution.js');

const layout = {
  width: '1920',
  height: 1080,
  backgroundColor: '#000000',
  backgroundImage: 4,
  backgroundzIndex: 0,
  autoApplyTransitions: '1',
};
const changed = buildResolutionSave(layout, {
  contextWidth: 1080, contextHeight: 1920,
});
assert.deepEqual(changed.previous, {
  backgroundColor: '#000000',
  backgroundImageId: 4,
  backgroundzIndex: 0,
  autoApplyTransitions: 1,
  contextWidth: 1920,
  contextHeight: 1080,
});
assert.equal(changed.next.contextWidth, 1080);
assert.equal(changed.next.contextHeight, 1920);
assert.equal(changed.next.backgroundImageId, 4);
assert.equal(Object.hasOwn(changed.next, 'resolutionId'), false);
assert.equal(buildResolutionSave(layout, {
  contextWidth: 1920, contextHeight: 1080,
}), null);
assert.equal(buildResolutionSave(layout, {}), null);
assert.equal(buildResolutionSave(
  {...layout, autoApplyTransitions: 0},
  {contextWidth: 100, contextHeight: 200},
).next.autoApplyTransitions, 0);
assert.equal(needsConfirm({isEmpty: () => true}), false);
assert.equal(needsConfirm({isEmpty: () => false}), true);
assert.equal(needsConfirm({isEmpty: () => {
  throw new Error('missing canvas');
}}), true);

const source = fs.readFileSync(path.join(__dirname,
  '../../web/theme/default/js/device-scope.js'), 'utf8');
const context = {events: [], clickHandler: null, ready: null};
const sandboxDocument = {
  getElementById: () => ({dataset: {storageKey: 'device-scope-test'}}),
};
function sandbox$(target) {
  if (typeof target === 'function') {
    context.ready = target;
    return;
  }
  if (target === sandboxDocument) {
    return {trigger(name, args) {
      context.events.push({name, args});
    }};
  }
  if (typeof target === 'string') return {appendTo() {}};
  return {
    attr() {},
    on(event, selector, handler) {
      if (event === 'click') context.clickHandler = handler;
    },
    find() {
      return {each() {}, remove() {}};
    },
  };
}
sandbox$.getJSON = function() {
  const promise = {
    done(callback) {
      callback({
        recordsTotal: 1,
        data: [{
          displayId: 101, display: 'Lobby', scopeResolution: '1080 × 1920',
        }],
      });
      return promise;
    },
    fail() {
      return promise;
    },
  };
  return promise;
};
vm.runInNewContext(source, {
  jQuery: sandbox$,
  document: sandboxDocument,
  sessionStorage: {getItem: () => '', setItem() {}},
  window: {},
}, {filename: 'device-scope.js'});
context.ready();
const seen = () => JSON.parse(JSON.stringify(context.events));
assert.deepEqual(seen(), [
  {name: 'deviceScope:change', args: ['', false]},
]);
context.clickHandler({currentTarget: {dataset: {displayId: '101'}}});
context.clickHandler({currentTarget: {dataset: {displayId: '101'}}});
assert.deepEqual(seen(), [
  {name: 'deviceScope:change', args: ['', false]},
  {name: 'deviceScope:change', args: ['101', true]},
]);

console.log('PASS: layout resolution change');
