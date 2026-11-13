const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/\n\s*initialize\(\);\s*$/, '');

test('shows the Team-K image in the attendance header', () => {
  assert.match(html, /<img class="brand-logo" src="\.\/images\/team_k_logo\.png" alt="Team-K 로고"/);
  assert.ok(fs.existsSync(__dirname + '/images/team_k_logo.png'));
});

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
    style: { setProperty() {} },
    setAttribute() {},
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    dispatch(type) {
      listeners[type]?.({ target: this, preventDefault() {} });
    }
  };
}

function createPage(search, values, cookies = { value: '' }, responder) {
  const elements = new Map();
  const requests = [];
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
    fetch(url, options) {
      requests.push({ url, options });
      return responder ? responder(url, options) : Promise.resolve(response({ success: true, open: true }));
    },
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
  return { context, elements, requests };
}

function response(value) { return { ok: true, text: () => Promise.resolve(JSON.stringify(value)) }; }
const settle = () => new Promise(resolve => setImmediate(resolve));
const validQuery = '?spreadsheetId=test-sheet&date=2026-11-15&token=test-token';

test('automatically remembers a name across different QR query strings', () => {
  const values = new Map();
  const first = createPage('?date=2026-09-20&token=first', values);
  first.elements.get('name').value = '홍길동';

  vm.runInContext('persistRememberedName()', first.context);

  const second = createPage('?date=2026-09-27&token=second', values);
  vm.runInContext('readSavedProfile()', second.context);
  assert.equal(second.elements.get('name').value, '홍길동');
});

test('clearing the name deletes both saved storage and cookie without a separate button', () => {
  const values = new Map();
  const cookies = { value: '' };
  const page = createPage('?date=2026-09-20&token=first', values, cookies);
  page.elements.get('name').value = '홍길동';
  vm.runInContext('persistRememberedName()', page.context);

  page.elements.get('name').value = '';
  page.elements.get('name').dispatch('input');

  assert.equal(values.size, 0);
  assert.equal(cookies.value, '');
});

test('restores from a cookie when an embedded browser loses local storage', () => {
  const cookies = { value: '' };
  const first = createPage('?date=2026-09-20&token=first', new Map(), cookies);
  first.elements.get('name').value = '홍길동';
  vm.runInContext('persistRememberedName()', first.context);

  const second = createPage('?date=2026-09-27&token=second', new Map(), cookies);
  vm.runInContext('readSavedProfile()', second.context);

  assert.equal(second.elements.get('name').value, '홍길동');
});

test('loads with one info request, shows briefing immediately, and preserves edits during loading', async () => {
  let finish;
  const values = new Map([['teamk_mobile_attendance_profile_v1', JSON.stringify({ name: '기존이름' })]]);
  const page = createPage(validQuery, values, undefined, () => new Promise(resolve => { finish = resolve; }));
  vm.runInContext('initialize()', page.context);
  assert.equal(page.requests.length, 1);
  assert.ok(page.requests[0].url.includes('action=mobile_attendance_info'));
  assert.ok(page.elements.get('operationTitle').textContent);
  assert.equal(page.elements.get('seasonTag').textContent, '가을 필드 데이');
  assert.equal(page.elements.get('name').value, '기존이름');
  page.elements.get('name').value = '수정이름';
  page.elements.get('name').dispatch('input');
  page.elements.get('attendanceForm').dispatch('submit');
  assert.equal(page.requests.length, 1, 'cannot submit before QR is verified');
  finish(response({ success: true, open: true, field: '필드', date: '2026-11-15' }));
  await settle();
  assert.equal(page.elements.get('name').value, '수정이름');
  assert.equal(page.elements.get('submitButton').disabled, false);
});

test('invalid QR and closed registration never enable submission', async () => {
  const missing = createPage('', new Map());
  vm.runInContext('initialize()', missing.context);
  assert.equal(missing.requests.length, 0);
  assert.equal(missing.elements.get('submitButton').disabled, true);
  const closed = createPage(validQuery, new Map(), undefined, () => Promise.resolve(response({ success: true, open: false })));
  vm.runInContext('initialize()', closed.context);
  await settle();
  assert.equal(closed.elements.get('submitButton').disabled, true);
});

test('success appears before count lookup and duplicate clicks cannot submit twice', async () => {
  let finishSubmit;
  let finishCount;
  const page = createPage(validQuery, new Map(), undefined, (url, options) => {
    if (options.method === 'POST') return new Promise(resolve => { finishSubmit = resolve; });
    if (url.includes('includeYearlyCount')) return new Promise(resolve => { finishCount = resolve; });
    return Promise.resolve(response({ success: true, open: true }));
  });
  vm.runInContext('initialize()', page.context);
  await settle();
  page.elements.get('name').value = '테스트대원';
  page.elements.get('minor').checked = true;
  page.elements.get('minorCount').value = '2';
  page.elements.get('attendanceForm').dispatch('submit');
  page.elements.get('attendanceForm').dispatch('submit');
  assert.equal(page.requests.length, 2);
  const payload = JSON.parse(page.requests[1].options.body);
  assert.equal(payload.minorCount, 2);
  assert.equal(payload.skipYearlyCount, true);
  finishSubmit(response({ success: true }));
  await settle();
  assert.equal(page.elements.get('completionModal').hidden, false);
  assert.match(page.elements.get('completionCallsign').textContent, /오늘의 콜사인/);
  assert.equal(page.requests.length, 3, 'info, submit and existing count lookup only');
  finishCount(response({ success: true, yearlyCount: 10 }));
  await settle();
  assert.equal(page.elements.get('completionCount').textContent, 10);
  assert.equal(page.elements.get('completionBadge').hidden, false);
  page.elements.get('completionCloseButton').dispatch('click');
  assert.equal(page.elements.get('completionModal').hidden, true);
  assert.equal(page.elements.get('closeFallback').hidden, false);
});

test('briefing is stable for one game and rotates across game dates', () => {
  const one = createPage(validQuery, new Map());
  const two = createPage(validQuery, new Map());
  const next = createPage(validQuery.replace('11-15', '11-22'), new Map());
  for (const page of [one, two, next]) vm.runInContext('showBriefing()', page.context);
  assert.equal(one.elements.get('operationTitle').textContent, two.elements.get('operationTitle').textContent);
  assert.notEqual(one.elements.get('operationTitle').textContent, next.elements.get('operationTitle').textContent);
  assert.equal(one.requests.length + two.requests.length + next.requests.length, 0);
});
