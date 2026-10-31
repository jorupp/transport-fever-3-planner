import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentStore, DEVELOPMENT_RELOAD_KEY } from '../src/lib/development-state.ts';

function browser() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const navigation = new EventTarget();
  const reload = (userInitiated, signal) => navigation.dispatchEvent(Object.assign(new Event('navigate'), { navigationType: 'reload', userInitiated, signal }));
  return { storage, navigation, reload };
}

test('development remounts retain selections, edits, and functional state updates', () => {
  const store = createDevelopmentStore();
  const initial = { year: '1990', cargos: ['PASSENGERS'] };
  let notifications = 0;
  const unsubscribe = store.subscribe('draft', () => notifications++);
  store.set('draft', initial, { year: '1960', cargos: ['COAL', 'IRON_ORE'] });
  store.set('draft', initial, previous => ({ ...previous, year: '' }));
  assert.deepEqual(store.get('draft', initial), { year: '', cargos: ['COAL', 'IRON_ORE'] });
  assert.equal(notifications, 2);
  unsubscribe();
  store.set('draft', initial, initial);
  assert.equal(notifications, 2);
});

test('automatic full reload restores applied settings separately from an uncalculated draft', () => {
  const { storage, navigation, reload } = browser();
  const store = createDevelopmentStore(storage, navigation, '/', () => 1000);
  store.set('applied', { year: 1990 }, { year: 1960 });
  store.set('draft', { year: '1990' }, { year: '1970' });
  store.set('mode', 'train', 'tram');
  store.set('configId', '', 'city-1960');
  assert.equal(storage.getItem(DEVELOPMENT_RELOAD_KEY), null, 'ordinary edits do not persist to storage');
  reload(false);
  const restored = createDevelopmentStore(storage, undefined, '/', () => 1001);
  assert.deepEqual(restored.get('applied', { year: 1990 }), { year: 1960 });
  assert.deepEqual(restored.get('draft', { year: '1990' }), { year: '1970' });
  assert.equal(restored.get('mode', 'train'), 'tram');
  assert.equal(restored.get('configId', ''), 'city-1960');
  assert.equal(storage.getItem(DEVELOPMENT_RELOAD_KEY), null, 'snapshot is consumed once');
  assert.equal(createDevelopmentStore(storage).get('mode', 'train'), 'train');
});

test('manual refresh clears temporary state without removing named localStorage configs', () => {
  const { storage, navigation, reload } = browser();
  storage.setItem('tf3-planner.configs.v1', 'saved named configurations');
  const store = createDevelopmentStore(storage, navigation);
  store.set('mode', 'train', 'road');
  reload(false);
  reload(true);
  assert.equal(createDevelopmentStore(storage).get('mode', 'train'), 'train');
  assert.equal(storage.getItem('tf3-planner.configs.v1'), 'saved named configurations');
});

test('canceled reloads, expired snapshots, incompatible state and malformed storage reset safely', () => {
  const { storage, navigation, reload } = browser();
  const store = createDevelopmentStore(storage, navigation, '/', () => 1000);
  store.set('mode', 'train', 'tram');
  const controller = new AbortController();
  reload(false, controller.signal);
  controller.abort();
  assert.equal(storage.getItem(DEVELOPMENT_RELOAD_KEY), null);
  reload(false);
  assert.equal(createDevelopmentStore(storage, undefined, '/', () => 61_001).get('mode', 'train'), 'train');
  storage.setItem(DEVELOPMENT_RELOAD_KEY, 'invalid json');
  assert.equal(createDevelopmentStore(storage).get('mode', 'train'), 'train');
  storage.setItem(DEVELOPMENT_RELOAD_KEY, JSON.stringify({ version: 1, path: '/', at: 1000, values: { draft: 'old schema' } }));
  assert.deepEqual(createDevelopmentStore(storage, undefined, '/', () => 1001).get('draft', { year: '1990' }), { year: '1990' });
});

test('blocked session storage still allows in-document development state preservation', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const navigation = new EventTarget();
  const store = createDevelopmentStore(blocked, navigation);
  store.set('search', '', 'A4');
  assert.equal(store.get('search', ''), 'A4');
  assert.doesNotThrow(() => navigation.dispatchEvent(Object.assign(new Event('navigate'), { navigationType: 'reload', userInitiated: false })));
});
