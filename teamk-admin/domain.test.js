const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/domain.js', 'utf8'), context);
const domain = context.window.TeamKDomain;

test('calculates adult and minor fees with the tablet formulas', () => {
  const summary = domain.calculateSummary(
    { fee: '35000' },
    [
      { paid: true, minor: false },
      { paid: true, minor: true },
      { paid: false, minor: false }
    ]
  );
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.gameFeeTotal, 55000);
  assert.equal(summary.fieldPaymentTotal, 50000);
});

test('merges one adult and up to five minors from a QR submission', () => {
  const merged = domain.mergeSubmissions([], [{
    submissionId: 'one',
    name: '홍길동',
    minorCount: 2,
    note: ''
  }]);
  assert.deepEqual(Array.from(merged.attendees, item => item.name), ['홍길동', '홍길동+소인1', '홍길동+소인2']);
  assert.equal(merged.attendees.filter(item => item.minor).length, 2);
  assert.deepEqual(Array.from(merged.submissionIds), ['one']);
});

test('skips a duplicate adult submission', () => {
  const merged = domain.mergeSubmissions([{ id: 'a', name: '홍길동', paid: true }], [{
    submissionId: 'two',
    name: ' 홍길동 ',
    minorCount: 1
  }]);
  assert.equal(merged.skipped, 1);
  assert.equal(merged.submissionIds.length, 0);
});

test('skips blank QR submissions without adding empty attendees', () => {
  const merged = domain.mergeSubmissions([], [{
    submissionId: 'blank',
    name: '   ',
    minorCount: 2
  }]);
  assert.equal(merged.skipped, 1);
  assert.equal(merged.attendees.length, 0);
  assert.equal(merged.submissionIds.length, 0);
});

test('matches attendee identifiers regardless of number or string representation', () => {
  assert.equal(domain.sameId(123, '123'), true);
  assert.equal(domain.sameId(123, '124'), false);
});

test('edits and deletes a numeric-id attendee using a string form id', () => {
  const original = [{ id: 101, name: '기존회원', paid: false, minor: false, note: '전' }];
  assert.equal(domain.hasDuplicateAttendee(original, '기존회원', '101'), false);
  const edited = domain.upsertAttendee(original, {
    id: '101',
    name: '변경회원',
    minor: true,
    note: '후'
  });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].name, '변경회원');
  assert.equal(edited[0].paid, false);
  assert.equal(edited[0].minor, true);
  assert.equal(domain.deleteAttendee(edited, 101).length, 0);
});

test('new attendees are paid by default without an input field', () => {
  const attendees = domain.upsertAttendee([], { id: '', name: '신규회원', minor: false, note: '' });
  assert.equal(attendees[0].paid, true);
});

test('edits an attendee paid status when the form supplies it', () => {
  const attendees = domain.upsertAttendee(
    [{ id: 'member-1', name: '회원', paid: false, minor: false, note: '' }],
    { id: 'member-1', name: '회원', paid: true, minor: false, note: '' }
  );
  assert.equal(attendees[0].paid, true);
});

test('adds one adult and the selected number of minors as a group', () => {
  const attendees = domain.addAttendeeGroup([], {
    name: '보호자',
    paid: false,
    minorCount: 2,
    note: '가족'
  });
  assert.deepEqual(Array.from(attendees, item => item.name), ['보호자', '보호자+소인1', '보호자+소인2']);
  assert.deepEqual(Array.from(attendees, item => item.minor), [false, true, true]);
  assert.deepEqual(Array.from(attendees, item => item.paid), [false, false, false]);
});

test('progress tracker stays active until nested requests finish', () => {
  const states = [];
  const tracker = domain.createProgressTracker((active, message, depth) => states.push({ active, message, depth }));
  tracker.begin('목록');
  tracker.begin('상세');
  tracker.end();
  tracker.end();
  assert.deepEqual(Array.from(states, item => [item.active, item.depth]), [
    [true, 1],
    [true, 2],
    [true, 1],
    [false, 0]
  ]);
});
