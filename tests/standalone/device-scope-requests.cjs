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
