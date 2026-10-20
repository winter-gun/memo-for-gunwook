(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MemoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 원문에 적힌 날짜는 제목에 그대로 남깁니다. 날짜 지정은 사용자의 선택으로만 합니다.
  const COLORS = Object.freeze(['sand', 'sage', 'blue', 'rose']);
  const LIMITS = Object.freeze({ tasks: 5000, title: 2000, notes: 20000, inputCharacters: 1000000, importBytes: 4000000 });
  const FIELDS = ['id', 'title', 'notes', 'done', 'date', 'color', 'createdAt', 'completedAt', 'pinned'];
  let idCounter = 0;

  function fail(message) { throw new Error(message); }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  // 원문은 그대로 두고, 보이지 않는 문자만 있는 줄과 검색 비교만 따로 처리합니다.
  function hasVisibleText(value) { return /[^\s\p{Default_Ignorable_Code_Point}]/u.test(value); }
  function searchKey(value) { return value.normalize('NFC').toLocaleLowerCase('ko-KR'); }
  function hasInvalidControls(value) { return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F]/u.test(value); }

  function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    idCounter += 1;
    return 'memo-' + Date.now().toString(36) + '-' + idCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function validateDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parts = value.split('-').map(Number);
    const year = parts[0], month = parts[1], day = parts[2];
    if (year < 1 || month < 1 || month > 12 || day < 1) return null;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= monthDays[month - 1] ? value : null;
  }

  function explicitDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const valid = validateDate(value);
    if (!valid) fail('날짜는 실제 달력에 있는 YYYY-MM-DD 형식으로 지정해 주세요.');
    return valid;
  }

  function validTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
    if (!validateDate(value.slice(0, 10))) return false;
    const h = Number(value.slice(11, 13)), m = Number(value.slice(14, 16)), s = Number(value.slice(17, 19));
    return h <= 23 && m <= 59 && s <= 59 && Number.isFinite(Date.parse(value));
  }

  function parseMemo(text, options) {
    if (typeof text !== 'string') fail('메모는 문자열이어야 합니다.');
    if (text.length > LIMITS.inputCharacters) fail('한 번에 입력할 수 있는 메모 길이를 초과했습니다.');
    if (hasInvalidControls(text)) fail('메모에 지원하지 않는 제어문자가 있어요. 내용을 확인한 뒤 다시 붙여넣어 주세요.');
    const opts = options === undefined ? {} : options;
    if (!plainObject(opts)) fail('메모 옵션의 형식이 올바르지 않습니다.');
    const date = explicitDate(opts.date);
    const color = opts.color === undefined ? 'sand' : opts.color;
    if (!COLORS.includes(color)) fail('지원하지 않는 카드 색상입니다.');
    const now = new Date().toISOString();
    const tasks = [];
    const lines = text.split(/\r\n|[\n\r\u0085\u2028\u2029]/u);
    for (let line of lines) {
      line = line.trim();
      if (!hasVisibleText(line)) continue;
      // 공백이 뒤따르는 목록 기호만 지워서 -3, 1.5 같은 본문 숫자를 보존합니다.
      line = line.replace(/^(?:[-*+•▪◦‣]\s+|\d{1,4}[.)]\s+)/u, '').trim();
      const checkbox = line.match(/^\[([ xX✓])\](?:\s+|$)/u);
      const done = !!checkbox && checkbox[1] !== ' ';
      if (checkbox) line = line.slice(checkbox[0].length).trim();
      if (!hasVisibleText(line)) continue;
      if (line.length > LIMITS.title) fail('한 항목은 ' + LIMITS.title + '자 이내로 적어 주세요.');
      tasks.push({ id: newId(), title: line, notes: '', done: done, date: date, color: color, createdAt: now, completedAt: done ? now : null, pinned: false });
      if (tasks.length > LIMITS.tasks) fail('한 번에 등록할 수 있는 항목은 최대 ' + LIMITS.tasks + '개입니다.');
    }
    return tasks;
  }

  function normalizeTasks(input) {
    if (!Array.isArray(input)) fail('할 일 목록은 배열이어야 합니다.');
    if (input.length > LIMITS.tasks) fail('저장할 수 있는 항목은 최대 ' + LIMITS.tasks + '개입니다.');
    const ids = new Set();
    return input.map(function (row, index) {
      const label = (index + 1) + '번째 항목: ';
      if (!plainObject(row)) fail(label + '항목 형식이 올바르지 않습니다.');
      if (FIELDS.some(function (key) { return !own(row, key); })) fail(label + '필수 정보가 빠져 있습니다.');
      if (Object.keys(row).some(function (key) { return !FIELDS.includes(key); })) fail(label + '지원하지 않는 추가 정보가 있습니다.');
      if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(row.id)) fail(label + '고유번호가 올바르지 않습니다.');
      if (ids.has(row.id)) fail(label + '고유번호가 중복되었습니다.');
      ids.add(row.id);
      if (typeof row.title !== 'string' || !hasVisibleText(row.title) || row.title.length > LIMITS.title || hasInvalidControls(row.title)) fail(label + '메모 내용이 비어 있거나 너무 길거나 지원하지 않는 제어문자가 있습니다.');
      if (typeof row.notes !== 'string' || row.notes.length > LIMITS.notes || hasInvalidControls(row.notes)) fail(label + '상세 메모 형식이나 길이 또는 제어문자를 확인해 주세요.');
      if (typeof row.done !== 'boolean' || typeof row.pinned !== 'boolean') fail(label + '완료 또는 고정 상태가 올바르지 않습니다.');
      if (row.date !== null && validateDate(row.date) === null) fail(label + '지정 날짜가 올바르지 않습니다.');
      if (!COLORS.includes(row.color)) fail(label + '카드 색상이 올바르지 않습니다.');
      if (!validTimestamp(row.createdAt)) fail(label + '작성 시각이 올바르지 않습니다.');
      if (row.done ? !validTimestamp(row.completedAt) : row.completedAt !== null) fail(label + '완료 상태와 완료 시각이 맞지 않습니다.');
      if (row.done && Date.parse(row.completedAt) < Date.parse(row.createdAt)) fail(label + '완료 시각이 작성 시각보다 빠릅니다.');
      return { id: row.id, title: row.title, notes: row.notes, done: row.done, date: row.date, color: row.color, createdAt: row.createdAt, completedAt: row.completedAt, pinned: row.pinned };
    });
  }

  function byteLength(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8');
    return new Blob([value]).size;
  }

  function parseImport(text) {
    if (typeof text !== 'string') fail('백업 파일은 텍스트 형식이어야 합니다.');
    if (byteLength(text) > LIMITS.importBytes) fail('백업 파일은 4MB 이하여야 합니다.');
    let data;
    try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch (error) { fail('백업 파일을 읽지 못했습니다. JSON 파일을 선택해 주세요.'); }
    if (!plainObject(data) || data.app !== 'memonote' || data.version !== 1 || !own(data, 'tasks')) fail('이 메모 도구의 버전 1 백업 파일이 아닙니다.');
    return normalizeTasks(data.tasks);
  }

  function statistics(tasks) {
    let done = 0, undated = 0;
    for (const task of tasks) { if (task.done) done += 1; if (task.date === null) undated += 1; }
    return { total: tasks.length, open: tasks.length - done, done: done, undated: undated };
  }

  function mergeImported(existing, incoming) {
    const current = normalizeTasks(existing);
    const added = normalizeTasks(incoming);
    const known = new Set(current.map(function (task) { return task.id; }));
    // 같은 제목은 별개의 일일 수 있습니다. 고유번호가 같은 백업 항목만 건너뜁니다.
    const result = current.concat(added.filter(function (task) { return !known.has(task.id); }));
    if (result.length > LIMITS.tasks) fail('가져오기 후 항목 수가 최대 ' + LIMITS.tasks + '개를 초과합니다.');
    return result;
  }

  return Object.freeze({ parseMemo: parseMemo, validateDate: validateDate, normalizeTasks: normalizeTasks, parseImport: parseImport, statistics: statistics, mergeImported: mergeImported, searchKey: searchKey, hasVisibleText: hasVisibleText, COLORS: COLORS, LIMITS: LIMITS });
});
