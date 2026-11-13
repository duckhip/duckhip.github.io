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
  const attributes = {};
  const properties = {};
  return {
    checked: false,
    classList: {
      add() {},
      remove() {}
    },
    disabled: false,
    focused: false,
    focus() { this.focused = true; },
    hidden: false,
    querySelectorAll() { return []; },
    scrollIntoView() {},
    textContent: '',
    value: '',
    style: {
      setProperty(key, value) { properties[key] = value; },
      getPropertyValue(key) { return properties[key]; }
    },
    setAttribute(key, value) { attributes[key] = value; },
    getAttribute(key) { return attributes[key]; },
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
  const timers = new Map();
  let nextTimer = 0;
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); }
  };
  const document = {
    documentElement: createElement(),
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
    AbortController,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
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
  return { context, elements, requests, timers, fireTimer(delay) {
    for (const [id, timer] of timers) {
      if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    }
  } };
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
  assert.ok(page.elements.get('completionCallsign').textContent);
  assert.ok(page.elements.get('completionPhrase').textContent);
  assert.match(page.elements.get('completionCountTitle').textContent, /몇 번째 출석인지 확인/);
  assert.equal(page.elements.get('completionCountProgress').hidden, false);
  assert.equal(page.elements.get('completionCloseButton').textContent, '기다리지 않고 닫기');
  assert.equal(page.elements.get('completionCloseButton').focused, false);
  assert.equal(page.elements.get('completionPanel').focused, true);
  assert.equal(page.requests.length, 3, 'info, submit and existing count lookup only');
  finishCount(response({ success: true, yearlyCount: 10 }));
  await settle();
  assert.equal(page.elements.get('completionCount').textContent, '10');
  assert.equal(page.elements.get('completionBadge').hidden, false);
  assert.equal(page.elements.get('completionCountProgress').hidden, true);
  assert.equal(page.elements.get('completionCountStatus').getAttribute('data-state'), 'ready');
  assert.equal(page.timers.size, 0);
  page.elements.get('completionCloseButton').dispatch('click');
  assert.equal(page.elements.get('completionModal').hidden, true);
  assert.equal(page.elements.get('closeFallback').hidden, false);
});

test('slow lookup explains the wait, times out visibly, and retries only the count', async () => {
  const finishes = [];
  const page = createPage(validQuery, new Map(), undefined, () => new Promise(resolve => finishes.push(resolve)));
  vm.runInContext('completionName = "테스트대원"; loadCompletionCount(completionName)', page.context);
  page.fireTimer(7000);
  assert.match(page.elements.get('completionCountDetail').textContent, /조금 늦어지고/);
  page.fireTimer(30000);
  assert.equal(page.elements.get('completionCountStatus').getAttribute('data-state'), 'error');
  assert.match(page.elements.get('completionCountDetail').textContent, /출석 등록은 완료/);
  assert.equal(page.elements.get('completionCountProgress').hidden, true);
  assert.equal(page.elements.get('completionCountRetry').hidden, false);
  assert.equal(page.requests[0].options.signal.aborted, true);
  assert.equal(page.timers.size, 0);
  page.elements.get('completionCountRetry').dispatch('click');
  assert.equal(page.requests.length, 2);
  assert.ok(page.requests.every(request => request.url.includes('includeYearlyCount')));
  finishes[0](response({ success: true, yearlyCount: 999 }));
  await settle();
  assert.equal(page.elements.get('completionCountStatus').getAttribute('data-state'), 'loading');
  finishes[1](response({ success: true, yearlyCount: 12 }));
  await settle();
  assert.equal(page.elements.get('completionCount').textContent, '12');
  assert.equal(page.elements.get('completionCountStatus').getAttribute('data-state'), 'ready');
  assert.equal(page.timers.size, 0);
});

test('closing while waiting cancels lookup and ignores a late response', async () => {
  let finish;
  const page = createPage(validQuery, new Map(), undefined, () => new Promise(resolve => { finish = resolve; }));
  vm.runInContext('loadCompletionCount("테스트대원")', page.context);
  page.elements.get('completionCloseButton').dispatch('click');
  assert.equal(page.requests[0].options.signal.aborted, true);
  assert.equal(page.timers.size, 0);
  finish(response({ success: true, yearlyCount: 20 }));
  await settle();
  assert.equal(page.elements.get('completionModal').hidden, true);
  assert.equal(page.elements.get('completionCountStatus').getAttribute('data-state'), 'loading');
  assert.equal(page.elements.get('completionCloseButton').textContent, '기다리지 않고 닫기');
});

