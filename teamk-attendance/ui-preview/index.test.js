const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const variants = ['필드 패스', '작전 콘솔', '주말 클럽'];

function element() {
  const children = new Map();
  const listeners = {};
  const attributes = {};
  const classes = new Set();
  return {
    value: '', textContent: '', checked: false, hidden: false, disabled: false,
    dataset: {}, style: { setProperty(key, value) { this[key] = value; } },
    classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) },
    setAttribute(key, value) { attributes[key] = value; },
    getAttribute(key) { return attributes[key]; },
    focus() {}, scrollIntoView() {},
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    addEventListener(type, listener) { listeners[type] = listener; },
    dispatch(type) { listeners[type]?.({ preventDefault() {} }); }
  };
}

function page() {
  const root = element();
  const phones = variants.map(() => {
    const phone = element();
    const form = phone.querySelector('form');
    form.elements = { name: element(), minor: element() };
    form.reportValidity = () => !!form.elements.name.value.trim();
    return phone;
  });
  const sections = variants.map(name => { const section = element(); section.setAttribute('data-variant', name); return section; });
  const groups = new Map([['.tk-phone', phones], ['[data-variant]', sections], ['.tk-finish', phones.map(phone => phone.querySelector('.tk-finish'))]]);
  root.querySelectorAll = selector => {
    if (!groups.has(selector)) groups.set(selector, variants.map(() => element()));
    return groups.get(selector);
  };
  const elements = new Map([['teamk-seasonal-directions', root]]);
  const document = { documentElement: { style: {} }, getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  } };
  const timers = new Map();
  const window = element();
  let nextTimer = 0;
  vm.runInNewContext(script, {
    document, window,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return { root, phones, sections, elements, document, window, timers, fire() {
    for (const [id, timer] of timers) { timers.delete(id); assert.equal(timer.delay, 2000); timer.callback(); }
  } };
}

test('preview is standalone and blocks network, form navigation and shared storage', () => {
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /connect-src 'none'; form-action 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|<iframe/i);
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie|openai|Tweak|serviceWorker/);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('defaults to the selected console design and switches all seasonal accents', () => {
  const p = page();
  assert.deepEqual(p.sections.map(section => section.hidden), [true, false, true]);
  assert.equal(p.elements.get('previewScreen').value, 'entry');
  for (const [season, label] of [['spring', '봄 작전'], ['summer', '여름 작전'], ['autumn', '가을 작전'], ['winter', '겨울 작전']]) {
    const control = p.elements.get('previewSeason');
    control.value = season; control.dispatch('change');
    assert.equal(p.root.querySelectorAll('[data-season-label]')[0].textContent, label);
    assert.match(p.root.style['--tk-accent'], /^#[0-9a-f]{6}$/i);
  }
});

test('requires a demo name and simulates waiting followed by completion', () => {
  const p = page();
  const phone = p.phones[1];
  phone.querySelector('.tk-submit').dispatch('click');
  assert.equal(p.timers.size, 0);
  phone.querySelector('form').elements.name.value = '테스트';
  phone.querySelector('.tk-submit').dispatch('click');
  assert.equal(phone.dataset.screen, 'waiting');
  assert.equal(p.timers.size, 1);
  p.fire();
  assert.equal(phone.dataset.screen, 'done');
  assert.equal(phone.querySelector('.tk-finish').classList.contains('tk-arrive'), true);
  assert.equal(p.elements.get('previewScreen').value, 'done');
});

test('changing the preview or returning cancels a pending demo result', () => {
  const p = page();
  const phone = p.phones[1];
  phone.querySelector('form').elements.name.value = '테스트';
  phone.querySelector('.tk-submit').dispatch('click');
  const variant = p.elements.get('previewVariant');
  variant.value = '주말 클럽'; variant.dispatch('change');
  assert.equal(p.timers.size, 0);
  assert.deepEqual(p.sections.map(section => section.hidden), [true, true, false]);
  p.phones[2].querySelector('.tk-return').dispatch('click');
  assert.equal(p.phones[2].dataset.screen, 'entry');
  phone.querySelector('.tk-submit').dispatch('click');
  p.window.dispatch('pagehide');
  assert.equal(p.timers.size, 0);
});

test('minor controls, local phrases and appearance work without host APIs', () => {
  const p = page();
  const phone = p.phones[1];
  const form = phone.querySelector('form');
  form.elements.minor.checked = true;
  form.elements.minor.dispatch('change');
  assert.equal(form.querySelector('select').disabled, false);
  form.elements.minor.checked = false;
  form.elements.minor.dispatch('change');
  assert.equal(form.querySelector('select').disabled, true);
  phone.querySelector('.tk-radio').dispatch('click');
  assert.ok(phone.querySelector('.tk-radio-text').textContent);
  const appearance = p.elements.get('previewAppearance');
  appearance.value = 'dark'; appearance.dispatch('change');
  assert.equal(p.document.documentElement.style.colorScheme, 'dark');
});
