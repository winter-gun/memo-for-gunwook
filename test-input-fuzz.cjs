'use strict';

// 고정 시드의 입력을 실제 앱 소스에 적용하는 정확히 10개 시나리오입니다.
// 가벼운 DOM 모형을 사용하므로 브라우저 화면·iPhone·동시 원자 쓰기의 보장은 아닙니다.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./src/memo-core.js');
const { KEY, StorageHub, makeWindow, assertRealBoard } = require('./test-support/app-harness.cjs');

const SEED = 20261020;
function randomFor(scenario) {
  let state = (SEED + scenario * 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function choose(random, values) { return values[Math.floor(random() * values.length)]; }
function token(random, length = 12) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return Array.from({length}, () => choose(random, alphabet.split(''))).join('');
}
function backup(tasks) { return JSON.stringify({app:'memonote', version:1, tasks}); }
function titles(hub) { return hub.tasks().map(task => task.title); }
function escaped(text) { return text.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); }
function visibleIds(tab) {
  return [...new Set([...tab.get('board').innerHTML.matchAll(/data-action="edit" data-id="([^"]+)"/g)].map(match => match[1]))].sort();
}
function reopenAndCompare(hub, expected) {
  const reopened = makeWindow(hub);
  assert.deepEqual(hub.tasks(), expected, 'opening the app must preserve the complete persisted records');
  assert.equal(reopened.get('countAll').textContent, String(expected.length));
  assert.equal(reopened.get('demoNotice').hidden, true);
  return reopened;
}

test('01: 난수 한국어·영문·숫자·문장부호를 한 줄씩 구분하고 수정·재열기 후 원문을 보존한다', () => {
  const random = randomFor(1), hub = new StorageHub(), tab = makeWindow(hub);
  const expected = Array.from({length:48}, (_, i) => `${choose(random, ['회의 준비', 'buy milk', '보고서 v2.3 검토', '일정 (확인)'])} ${i} ${token(random)} / 0007 1e309`);
  tab.add(expected.join('\n'));
  assert.deepEqual(titles(hub), expected);
  assert.ok(hub.tasks().every(task => task.date === null && !task.done));
  assert.equal(new Set(hub.tasks().map(task => task.id)).size, expected.length);
  const target = hub.tasks()[Math.floor(random() * expected.length)];
  tab.openEdit(target.id);
  tab.get('editText').value = target.title + ' 수정 ' + token(random);
  tab.submitEdit();
  assert.equal(hub.tasks().find(task => task.id === target.id).title, target.title + ' 수정 ' + tab.get('editText').value.split(' 수정 ')[1]);
  const saved = hub.tasks();
  reopenAndCompare(hub, saved);
  assert.deepEqual(core.parseImport(backup(saved)), saved);
});

test('02: 난수로 섞은 여섯 줄바꿈·목록·체크박스를 분리하고 음수·소수는 유지한다', () => {
  const random = randomFor(2), hub = new StorageHub(), tab = makeWindow(hub);
  const separators = ['\n', '\r\n', '\r', '\u0085', '\u2028', '\u2029'];
  const prefixes = ['', '- ', '* ', '• ', '1. ', '23) ', '- [x] ', '[ ] ', '[✓] '];
  const expected = [], done = [], lines = [];
  for (let i = 0; i < 36; i++) {
    const prefix = prefixes[i % prefixes.length], title = `${choose(random, ['-3도 점검', '1.5배 검토', '작업'])} ${token(random)}`;
    lines.push(prefix + title); expected.push(title); done.push(prefix.includes('[x]') || prefix.includes('[✓]'));
  }
  tab.add(lines.map((line, i) => line + (i === lines.length - 1 ? '' : separators[i % separators.length])).join(''));
  assert.deepEqual(titles(hub), expected);
  assert.deepEqual(hub.tasks().map(task => task.done), done);
  assert.ok(hub.tasks().every(task => task.date === null));
  reopenAndCompare(hub, hub.tasks());
});

test('03: 빈 줄·보이지 않는 문자만 있는 줄은 건너뛰고 제어문자는 부분 저장 없이 거절한다', () => {
  const random = randomFor(3), hub = new StorageHub(), tab = makeWindow(hub);
  const base = '기존 메모 ' + token(random); tab.add(base);
  const original = hub.getItem(KEY);
  for (const input of ['', ' \t\n\u3000\u00a0', '\u200B\u200E\u200F\u2060\uFEFF', '[x] \u200B\n- [ ] \u2060']) {
    tab.add(input);
    assert.equal(hub.getItem(KEY), original);
    assert.equal(tab.get('composeError').hidden, false);
  }
  assert.equal(core.hasVisibleText('\u200B\u200D\uFE0F \t'), false);
  assert.equal(core.hasVisibleText('👨‍👩‍👧‍👦'), true);
  for (const control of ['\u0000', '\u0001', '\u0007', '\u001b', '\u007f']) {
    const input = '정상처럼 보이는 첫 줄 ' + token(random) + '\n문자' + control + '사이';
    tab.add(input);
    assert.equal(hub.getItem(KEY), original, 'a rejected later line must not save earlier lines');
    assert.equal(tab.get('memoInput').value, input, 'the failed draft must remain recoverable');
  }
  const valid = '👨‍👩‍👧‍👦 가족\t일정 ' + token(random);
  tab.add('\u200B\n' + valid + '\n\u2060');
  assert.deepEqual(titles(hub), [valid, base]);
  tab.openEdit(hub.tasks()[0].id);
  tab.get('editText').value = '\u200B\u200E';
  const beforeEdit = hub.getItem(KEY); tab.submitEdit();
  assert.equal(hub.getItem(KEY), beforeEdit);
  assert.equal(tab.get('editError').hidden, false);
  assert.equal(tab.get('editDialog').open, true);
  reopenAndCompare(hub, hub.tasks());
});

test('04: NFC·NFD와 대소문자가 다른 검색은 같은 문자를 찾으며 저장 원문·이모지는 바꾸지 않는다', () => {
  const random = randomFor(4), hub = new StorageHub(), tab = makeWindow(hub);
  const expected = ['cafe\u0301 ' + token(random), '\u1100\u1161\u1102\u1161 일정 ' + token(random), 'UPPER Case 👩🏽‍💻 ' + token(random), '무관한 다른 메모'];
  tab.add(expected.join('\n'));
  const saved = hub.tasks();
  assert.deepEqual(titles(hub), expected, 'search normalization must not rewrite stored text');
  for (const [query, index] of [['CAFÉ', 0], ['가나', 1], ['upper CASE', 2], ['👩🏽‍💻', 2]]) {
    tab.search(query); assert.deepEqual(visibleIds(tab), [saved[index].id]);
  }
  tab.search(''); tab.openEdit(saved[3].id);
  tab.get('editNotes').value = '덧붙임 re\u0301sume\u0301'; tab.submitEdit();
  tab.search('RÉSUMÉ'); assert.deepEqual(visibleIds(tab), [saved[3].id]);
  assert.equal(core.searchKey('CAFÉ'), core.searchKey('cafe\u0301'));
  assert.equal(core.searchKey('가나'), core.searchKey('\u1100\u1161\u1102\u1161'));
  assert.deepEqual(titles(hub), expected);
  reopenAndCompare(hub, hub.tasks());
});

test('05: HTML·따옴표·코드 형태의 난수 입력은 카드·표에서 이스케이프하고 원문을 백업한다', () => {
  const random = randomFor(5), hub = new StorageHub(), tab = makeWindow(hub);
  const fragments = ['<img src=x onerror=alert(1)>', '<script>alert("x")</script>', '"\' & < > \\ /', '${location.href} `code`', 'AT&T <tag>'];
  const expected = Array.from({length:20}, (_, i) => `${fragments[i % fragments.length]} ${token(random)}`);
  tab.add(expected.join('\n'));
  assert.deepEqual(titles(hub), expected);
  for (const view of ['cards', 'table']) {
    tab.chooseView(view);
    const html = tab.get('board').innerHTML;
    assert.ok(!/<(?:script|img|tag)\b/i.test(html));
    for (const title of expected) assert.ok(html.includes(escaped(title)));
  }
  const id = hub.tasks()[0].id, notes = '<svg onload="alert(1)"> & ' + token(random);
  tab.openEdit(id); tab.get('editNotes').value = notes; tab.submitEdit();
  assert.ok(tab.get('board').innerHTML.includes(escaped(notes)));
  assert.ok(!tab.get('board').innerHTML.includes('<svg onload='));
  assert.equal(core.parseImport(backup(hub.tasks())).find(task => task.id === id).notes, notes);
  reopenAndCompare(hub, hub.tasks());
});

test('06: 본문 날짜·난수 숫자는 날짜를 만들지 않고 명시적 날짜와 IME 조합 중 입력을 구분한다', () => {
  const random = randomFor(6), hub = new StorageHub(), tab = makeWindow(hub);
  const expected = ['내일 전화 ' + token(random), '2026-10-25까지 제출 ' + token(random), '10/25 000001 1e309 ' + token(random)];
  tab.get('memoInput').value = expected.join('\n');
  const composing = tab.get('memoInput').dispatch('keydown', {ctrlKey:true, key:'Enter', isComposing:true});
  assert.equal(composing.defaultPrevented, false); assert.equal(hub.getItem(KEY), null);
  const committed = tab.get('memoInput').dispatch('keydown', {ctrlKey:true, key:'Enter', isComposing:false});
  assert.equal(committed.defaultPrevented, true); assert.deepEqual(titles(hub), expected);
  assert.ok(hub.tasks().every(task => task.date === null));
  tab.get('newDate').value = '2028-02-29'; tab.add('직접 날짜 지정 ' + token(random));
  assert.equal(hub.tasks()[0].date, '2028-02-29');
  assert.ok(hub.tasks().slice(1).every(task => task.date === null));
  const id = hub.tasks()[0].id; tab.openEdit(id); tab.get('clearEditDate').click(); tab.submitEdit();
  assert.equal(hub.tasks().find(task => task.id === id).date, null);
  const before = hub.getItem(KEY); tab.get('newDate').value = '2026-02-30'; tab.add('잘못된 날짜 ' + token(random));
  assert.equal(hub.getItem(KEY), before); assert.equal(tab.get('composeError').hidden, false);
  reopenAndCompare(hub, hub.tasks());
});

test('07: 동일한 난수 제목도 개별 항목으로 수정·완료·삭제하며 되돌리기는 정확한 항목을 복원한다', () => {
  const random = randomFor(7), hub = new StorageHub(), tab = makeWindow(hub), title = '중복 ' + token(random);
  tab.add([title, title, title, title + '!', title + '?'].join('\n'));
  const initial = hub.tasks(); assert.equal(new Set(initial.map(task => task.id)).size, 5);
  tab.toggle(initial[1].id);
  assert.deepEqual(hub.tasks().filter(task => task.done).map(task => task.id), [initial[1].id]);
  tab.openEdit(initial[2].id); tab.get('editText').value = title + ' 수정'; tab.submitEdit();
  assert.equal(hub.tasks().find(task => task.id === initial[0].id).title, title);
  const beforeDelete = hub.tasks(); tab.delete(initial[0].id);
  assert.equal(hub.tasks().length, 4); assert.ok(!hub.tasks().some(task => task.id === initial[0].id));
  tab.get('undoButton').click(); assert.deepEqual(hub.tasks(), beforeDelete);
  tab.toggle(initial[1].id); assert.ok(hub.tasks().every(task => !task.done));
  reopenAndCompare(hub, hub.tasks());
});

test('08: 길이·항목 수·전체 용량 초과는 일부만 저장하지 않고 경계 안의 긴 입력을 보존한다', () => {
  const random = randomFor(8), hub = new StorageHub(), tab = makeWindow(hub);
  const boundary = token(random, core.LIMITS.title); tab.add(boundary);
  assert.equal(hub.tasks()[0].title, boundary);
  const saved = hub.getItem(KEY);
  for (const input of ['정상 첫 줄\n' + boundary + 'X', 'X'.repeat(core.LIMITS.inputCharacters + 1), Array(core.LIMITS.tasks + 1).fill('메모').join('\n')]) {
    tab.add(input); assert.equal(hub.getItem(KEY), saved); assert.equal(tab.get('composeError').hidden, false);
  }
  reopenAndCompare(hub, hub.tasks());
  const largeHub = new StorageHub();
  const existing = core.parseMemo(Array.from({length:60}, (_, i) => '큰 메모 ' + i + ' ' + token(random)).join('\n'));
  for (const task of existing) task.notes = '가'.repeat(core.LIMITS.notes);
  const raw = backup(existing); assert.ok(Buffer.byteLength(raw) < core.LIMITS.importBytes);
  largeHub.values.set(KEY, raw);
  const largeTab = makeWindow(largeHub);
  largeTab.add(Array.from({length:100}, () => '나'.repeat(core.LIMITS.title)).join('\n'));
  assert.equal(largeHub.getItem(KEY), raw, 'aggregate size failure must preserve the entire previous snapshot');
  assert.match(largeTab.get('toastText').textContent, /4MB/);
  assert.equal(largeTab.get('memoInput').value.length > 0, true);
});

test('09: 난수 JSON 백업 왕복·잘못된 복구 거절과 파일 읽기 중 다른 탭의 추가를 보존한다', async () => {
  const random = randomFor(9), hub = new StorageHub(), tab = makeWindow(hub);
  tab.add('원래 메모 ' + token(random));
  const existing = hub.tasks(), incoming = core.parseMemo('가져올 메모 ' + token(random) + '\n[x] 완료 메모 ' + token(random), {date:'2028-02-29'});
  incoming[0].notes = '<내용> cafe\u0301 👨‍👩‍👧‍👦';
  const json = backup(incoming); assert.deepEqual(core.parseImport('\uFEFF' + json), incoming);
  const invalid = ['{broken', 'null', '[]', JSON.stringify({app:'other',version:1,tasks:incoming}), JSON.stringify({app:'memonote',version:2,tasks:incoming}), backup([incoming[0],incoming[0]])];
  for (const mutate of [task => { task.date='2026-02-30'; }, task => { task.done='false'; }, task => { task.title=''; }, task => { delete task.notes; }, task => { task.extra=1; }, task => { task.createdAt='bad'; }]) {
    const rows = structuredClone(incoming); mutate(rows[1]); invalid.push(backup(rows));
  }
  const before = hub.getItem(KEY);
  for (const bad of invalid) { await tab.importText(bad); assert.equal(hub.getItem(KEY), before); }
  await tab.importText(json, core.LIMITS.importBytes + 1); assert.equal(hub.getItem(KEY), before);
  const other = makeWindow(hub); let release;
  const reading = new Promise(resolve => { release=resolve; });
  tab.get('importFile').files = [{size:Buffer.byteLength(json), text:() => reading}];
  const importing = tab.get('importFile').dispatchAsync('change');
  const during = '파일 읽기 중 추가 ' + token(random); other.add(during);
  release(json); await importing;
  assert.equal(hub.tasks().length, existing.length + incoming.length + 1);
  assert.ok(titles(hub).includes(during));
  assert.deepEqual(hub.tasks().filter(task => incoming.some(row => row.id===task.id)), incoming);
  const after = hub.getItem(KEY); await tab.importText(json); assert.equal(hub.getItem(KEY), after, 'same backup IDs must not duplicate or overwrite records');
  reopenAndCompare(hub, hub.tasks());
});

test('10: storage 이벤트가 지연돼도 추가·편집·보기 설정·되돌리기가 다른 탭의 최신 메모를 보존한다', () => {
  const random = randomFor(10), hub = new StorageHub(), a = makeWindow(hub), b = makeWindow(hub);
  const first = 'A ' + token(random), second = 'B ' + token(random);
  a.add(first); b.add(second); // Intentionally do not deliver storage events.
  assert.deepEqual(titles(hub).sort(), [first,second].sort());
  hub.flush(); const id = hub.tasks().find(task => task.title===first).id;
  b.openEdit(id); const stale = '오래된 편집 ' + token(random); b.get('editText').value=stale;
  a.openEdit(id); const latest='최신 편집 ' + token(random); a.get('editText').value=latest; a.submitEdit();
  const beforeRejected = hub.getItem(KEY); b.submitEdit();
  assert.equal(hub.getItem(KEY), beforeRejected); assert.equal(b.get('editError').hidden, false);
  assert.equal(b.get('editText').value, stale); assert.equal(b.get('editDialog').open,true); b.get('editDialog').close();
  const third='보기 변경 직전 추가 ' + token(random); a.add(third); b.chooseView('table');
  assert.ok(titles(hub).includes(third)); assert.equal(JSON.parse(hub.getItem(KEY)).preferences.view,'table');
  const beforeSort='정렬 변경 직전 추가 ' + token(random); a.add(beforeSort);
  b.get('sortSelect').value='oldest'; b.get('sortSelect').dispatch('change');
  assert.ok(titles(hub).includes(beforeSort));
  assert.equal(b.get('sortSelect').value,'oldest', 'refreshing the list must preserve the sort choice from the current change event');
  assert.equal(JSON.parse(hub.getItem(KEY)).preferences.sort,'oldest');
  hub.flush();
  b.delete(id); const fourth='되돌리기 직전 추가 ' + token(random); a.add(fourth);
  b.get('undoButton').click();
  assert.ok(titles(hub).includes(fourth));
  assert.ok(!hub.tasks().some(task => task.id===id), 'unsafe stale undo must be rejected rather than restoring an entire old list');
  assert.ok(!titles(hub).includes(stale));
  hub.flush(); const saved=hub.tasks(); reopenAndCompare(hub,saved);
  assertRealBoard(a,titles(hub)); assertRealBoard(b,titles(hub));
});
