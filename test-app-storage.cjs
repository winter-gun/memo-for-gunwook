'use strict';

// 실제 app.js를 실행하는 저장 이벤트 회귀 테스트입니다. 브라우저 실기 검증은 아닙니다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { KEY, StorageHub, makeWindow, assertRealBoard } = require('./test-support/app-harness.cjs');

test('첫 저장을 받은 새 창은 예시를 종료하고 작성 중 초안을 유지하며 두 창의 순차 추가를 보존한다', () => {
  const hub = new StorageHub();
  const a = makeWindow(hub), b = makeWindow(hub);
  assert.equal(a.get('demoNotice').hidden, false);
  assert.equal(b.get('demoNotice').hidden, false);
  assert.equal(hub.getItem(KEY), null, 'demo must not persist itself');
  const draft = 'B 창에서 작성 중인 초안';
  b.get('memoInput').value = draft;
  a.add('A 창의 첫 메모');
  hub.flush();
  assertRealBoard(b, ['A 창의 첫 메모']);
  assert.equal(b.get('memoInput').value, draft);
  b.get('addButton').click();
  hub.flush();
  const saved = hub.tasks();
  assert.deepEqual(saved.map(task => task.title).sort(), ['A 창의 첫 메모', draft].sort());
  assert.equal(new Set(saved.map(task => task.id)).size, 2);
  assert.deepEqual(saved.map(task => task.date), [null, null]);
  assert.equal(b.get('memoInput').value, '');
  assertRealBoard(a, ['A 창의 첫 메모', draft]);
  assertRealBoard(b, ['A 창의 첫 메모', draft]);
});

test('늦게 전달된 storage 이벤트의 이전 payload 대신 현재 저장소의 최신 목록으로 수렴한다', () => {
  const hub = new StorageHub();
  const a = makeWindow(hub), b = makeWindow(hub);
  a.add('먼저 저장한 메모');
  a.add('그다음 저장한 메모');
  assert.equal(hub.pending.length, 2);
  assert.equal(JSON.parse(hub.pending[0].fields.newValue).tasks.length, 1, 'first event must really be stale');
  const latest = hub.getItem(KEY);
  hub.deliverOne();
  assertRealBoard(b, ['먼저 저장한 메모', '그다음 저장한 메모']);
  hub.flush();
  assertRealBoard(b, ['먼저 저장한 메모', '그다음 저장한 메모']);
  assert.equal(hub.getItem(KEY), latest, 'refresh must not write an old snapshot back');
});

test('다른 창의 변경이 반영되면 열려 있던 오래된 편집을 거부하고 최신 메모를 다시 열어 저장할 수 있다', () => {
  const hub = new StorageHub();
  const a = makeWindow(hub), b = makeWindow(hub);
  a.add('함께 열어 둔 메모');
  hub.flush();
  const id = hub.tasks()[0].id;
  b.openEdit(id);
  b.get('editText').value = 'B 창에서 작성하던 편집 초안';
  a.openEdit(id);
  a.get('editText').value = 'A 창이 먼저 저장한 최신 메모';
  a.get('editNotes').value = '최신 부연 내용';
  a.submitEdit();
  assert.equal(a.get('editDialog').open, false);
  hub.flush();
  assert.equal(b.get('editText').value, 'B 창에서 작성하던 편집 초안');
  assert.equal(b.get('editDialog').open, true);
  const latest = hub.getItem(KEY);
  b.submitEdit();
  assert.equal(b.get('editError').hidden, false);
  assert.match(b.get('editError').textContent, /다른 창에서 이 메모가 변경/);
  assert.equal(b.get('editDialog').open, true);
  assert.equal(b.get('editText').value, 'B 창에서 작성하던 편집 초안');
  assert.equal(hub.getItem(KEY), latest, 'rejected edit must preserve latest saved record');
  b.get('editDialog').close();
  b.openEdit(id);
  assert.equal(b.get('editText').value, 'A 창이 먼저 저장한 최신 메모');
  assert.equal(b.get('editNotes').value, '최신 부연 내용');
  assert.equal(b.get('editError').hidden, true);
  b.get('editText').value = '최신 내용을 읽고 다시 편집한 메모';
  b.submitEdit();
  hub.flush();
  assert.equal(b.get('editDialog').open, false);
  assert.equal(hub.tasks()[0].id, id);
  assert.equal(hub.tasks()[0].notes, '최신 부연 내용');
  assertRealBoard(a, ['최신 내용을 읽고 다시 편집한 메모']);
  assertRealBoard(b, ['최신 내용을 읽고 다시 편집한 메모']);
});

test('pageshow와 다시 보이는 visibilitychange는 놓친 변경을 읽고 작성 중 초안을 보존한다', () => {
  const hub = new StorageHub();
  const a = makeWindow(hub), b = makeWindow(hub);
  const draft = '복귀 후에도 남아야 할 초안';
  b.get('memoInput').value = draft;
  a.add('복귀 전에 추가된 메모');
  b.events.dispatch('pageshow');
  assertRealBoard(b, ['복귀 전에 추가된 메모']);
  assert.equal(b.get('memoInput').value, draft);
  a.add('숨겨진 동안 추가된 메모');
  b.document.visibilityState = 'hidden';
  b.document.dispatch('visibilitychange');
  assert.equal(b.get('countAll').textContent, '1');
  b.document.visibilityState = 'visible';
  b.document.dispatch('visibilitychange');
  assertRealBoard(b, ['복귀 전에 추가된 메모', '숨겨진 동안 추가된 메모']);
  assert.equal(b.get('memoInput').value, draft);
  hub.flush();
  assertRealBoard(b, ['복귀 전에 추가된 메모', '숨겨진 동안 추가된 메모']);
  assert.equal(b.get('memoInput').value, draft);
});
