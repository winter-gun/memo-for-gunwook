'use strict';

// 데이터 계층의 전체 사용 흐름 3회입니다.
// 실제 버튼·브라우저 저장·여러 창의 동작은 별도 UI 검증으로 확인합니다.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./src/memo-core.js');

function backup(tasks) {
  return JSON.stringify({app:'memonote', version:1, exportedAt:new Date().toISOString(), tasks});
}

function completeTime(task) {
  return new Date(Date.parse(task.createdAt) + 1000).toISOString();
}

function assertSameRecords(actual, expected) {
  assert.equal(actual.length, expected.length);
  const expectedById = new Map(expected.map(task => [task.id, task]));
  assert.equal(new Set(actual.map(task => task.id)).size, actual.length);
  for (const task of actual) assert.deepEqual(task, expectedById.get(task.id));
}

test('Cycle 1 · 기한 없는 입력 → 수정·완료·취소 → 백업 → 삭제 항목 복구', () => {
  let state = core.parseMemo('내일 납품 자료 확인\n책상 정리\n[x] 자료 다운로드');
  assert.deepEqual(state.map(task => task.title), ['내일 납품 자료 확인', '책상 정리', '자료 다운로드']);
  assert.deepEqual(state.map(task => task.date), [null, null, null]);
  assert.deepEqual(state.map(task => task.done), [false, false, true]);
  const [firstId, secondId, thirdId] = state.map(task => task.id);

  state = core.normalizeTasks([
    {...state[0], title:'내일 납품 자료 확인 — 수정본', notes:'도면과 목록을 함께 확인\n담당자에게 물어볼 내용 정리', date:'2026-11-03', color:'sage'},
    state[1],
    state[2]
  ]);
  assert.deepEqual(state.map(task => task.date), ['2026-11-03', null, null]);
  state = core.normalizeTasks([
    {...state[0], done:true, completedAt:completeTime(state[0])}, state[1], state[2]
  ]);
  assert.deepEqual(core.statistics(state), {total:3, open:1, done:2, undated:2});

  const saved = backup(state);
  state = core.parseImport(saved);
  assert.equal(state[0].notes, '도면과 목록을 함께 확인\n담당자에게 물어볼 내용 정리');
  assert.equal(state[0].done, true);
  assert.equal(state[0].date, '2026-11-03');

  // 백업 후 사용자가 완료와 날짜를 취소했습니다. 오래된 백업은 이를 덮어쓰면 안 됩니다.
  state = core.normalizeTasks([
    {...state[0], done:false, completedAt:null, date:null}, state[1], state[2]
  ]);
  state = state.filter(task => task.id !== secondId);
  state = core.mergeImported(state, core.parseImport(saved));
  assert.deepEqual(state.map(task => task.id), [firstId, thirdId, secondId]);
  assert.equal(state[0].done, false);
  assert.equal(state[0].completedAt, null);
  assert.equal(state[0].date, null);
  assert.equal(state[2].title, '책상 정리');
  assert.deepEqual(core.statistics(state), {total:3, open:2, done:1, undated:3});
  assert.deepEqual(core.mergeImported(state, core.parseImport(saved)), state);
  assert.deepEqual(core.parseImport(backup(state)), state);
});

