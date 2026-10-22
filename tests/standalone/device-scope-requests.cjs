const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,
  '../../web/theme/default/js/device-scope-filters.js'), 'utf8');

function request(selected, enabled, table, original) {
  const handlers = {};
  const bar = {dataset: {storageKey: 'test', filterEnabled: String(enabled)}};
  const document = {getElementById: () => bar};
  // Only the synchronous request hook is under test; no page lifecycle runs.
  const $ = () => ({on: (event, callback) => { handlers[event] = callback; }});
  vm.runInNewContext(source, {
    jQuery: $, document, window: {deviceScope: {
      getDisplayId: () => selected,
      getDisplay: () => selected ? {displayId: selected, displayGroupId: 201} : null,
    }},
  });
  const data = {...original};
  handlers['preXhr.dt.deviceScope']?.({}, {nTable: {id: table}}, data);
  return data;
}

const filters = {resolutionId: 7, activeDisplayGroupId: 12, name: 'Lobby',
  tags: 'news', folderId: 9};
assert.deepEqual(request('101', true, 'layouts', filters), {
  name: 'Lobby', tags: 'news', folderId: 9, contextDisplayId: '101',
});
assert.deepEqual(request('', true, 'layouts', filters), filters);
assert.deepEqual(request('101', false, 'layouts', filters), filters);
assert.deepEqual(request('101', true, 'campaigns', filters), filters);
assert.deepEqual(request('101', true, 'displays', {displayId: 99, name: 'A'}),
  {displayId: '101', name: 'A'});
assert.deepEqual(request('', true, 'displays', {displayId: 99}), {displayId: 99});
assert.equal(filters.resolutionId, 7);
assert.equal(filters.activeDisplayGroupId, 12);
const schedule = {'displayGroupIds[]': [7], displayGroupIds: [8],
  displaySpecificGroupIds: [9], 'displaySpecificGroupIds[]': [10],
  showAll: 1, name: 'Morning'};
const scoped = request('101', true, 'schedule-grid', schedule);
assert.equal(scoped.name, 'Morning');
assert.equal(scoped['displaySpecificGroupIds[]'].join(','), '201');
assert.equal(scoped.showAll, undefined);
assert.equal(scoped.displayGroupIds, undefined);
assert.equal(scoped['displayGroupIds[]'], undefined);
assert.equal(scoped.displaySpecificGroupIds, undefined);
assert.deepEqual(request('', true, 'schedule-grid', schedule), schedule);
assert.deepEqual(request('101', false, 'schedule-grid', schedule), schedule);
console.log('Device scope request precedence: 16 assertions passed');

// Creation defaults also work on the designer, where list filtering is disabled.
let display = null;
const scope = {getDisplay: () => display};
vm.runInNewContext(source, {
  jQuery: () => ({on: () => {}}),
  document: {getElementById: () => ({dataset: {filterEnabled: 'false'}})},
  window: {deviceScope: scope},
});
const defaults = () => JSON.parse(JSON.stringify(scope.getLayoutDefaults()));
assert.deepEqual(defaults(), {});
display = {scopeResolution: '480 x 960'};
assert.deepEqual(defaults(), {contextWidth: 480, contextHeight: 960});
display = {scopeResolution: '5280 × 2160'};
assert.deepEqual(defaults(), {contextWidth: 5280, contextHeight: 2160});
display = {scopeResolution: '0 x 1080'};
assert.deepEqual(defaults(), {});
display = {scopeResolution: 'unknown'};
assert.deepEqual(defaults(), {});
display = null;
assert.deepEqual(defaults(), {});
console.log('New layout scope defaults: 6 assertions passed');

function noticeHidden(prompt, resolution) {
  const handlers = {};
  const notice = {hidden: true};
  const bar = {dataset: {filterEnabled: 'true', resolutionPrompt: String(prompt)}};
  const chain = {
    on: (event, callback) => {
      handlers[event] = callback;
      return chain;
    },
    attr: () => chain,
    closest: () => chain,
    toggle: () => chain,
    length: 0,
  };
  vm.runInNewContext(source, {
    jQuery: () => chain,
    document: {
      getElementById: (id) => {
        if (id === 'device-scope') return bar;
        if (id === 'device-scope-resolution-notice') return notice;
        return null;
      },
    },
    window: {deviceScope: {
      getDisplayId: () => '101',
      getDisplay: () => ({displayId: '101', displayGroupId: 201,
        scopeResolution: resolution}),
    }},
  });
  handlers['deviceScope:change']();
  return notice.hidden;
}
assert.equal(noticeHidden(true, ''), false);
assert.equal(noticeHidden(true, '1920 × 1080'), true);
assert.equal(noticeHidden(false, ''), true);
console.log('Resolution prompt: 3 assertions passed');
