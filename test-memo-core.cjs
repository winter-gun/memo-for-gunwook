'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./src/memo-core.js');

function backup(tasks) { return JSON.stringify({ app: 'memonote', version: 1, exportedAt: new Date().toISOString(), tasks }); }

test('날짜 없는 메모와 상대 날짜 표현에 날짜를 임의로 배정하지 않는다', () => {
  const rows = core.parseMemo('자료 정리\n내일 보고서 보기\n다음 주 금요일 운동\n2026-10-23 시험 준비');
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.date === null));
  assert.equal(rows[1].title, '내일 보고서 보기');
  assert.equal(rows[3].title, '2026-10-23 시험 준비');
  assert.ok(rows.every(row => !row.done && row.completedAt === null));
});

test('날짜는 사용자의 올바른 명시적 지정만 반영한다', () => {
  assert.equal(core.parseMemo('보고서', { date: '2028-02-29', color: 'sage' })[0].date, '2028-02-29');
  assert.equal(core.parseMemo('보고서', { date: '' })[0].date, null);
  for (const value of ['2026-02-29', '2026-04-31', '2026-00-12', '2026-13-01', '2026-01-00', '0000-01-01', '2026-1-1', 'tomorrow']) {
    assert.equal(core.validateDate(value), null);
    assert.throws(() => core.parseMemo('보고서', { date: value }));
  }
  assert.equal(core.validateDate('2000-02-29'), '2000-02-29');
  assert.equal(core.validateDate('1900-02-29'), null);
});

test('명시적인 체크박스만 완료로 읽고 자연어 완료 표현은 보존한다', () => {
  const rows = core.parseMemo('- [x] 견적서 보내기\n- [ ] 보고서 정리\n[✓] 책 반납\n보고서 완료\n1. 일 하나\n2) 일 둘\n• 일 셋\n-3도 확인\n1.5배 검토');
  assert.deepEqual(rows.map(row => row.done), [true, false, true, false, false, false, false, false, false]);
  assert.deepEqual(rows.slice(4).map(row => row.title), ['일 하나', '일 둘', '일 셋', '-3도 확인', '1.5배 검토']);
  assert.ok(rows[0].completedAt);
  assert.equal(rows[3].completedAt, null);
  assert.deepEqual(core.parseMemo(' \n- [ ]\n\n'), []);
});

test('같은 문장을 다시 입력해도 서로 다른 할 일로 보존한다', () => {
  const rows = core.parseMemo('자료 정리\n자료 정리');
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
});

test('정상 백업을 내용 변경 없이 가져오며 객체 참조를 공유하지 않는다', () => {
  const rows = core.parseMemo('메모\n[x] 끝난 메모', { date: '2026-10-20' });
  rows[0].notes = '첫째 줄\n둘째 줄 <script> 원문';
  const restored = core.parseImport('\uFEFF' + backup(rows));
  assert.deepEqual(restored, rows);
  assert.notEqual(restored[0], rows[0]);
});

test('백업의 한 항목이라도 잘못되면 전체를 거절한다', () => {
  const rows = core.parseMemo('첫 메모\n둘째 메모');
  for (const mutate of [
    row => { row.date = '2026-02-30'; },
    row => { row.done = 'false'; },
    row => { row.title = ''; },
    row => { delete row.notes; },
    row => { row.createdAt = '2026-02-30T00:00:00.000Z'; },
    row => { row.completedAt = new Date().toISOString(); },
    row => { row.surprise = '보존되지 않을 추가 정보'; }
  ]) {
    const bad = JSON.parse(JSON.stringify(rows));
    mutate(bad[1]);
    assert.throws(() => core.parseImport(backup(bad)));
  }
  assert.throws(() => core.parseImport(backup([rows[0], rows[0]])));
  assert.throws(() => core.parseImport('{bad json}'));
  assert.throws(() => core.parseImport(JSON.stringify({ app: 'other', version: 1, tasks: rows })));
  assert.throws(() => core.parseImport(JSON.stringify({ app: 'memonote', version: 2, tasks: rows })));
});

test('백업 병합은 기존 데이터를 보존하고 같은 ID만 건너뛴다', () => {
  const existing = core.parseMemo('똑같은 제목');
  const newTask = core.parseMemo('똑같은 제목')[0];
  const modifiedExisting = { ...existing[0], title: '백업의 오래된 제목' };
  const result = core.mergeImported(existing, [modifiedExisting, newTask]);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, '똑같은 제목');
  assert.equal(result[1].id, newTask.id);
  assert.deepEqual(core.mergeImported(result, [modifiedExisting, newTask]), result);
  assert.equal(existing.length, 1);
});

test('통계는 완료/미완료와 날짜 없음의 의미를 일관되게 계산한다', () => {
  const rows = core.parseMemo('[x] 완료\n진행\n또 다른 일');
  rows[2].date = '2026-12-01';
  assert.deepEqual(core.statistics(rows), { total: 3, open: 2, done: 1, undated: 2 });
  assert.deepEqual(core.statistics([]), { total: 0, open: 0, done: 0, undated: 0 });
});

test('너무 큰 입력과 가져오기는 오류를 내고 자동으로 자르지 않는다', () => {
  assert.throws(() => core.parseMemo('가'.repeat(core.LIMITS.title + 1)));
  assert.throws(() => core.parseMemo(Array(core.LIMITS.tasks + 1).fill('할 일').join('\n')));
  assert.throws(() => core.parseImport('가'.repeat(Math.ceil(core.LIMITS.importBytes / 3) + 1)));
});