test('lookup errors and invalid counts preserve the saved attendance message', async () => {
  for (const result of [{ success: false }, { success: true, yearlyCount: 0 }, { success: true, yearlyCount: 'invalid' }, null]) {
    const page = createPage(validQuery, new Map(), undefined, () => result ? Promise.resolve(response(result)) : Promise.reject(new Error('offline')));
    vm.runInContext('loadCompletionCount("테스트대원")', page.context);
    await settle();
    assert.equal(page.elements.get('completionCountStatus').getAttribute('data-state'), 'error');
    assert.match(page.elements.get('completionCountDetail').textContent, /출석 등록은 완료/);
    assert.equal(page.elements.get('completionCountRetry').hidden, false);
    assert.equal(page.timers.size, 0);
  }
});

test('a count already returned with submission renders immediately without another request', () => {
  const page = createPage(validQuery, new Map());
  vm.runInContext('loadCompletionCount("테스트대원", 5)', page.context);
  assert.equal(page.requests.length, 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.elements.get('completionCount').textContent, '5');
  assert.equal(page.elements.get('completionBadge').hidden, false);
  assert.equal(page.elements.get('completionCountProgress').hidden, true);
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

test('all twelve game months select the seasonal light palette without requests', () => {
  const colors = ['#415b84', '#415b84', '#386440', '#386440', '#386440', '#126b78', '#126b78', '#126b78', '#945026', '#945026', '#945026', '#415b84'];
  colors.forEach((color, month) => {
    const page = createPage(`?date=2026-${String(month + 1).padStart(2, '0')}-15`, new Map());
    vm.runInContext('showBriefing()', page.context);
    const style = page.context.document.documentElement.style;
    assert.equal(style.getPropertyValue('--brand'), color);
    assert.equal(page.elements.get('themeColor').getAttribute('content'), style.getPropertyValue('--canvas'));
    assert.equal(page.requests.length, 0);
  });
  assert.match(html, /color-scheme: light/);
});

test('font controls default to 18px, clamp to 16-22px, and persist independently of the name', () => {
  const values = new Map([['teamk_mobile_attendance_profile_v1', JSON.stringify({ name: '테스트대원' })]]);
  const page = createPage(validQuery, values);
  vm.runInContext('restoreFontSize()', page.context);
  const size = () => page.context.document.documentElement.style.getPropertyValue('--text-size');
  assert.equal(size(), '18px');
  for (let i = 0; i < 5; i++) page.elements.get('fontIncrease').dispatch('click');
  assert.equal(size(), '22px');
  assert.equal(page.elements.get('fontIncrease').disabled, true);
  const next = createPage(validQuery, values);
  vm.runInContext('restoreFontSize(); readSavedProfile()', next.context);
  assert.equal(next.elements.get('fontSizeLabel').textContent, '22');
  assert.equal(next.elements.get('name').value, '테스트대원');
  for (let i = 0; i < 5; i++) page.elements.get('fontDecrease').dispatch('click');
  assert.equal(size(), '16px');
  assert.equal(page.elements.get('fontDecrease').disabled, true);
  assert.equal(page.elements.get('fontIncrease').disabled, false);
  assert.equal(page.requests.length + next.requests.length, 0);
});

test('unavailable storage and invalid font preferences do not break font controls', () => {
  for (const value of ['invalid', '0', '19', '100', '']) {
    const page = createPage('', new Map([['teamk_mobile_attendance_font_size_v1', value]]));
    vm.runInContext('restoreFontSize()', page.context);
    assert.equal(page.elements.get('fontSizeLabel').textContent, '18');
  }
  const page = createPage('', new Map());
  page.context.localStorage.getItem = () => { throw new Error('blocked'); };
  page.context.localStorage.setItem = () => { throw new Error('blocked'); };
  vm.runInContext('restoreFontSize()', page.context);
  page.elements.get('fontIncrease').dispatch('click');
  assert.equal(page.elements.get('fontSizeLabel').textContent, '20');
});

test('club banner stays independent of text size and the preview is removed', () => {
  assert.match(html, /id="clubTitle">잘 왔어요\.<br><span>오늘도 한 팀!/);
  assert.match(html, /\.briefing h2 \{[^}]*font-size: 30px/);
  assert.match(html, /id="fontDecrease"[^>]*aria-label="글씨 작게"/);
  assert.match(html, /id="fontIncrease"[^>]*aria-label="글씨 크게"/);
  assert.ok(!fs.existsSync(__dirname + '/ui-preview/index.html'));
});
