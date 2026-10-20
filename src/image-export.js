/* 메모 보드를 PNG로 저장합니다. 외부 라이브러리와 네트워크를 사용하지 않습니다. */
(function (root) {
  'use strict';

  const WIDTH = 1440;
  const PADDING = 72;
  const GAP = 28;
  const CARD_WIDTH = (WIDTH - PADDING * 2 - GAP) / 2;
  const MAX_HEIGHT = 20000;
  const MAX_PIXELS = 24000000;
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const COLORS = Object.freeze({sand: '#fff1d6', sage: '#e2ece3', blue: '#e6edf8', rose: '#f4e5e3'});
  const TEXT = '#25332e';
  const MUTED = '#65746b';
  const TOO_LARGE = '한 이미지에 담기에는 메모가 많거나 길어요. 상태 필터나 검색으로 범위를 줄인 뒤 다시 저장해 주세요.';
  const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', {granularity: 'grapheme'}) : null;

  function setFont(ctx, size, weight) {
    ctx.font = String(weight || 400) + ' ' + size + 'px ' + FONT;
  }

  function graphemes(text) {
    return graphemeSegmenter ? Array.from(graphemeSegmenter.segment(text), item => item.segment) : Array.from(text);
  }

  // 공백 없는 한글·긴 단어·이모지도 줄 밖으로 잘리지 않도록 글자 단위로 측정합니다.
  function wrapText(ctx, text, maxWidth) {
    if (!(maxWidth > 0)) throw new Error('이미지의 글자 영역을 만들 수 없어요.');
    const lines = [];
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      if (!paragraph.length) { lines.push(''); continue; }
      let line = '';
      for (const part of graphemes(paragraph)) {
        if (line && ctx.measureText(line + part).width > maxWidth) {
          lines.push(line);
          line = part;
        } else {
          line += part;
        }
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  function checkedDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('메모에 올바르지 않은 날짜가 있어요. 날짜를 수정한 뒤 저장해 주세요.');
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const check = new Date(0);
    check.setUTCFullYear(year, month - 1, day);
    check.setUTCHours(0, 0, 0, 0);
    if (year < 1 || month < 1 || month > 12 || day < 1 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      throw new Error('메모에 올바르지 않은 날짜가 있어요. 날짜를 수정한 뒤 저장해 주세요.');
    }
    return value.slice(0, 4) + '. ' + value.slice(5, 7) + '. ' + value.slice(8, 10);
  }

  function checkSize(height) {
    if (height > MAX_HEIGHT || WIDTH * height > MAX_PIXELS) throw new Error(TOO_LARGE);
  }

  function planCard(ctx, task) {
    if (!task || typeof task.title !== 'string' || (task.notes !== undefined && typeof task.notes !== 'string')) {
      throw new Error('이미지로 저장할 메모 내용을 확인해 주세요.');
    }
    if ((task.title.length + (task.notes || '').length) > 120000) throw new Error(TOO_LARGE);
    const bodyWidth = CARD_WIDTH - 64;
    setFont(ctx, 30, 600);
    const titleLines = wrapText(ctx, task.title, bodyWidth);
    setFont(ctx, 21, 400);
    const notesLines = task.notes ? wrapText(ctx, task.notes, bodyWidth) : [];
    const dateLabel = checkedDate(task.date);
    const titleHeight = titleLines.length * 44;
    const notesHeight = notesLines.length ? 20 + notesLines.length * 32 : 0;
    const height = Math.max(210, 76 + titleHeight + notesHeight + (dateLabel ? 60 : 0) + 32);
    checkSize(height + 400);
    return {task, titleLines, notesLines, dateLabel, height};
  }

  function planBoard(ctx, tasks, options) {
    options = options || {};
    if (!Array.isArray(tasks)) throw new Error('이미지로 저장할 메모 목록이 필요해요.');
    if (!tasks.length) throw new Error('저장할 메모가 없어요. 메모를 추가하거나 검색 조건을 바꿔 주세요.');
    if (tasks.some(task => !task || typeof task.title !== 'string' || typeof task.done !== 'boolean')) {
      throw new Error('이미지로 저장할 메모 내용을 확인해 주세요.');
    }
    // 최소 카드 크기만으로도 넘는 경우 큰 목록 전체를 측정하지 않습니다.
    checkSize(Math.ceil(tasks.length / 2) * 210 + 380);
    const title = typeof options.title === 'string' && options.title.trim() ? options.title.trim() : '메모 한눈에';
    const filterLabel = typeof options.filterLabel === 'string' && options.filterLabel.trim() ? options.filterLabel.trim() : '전체 메모';
    if (title.length > 1000 || filterLabel.length > 1000) throw new Error('이미지 제목이 너무 길어요. 제목을 짧게 바꿔 주세요.');
    setFont(ctx, 48, 700);
    const titleLines = wrapText(ctx, title, WIDTH - PADDING * 2 - 240);
    setFont(ctx, 22, 400);
    const filterLines = wrapText(ctx, filterLabel, WIDTH - PADDING * 2 - 240);
    const headerHeight = 56 + titleLines.length * 66 + 16 + filterLines.length * 32 + 72;
    const groups = [
      {label: '아직 안 끝낸 일', done: false, tasks: tasks.filter(task => !task.done)},
      {label: '끝낸 일', done: true, tasks: tasks.filter(task => task.done)}
    ].filter(group => group.tasks.length);
    let y = headerHeight;
    const sections = [];
    for (const group of groups) {
      const headingY = y;
      y += 60;
      const rows = [];
      for (let i = 0; i < group.tasks.length; i += 2) {
        const cards = group.tasks.slice(i, i + 2).map(task => planCard(ctx, task));
        const rowHeight = Math.max(...cards.map(card => card.height));
        rows.push({y, height: rowHeight, cards});
        y += rowHeight + GAP;
        checkSize(y + PADDING + 48);
      }
      sections.push({label: group.label, done: group.done, count: group.tasks.length, headingY, rows});
      y += 28;
    }
    const height = Math.ceil(y + 64);
    checkSize(height);
    return {width: WIDTH, height, titleLines, filterLines, headerHeight, sections, count: tasks.length, open: tasks.filter(task => !task.done).length, done: tasks.filter(task => task.done).length, isDemo: !!options.isDemo};
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function pill(ctx, label, x, y, fill, color, fontSize) {
    setFont(ctx, fontSize || 18, 500);
    const width = Math.ceil(ctx.measureText(label).width + 28);
    roundedRect(ctx, x, y, width, 34, 17);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, x + 14, y + 6);
    return width;
  }

  function checkbox(ctx, x, y, done, size) {
    roundedRect(ctx, x, y, size, size, 7);
    if (done) {
      ctx.fillStyle = '#587a64';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(x + size * 0.24, y + size * 0.50);
      ctx.lineTo(x + size * 0.43, y + size * 0.70);
      ctx.lineTo(x + size * 0.77, y + size * 0.30);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
      ctx.strokeStyle = '#8b9b90';
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }
  }

  function drawCard(ctx, planned, x, y, height) {
    const task = planned.task;
    ctx.save();
    ctx.shadowColor = 'rgba(37,51,46,0.055)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    roundedRect(ctx, x, y, CARD_WIDTH, height, 20);
    ctx.fillStyle = task.done ? '#eaf0e9' : (COLORS[task.color] || COLORS.sand);
    ctx.fill();
    ctx.restore();
    checkbox(ctx, x + 32, y + 28, !!task.done, 26);
    setFont(ctx, 18, 500);
    ctx.fillStyle = task.done ? '#4e6a57' : MUTED;
    ctx.fillText(task.done ? '완료' : '미완료', x + 70, y + 30);
    if (task.pinned) {
      setFont(ctx, 16, 500);
      const label = '상단 고정';
      ctx.fillText(label, x + CARD_WIDTH - 32 - ctx.measureText(label).width, y + 32);
    }
    let textY = y + 76;
    setFont(ctx, 30, 600);
    ctx.fillStyle = task.done ? '#586a5e' : TEXT;
    for (const line of planned.titleLines) {
      ctx.fillText(line, x + 32, textY);
      if (task.done && line.length) {
        ctx.strokeStyle = 'rgba(88,106,94,0.65)';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(x + 32, textY + 18);
        ctx.lineTo(x + 32 + ctx.measureText(line).width, textY + 18);
        ctx.stroke();
      }
      textY += 44;
    }
    if (planned.notesLines.length) {
      textY += 20;
      setFont(ctx, 21, 400);
      ctx.fillStyle = MUTED;
      for (const line of planned.notesLines) {
        ctx.fillText(line, x + 32, textY);
        textY += 32;
      }
    }
    if (planned.dateLabel) {
      pill(ctx, planned.dateLabel, x + 32, y + height - 62, 'rgba(255,255,255,0.60)', task.done ? '#607364' : '#596a60', 18);
    }
  }

  function drawBoard(ctx, plan) {
    ctx.textBaseline = 'top';
    ctx.lineCap = 'round';
    ctx.fillStyle = '#f6f5f0';
    ctx.fillRect(0, 0, plan.width, plan.height);
    setFont(ctx, 16, 600);
    ctx.fillStyle = '#718578';
    ctx.fillText('MY MEMO BOARD', PADDING, 36);
    setFont(ctx, 48, 700);
    ctx.fillStyle = TEXT;
    let y = 82;
    for (const line of plan.titleLines) { ctx.fillText(line, PADDING, y); y += 66; }
    y += 12;
    setFont(ctx, 22, 400);
    ctx.fillStyle = MUTED;
    for (const line of plan.filterLines) { ctx.fillText(line, PADDING, y); y += 32; }
    const sideX = WIDTH - PADDING - 160;
    if (plan.isDemo) pill(ctx, '예시 화면', sideX, 38, '#e1e9df', '#536a57', 18);
    setFont(ctx, 54, 650);
    ctx.fillStyle = TEXT;
    ctx.fillText(String(plan.count), sideX, 98);
    setFont(ctx, 19, 400);
    ctx.fillStyle = MUTED;
    ctx.fillText('개의 메모', sideX, 160);
    ctx.strokeStyle = '#d9dfd7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING, plan.headerHeight - 24);
    ctx.lineTo(WIDTH - PADDING, plan.headerHeight - 24);
    ctx.stroke();
    for (const section of plan.sections) {
      checkbox(ctx, PADDING, section.headingY + 1, section.done, 28);
      setFont(ctx, 27, 600);
      ctx.fillStyle = TEXT;
      ctx.fillText(section.label, PADDING + 44, section.headingY);
      const labelWidth = ctx.measureText(section.label).width;
      pill(ctx, String(section.count), PADDING + 58 + labelWidth, section.headingY - 1, '#e6ebe3', '#516858', 18);
      for (const row of section.rows) {
        row.cards.forEach((card, index) => drawCard(ctx, card, PADDING + index * (CARD_WIDTH + GAP), row.y, row.height));
      }
    }
    setFont(ctx, 17, 400);
    ctx.fillStyle = '#7c8b7f';
    ctx.fillText(plan.isDemo ? '예시 메모 · 메모 한눈에' : '메모 한눈에', PADDING, plan.height - 52);
  }

  async function createCanvas(tasks, options) {
    options = options || {};
    if (typeof document === 'undefined') throw new Error('이미지 저장은 브라우저에서 사용할 수 있어요.');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이 브라우저에서 이미지 만들기를 사용할 수 없어요.');
    const plan = planBoard(ctx, tasks, options);
    canvas.width = plan.width;
    canvas.height = plan.height;
    try {
      drawBoard(ctx, plan);
    } catch (error) {
      canvas.width = 1;
      canvas.height = 1;
      throw new Error('이미지를 만들 공간이 부족해요. 표시할 메모를 줄인 뒤 다시 시도해 주세요.');
    }
    return {canvas, count: plan.count, width: plan.width, height: plan.height};
  }

  // 이미지 준비와 저장·공유를 나눕니다. 아이폰의 공유 창은 준비가 끝난 뒤
  // 사용자가 별도 버튼을 직접 눌렀을 때 열어야 합니다.
  async function prepareImage(tasks, options) {
    const result = await createCanvas(tasks, options);
    let blob;
    try {
      blob = await new Promise((resolve, reject) => {
        try {
          result.canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 이미지를 만들지 못했어요. 표시할 메모를 줄인 뒤 다시 시도해 주세요.')), 'image/png');
        } catch (error) { reject(error); }
      });
    } catch (error) {
      throw new Error(error && error.message ? error.message : 'PNG 이미지를 만들지 못했어요. 다시 시도해 주세요.');
    } finally {
      // PNG로 인코딩한 뒤 큰 캔버스의 메모리를 바로 반환합니다.
      result.canvas.width = 1;
      result.canvas.height = 1;
    }
    const now = new Date();
    const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    const fileName = 'Memo_Board_' + stamp + '.png';
    const file = typeof File === 'function' ? new File([blob], fileName, {type: 'image/png'}) : null;
    return {blob, file, fileName, count: result.count, width: result.width, height: result.height};
  }

  function canShareImage(prepared) {
    if (!prepared || !prepared.file || typeof navigator === 'undefined' ||
        typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    try { return navigator.canShare({files: [prepared.file]}); }
    catch (error) { return false; }
  }

  // 클릭 이벤트 안에서 바로 호출합니다. 호출 전에 await를 넣지 않습니다.
  // AbortError는 사용자의 취소로 구분할 수 있도록 그대로 전달합니다.
  function shareImage(prepared) {
    if (!canShareImage(prepared)) {
      return Promise.reject(new Error('이 브라우저에서는 이미지 공유를 사용할 수 없어요. 이미지 다운로드를 이용해 주세요.'));
    }
    return navigator.share({files: [prepared.file], title: '메모 한눈에'});
  }

  function downloadImage(prepared) {
    if (!prepared || !prepared.blob || typeof prepared.fileName !== 'string') {
      throw new Error('저장할 이미지를 먼저 만들어 주세요.');
    }
    let url;
    let anchor;
    try {
      url = URL.createObjectURL(prepared.blob);
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = prepared.fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      throw new Error('이미지 다운로드를 시작하지 못했어요. 브라우저의 다운로드 설정을 확인해 주세요.');
    } finally {
      if (anchor) anchor.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return {fileName: prepared.fileName, count: prepared.count, width: prepared.width, height: prepared.height};
  }

  async function exportImage(tasks, options) {
    const prepared = await prepareImage(tasks, options);
    return downloadImage(prepared);
  }

  const api = Object.freeze({exportImage, prepareImage, canShareImage, shareImage, downloadImage, createCanvas, wrapText, planBoard});
  root.MemoImage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
