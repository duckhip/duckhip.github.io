const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/\n\s*initialize\(\);\s*$/, '');

function createElement() {
  const listeners = {};
  return {
    checked: false,
    classList: {
      add() {},
      remove() {}
    },
    disabled: false,
    focus() {},
    hidden: false,
    querySelectorAll() { return []; },
    scrollIntoView() {},
    textContent: '',
    value: '',
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    dispatch(type) {
      listeners[type]?.({ target: this });
    }
  };
}

function createPage(search, values, cookies = { value: '' }) {
  const elements = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); }
  };
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelector() { return createElement(); }
  };
  Object.defineProperty(document, 'cookie', {
    get() { return cookies.value; },
    set(value) {
      const [pair] = value.split(';');
      cookies.value = value.includes('Max-Age=0') ? '' : pair;
    }
  });
  const context = {
    URLSearchParams,
    console,
    fetch() { throw new Error('unexpected fetch'); },
    localStorage: storage,
    window: {
      addEventListener() {},
      close() {},
      location: { pathname: '/teamk-attendance/', protocol: 'https:', search }
    },
    document
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return { context, elements };
}

test('remembers a checked name before submit across different QR query strings', () => {
  const values = new Map();
  const first = createPage('?date=2026-09-20&token=first', values);
  first.elements.get('name').value = '홍길동';
  first.elements.get('remember').checked = true;

  vm.runInContext('persistRememberedName()', first.context);

  const second = createPage('?date=2026-09-27&token=second', values);
  vm.runInContext('readSavedProfile()', second.context);
  assert.equal(second.elements.get('name').value, '홍길동');
});

test('removes the remembered name as soon as the checkbox is cleared', () => {
  const values = new Map();
  const cookies = { value: '' };
  const page = createPage('?date=2026-09-20&token=first', values, cookies);
  page.elements.get('name').value = '홍길동';
  page.elements.get('remember').checked = true;
  vm.runInContext('persistRememberedName()', page.context);

  page.elements.get('remember').checked = false;
  page.elements.get('remember').dispatch('change');

  assert.equal(values.size, 0);
  assert.equal(cookies.value, '');
});

test('restores from a cookie when an embedded browser loses local storage', () => {
  const cookies = { value: '' };
  const first = createPage('?date=2026-09-20&token=first', new Map(), cookies);
  first.elements.get('name').value = '홍길동';
  first.elements.get('remember').checked = true;
  vm.runInContext('persistRememberedName()', first.context);

  const second = createPage('?date=2026-09-27&token=second', new Map(), cookies);
  vm.runInContext('readSavedProfile()', second.context);

  assert.equal(second.elements.get('name').value, '홍길동');
});