test('Cycle 2 · CRLF·같은 제목·HTML 원문 → 윤년 날짜 → 최신 수정 유지하며 병합', () => {
  const literalHTML = '<script>alert("메모")</script>';
  let state = core.parseMemo('\r\n1. 자료 모으기\r\n- [x] 도면 보내기\r\n- [ ] 자료 모으기\r\n' + literalHTML + '\r\n1.5배 검토\r\n-3도 조건 확인\r\n');
  assert.deepEqual(state.map(task => task.title), ['자료 모으기', '도면 보내기', '자료 모으기', literalHTML, '1.5배 검토', '-3도 조건 확인']);
  assert.deepEqual(state.map(task => task.done), [false, true, false, false, false, false]);
  assert.ok(state.every(task => task.date === null));
  assert.notEqual(state[0].id, state[2].id);
  const htmlId = state[3].id;
  const editedId = state[2].id;
  const notes = '검토 사항 🔧\n<img src=x onerror="메모 원문">\nA & B, "인용", [x]';

  state = core.normalizeTasks([
    {...state[0], notes, date:'2028-02-29', color:'blue'}, ...state.slice(1)
  ]);
  const saved = '\uFEFF' + backup(state);
  const reopened = core.parseImport(saved);
  assert.equal(reopened[0].notes, notes);
  assert.equal(reopened[0].date, '2028-02-29');
  assert.equal(reopened[3].title, literalHTML);
  state = core.normalizeTasks(state.map(task => task.id === editedId
    ? {...task, title:'자료 모으기 — 현장용', done:true, completedAt:completeTime(task)}
    : task));

  // 같은 제목의 새 메모는 별도 항목이며, 삭제한 HTML 모양의 문자열도 손실 없이 복구됩니다.
  const additional = core.parseMemo('자료 모으기')[0];
  state = state.filter(task => task.id !== htmlId);
  state = core.mergeImported(state, core.parseImport(saved).concat(additional));
  assert.equal(state.length, 7);
  assert.equal(state.filter(task => task.title === '자료 모으기').length, 2);
  assert.equal(state.find(task => task.id === editedId).title, '자료 모으기 — 현장용');
  assert.equal(state.find(task => task.id === editedId).done, true);
  assert.equal(state.find(task => task.id === htmlId).title, literalHTML);
  assert.deepEqual(core.statistics(state), {total:7, open:5, done:2, undated:6});
  assert.equal(new Set(state.map(task => task.id)).size, 7);
  assert.deepEqual(core.parseImport(backup(state)), state);
  assert.deepEqual(core.mergeImported(state, core.parseImport(saved).concat(additional)), state);
});

test('Cycle 3 · 잘못된 날짜·오염 백업 거절 → 정상 입력 재개 → 두 항목 복구', () => {
  let state = core.parseMemo('다음 주 점검\n2026-02-29라고 적어 둔 메모\n[x] 일지 정리');
  assert.deepEqual(state.map(task => task.date), [null, null, null]);
  assert.equal(state[1].title, '2026-02-29라고 적어 둔 메모');
  const beforeInvalidEntry = core.parseImport(backup(state));
  for (const date of ['2026-02-29', '2026-04-31', '1900-02-29']) {
    assert.throws(() => {
      const addition = core.parseMemo('달력 확인', {date});
      state = core.normalizeTasks(state.concat(addition));
    }, /날짜/);
    assert.deepEqual(state, beforeInvalidEntry);
  }
  const leapTask = core.parseMemo('윤년 점검', {date:'2000-02-29', color:'rose'})[0];
  state = core.normalizeTasks(state.concat({...leapTask, done:true, completedAt:completeTime(leapTask)}));
  assert.deepEqual(core.statistics(state), {total:4, open:2, done:2, undated:3});
  const soundState = core.parseImport(backup(state));

  // 첫 항목이 정상이더라도 다음 항목에 잘못된 날짜가 있으면 부분 적용하지 않습니다.
  const incoming = [
    core.parseMemo('가져오기로 추가될 항목')[0],
    {...state[0], id:'cycle-3-invalid-date', date:'2026-02-29'}
  ];
  assert.throws(() => {
    const parsed = core.parseImport(backup(incoming));
    state = core.mergeImported(state, parsed);
  }, /날짜/);
  assert.deepEqual(state, soundState);

  incoming[1].date = '2028-02-29';
  state = core.mergeImported(state, core.parseImport(backup(incoming)));
  state = core.normalizeTasks(state.map(task => task.id === leapTask.id
    ? {...task, done:false, completedAt:null, date:null}
    : task));
  assert.deepEqual(core.statistics(state), {total:6, open:5, done:1, undated:5});
  const finalBackup = backup(state);
  const finalRecords = core.parseImport(finalBackup);
  const deletedIds = new Set([state[0].id, leapTask.id]);
  state = state.filter(task => !deletedIds.has(task.id));
  assert.equal(state.length, 4);
  state = core.mergeImported(state, core.parseImport(finalBackup));
  assertSameRecords(state, finalRecords);
  assert.deepEqual(core.mergeImported(state, core.parseImport(finalBackup)), state);
  assert.deepEqual(core.parseImport(backup(state)), state);
});
