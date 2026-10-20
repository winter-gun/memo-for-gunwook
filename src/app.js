(function () {
  'use strict';

  // LLM·외부 추론 API 없이, 직접 작성한 로직과 브라우저 저장 공간을 사용합니다.
  const Core = window.MemoCore;
  const KEY = 'memo-for-gunwook.local.v1';
  const $ = (id) => document.getElementById(id);
  const names = {all: '전체 메모', open: '아직 안 끝낸 일', done: '끝낸 일', undated: '날짜 없는 메모'};
  let tasks = [];
  let demo = false;
  let demoTasks = [];
  let view = 'cards';
  let filter = 'all';
  let sort = 'newest';
  let color = 'sand';
  let editColor = 'sand';
  let editId = null;
  let editOriginal = null;
  let toastTimer;
  let undoAction = null;
  let brokenData = null;
  let memoryOnly = false;
  let unsavedChanges = false;
  let preparedExport = null;
  let previewURL = null;
  let exportKind = 'image';

  function icon(name) { return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); }
  function clone(list) { return list.map(task => ({...task})); }
  function displayedTasks() { return demo ? demoTasks : tasks; }
  function currentDate() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  }
  function exportText(list) { return JSON.stringify({app:'memonote', version:1, exportedAt:new Date().toISOString(), tasks:list}, null, 2); }
  function stampDone(task) { return new Date(Math.max(Date.now(), Date.parse(task.createdAt))).toISOString(); }

  function showToast(message, undo) {
    clearTimeout(toastTimer);
    $('toastText').textContent = message;
    undoAction = undo || null;
    $('undoButton').hidden = !undoAction;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; undoAction = null; }, undo ? 13000 : 5000);
  }
  function showInputError(message) { $('composeError').textContent = message; $('composeError').hidden = !message; }

  function showStorageState() {
    $('saveText').textContent = brokenData !== null ? '저장 데이터 확인 필요' : demo ? '예시 화면' : memoryOnly ? '임시 보관 중 · 백업 권장' : '이 브라우저에 저장됨';
    $('saveState').querySelector('.status-dot').style.background = brokenData !== null || memoryOnly ? '#bc8653' : '#76976d';
    $('storageNotice').hidden = brokenData === null && !memoryOnly;
    $('recoverButton').hidden = brokenData === null;
    $('resetStorageButton').hidden = brokenData === null;
    $('storageNoticeText').textContent = brokenData !== null
      ? '기존 저장 데이터를 읽지 못했어요. 원본은 그대로 보존했습니다. 내려받아 보관한 뒤 새 목록을 시작할 수 있어요.'
      : '자동 저장을 사용할 수 없어 지금은 화면에만 보관 중이에요. 창을 닫기 전에 백업 파일로 저장해 주세요.';
    $('addButton').disabled = brokenData !== null;
    $('footerText').textContent = demo ? '예시 메모는 내 목록으로 저장되지 않습니다.' : memoryOnly ? '임시 보관 중입니다. 백업 메뉴에서 파일로 저장해 주세요.' : '외부 전송 없이, 이 브라우저 안에 저장됩니다.';
  }

  function persist() {
    if (demo || brokenData !== null) { showStorageState(); return; }
    try {
      localStorage.setItem(KEY, JSON.stringify({app:'memonote', version:1, tasks, preferences:{view,filter,sort}}));
      memoryOnly = false;
      unsavedChanges = false;
    } catch (error) {
      memoryOnly = true;
      unsavedChanges = true;
    }
    showStorageState();
  }

  function validateList(next) {
    const validated = Core.normalizeTasks(next);
    if (new Blob([exportText(validated)]).size > Core.LIMITS.importBytes) throw new Error('메모의 전체 용량이 4MB를 넘어요. 백업한 뒤 불필요한 메모를 정리해 주세요.');
    return validated;
  }

  // 변경은 항상 완성된 목록 단위로 검증한 다음 저장합니다. 날짜를 생성하는 단계는 없습니다.
  function commit(next, message, allowUndo) {
    if (brokenData !== null) { showToast('기존 저장 데이터를 먼저 확인해 주세요.'); return false; }
    try { next = validateList(next); }
    catch (error) { showToast(error.message); return false; }
    const before = clone(tasks);
    const wasDemo = demo;
    tasks = next;
    demo = false;
    persist();
    render();
    const committed = JSON.stringify(tasks);
    if (message) showToast(message, allowUndo ? () => {
      if (!refreshStoredTasks(false) || JSON.stringify(tasks) !== committed) {
        showToast('다른 창에서 목록이 변경되어 되돌릴 수 없어요. 최신 메모를 확인해 주세요.');
        return;
      }
      tasks = before;
      demo = wasDemo;
      if (demo) { try { localStorage.removeItem(KEY); } catch (_) {} }
      else persist();
      render();
      showToast('변경을 되돌렸어요.');
    } : null);
    return true;
  }

  function makeDemo() {
    const samples = [
      ['읽고 싶은 책 목록 정리하기', '마음에 드는 책을 발견할 때마다 조금씩 모아보기.', 'sand'],
      ['파이썬 예제 직접 실행해 보기', '실행 결과를 보고, 코드를 한 줄씩 바꿔보기.', 'sage'],
      ['책상 서랍 정리하기', '', 'blue'],
      ['관심 있는 자료 모아두기', '나중에 다시 읽고 싶은 내용들을 한곳에.', 'rose'],
      ['[x] 영수증 정리하기', '', 'sage'],
      ['[x] 필요한 물건 메모하기', '', 'sand']
    ];
    return samples.map((sample, i) => {
      const task = Core.parseMemo(sample[0], {color:sample[2]})[0];
      task.notes = sample[1];
      task.createdAt = new Date(Date.now() - i * 60000 - 3600000).toISOString();
      return task;
    });
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); }
    catch (_) { memoryOnly = true; }
    if (raw === null) { demo = true; demoTasks = makeDemo(); return; }
    try {
      const data = JSON.parse(raw);
      tasks = Core.parseImport(raw);
      const prefs = data.preferences || {};
      if (['cards','table'].includes(prefs.view)) view = prefs.view;
      if (Object.hasOwn(names, prefs.filter)) filter = prefs.filter;
      if (['newest','oldest','date'].includes(prefs.sort)) sort = prefs.sort;
    } catch (_) { brokenData = raw; tasks = []; }
  }

  function visibleTasks() {
    const query = Core.searchKey($('searchInput').value.trim());
    return displayedTasks().filter(task => {
      if (filter === 'open' && task.done) return false;
      if (filter === 'done' && !task.done) return false;
      if (filter === 'undated' && task.date !== null) return false;
      return !query || Core.searchKey(task.title + '\n' + task.notes).includes(query);
    }).sort((a,b) => {
      if (sort === 'date') {
        if (a.date !== b.date) return (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99');
      }
      return sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt);
    });
  }

  function dateBadge(task) {
    if (task.date === null) return '';
    const late = !task.done && task.date < currentDate();
    const label = task.date.replace(/-/g, '.');
    return '<span class="date-tag' + (late?' overdue':'') + '" title="' + label + (late?' · 기한 지남':'') + '">' + icon('calendar') + label + '</span>';
  }
  function checkBox(task) {
    return '<label class="check"><input type="checkbox" data-action="toggle" data-id="'+task.id+'" '+(task.done?'checked':'')+' aria-label="'+escapeHTML(task.title)+' '+(task.done?'완료 취소':'완료로 표시')+'"></label>';
  }
  function actions(task) {
    return '<button class="icon-button" data-action="edit" data-id="'+task.id+'" aria-label="'+escapeHTML(task.title)+' 수정" title="수정">'+icon('edit')+'</button><button class="icon-button" data-action="delete" data-id="'+task.id+'" aria-label="'+escapeHTML(task.title)+' 삭제" title="삭제">'+icon('trash')+'</button>';
  }
  function card(task, index) {
    return '<article class="memo-card '+task.color+(task.done?' is-done':'')+'"><div class="card-top"><span class="card-number">'+(task.done?'DONE':'NOTE')+' '+String(index+1).padStart(2,'0')+'</span>'+checkBox(task)+'</div><button class="card-title" data-action="edit" data-id="'+task.id+'">'+escapeHTML(task.title)+'</button>'+(task.notes?'<p class="card-notes">'+escapeHTML(task.notes)+'</p>':'')+'<div class="card-bottom">'+(task.done?'<span class="done-tag">'+icon('check')+'끝냈어요</span>':dateBadge(task))+'<div class="card-controls">'+actions(task)+'</div></div></article>';
  }
  function groupHeading(done, size) {
    return '<h3 class="group-header'+(done?' done':'')+'"><span class="group-dot"></span>'+(done?'끝낸 일':'아직 안 끝낸 일')+'<span class="count">'+size+'</span></h3>';
  }
  function table(list) {
    return '<div class="table-wrap"><table class="memo-table"><thead><tr><th><span class="sr-only">완료 여부</span></th><th>메모</th><th>날짜</th><th>상태</th><th><span class="sr-only">수정 및 삭제</span></th></tr></thead><tbody>'+list.map(task => '<tr class="'+(task.done?'is-done':'')+'"><td>'+checkBox(task)+'</td><td><button class="row-title" data-action="edit" data-id="'+task.id+'">'+escapeHTML(task.title)+'</button>'+(task.notes?'<div class="row-note">'+escapeHTML(task.notes)+'</div>':'')+'</td><td>'+(dateBadge(task)||'<span class="no-date" aria-label="날짜 없음">—</span>')+'</td><td><span class="state-chip'+(task.done?' done':'')+'">'+(task.done?'완료':'미완료')+'</span></td><td><div class="row-actions">'+actions(task)+'</div></td></tr>').join('')+'</tbody></table></div>';
  }

  function render() {
    const stats = Core.statistics(displayedTasks());
    $('countAll').textContent = stats.total;
    $('countOpen').textContent = stats.open;
    $('countDone').textContent = stats.done;
    $('countUndated').textContent = stats.undated;
    const percent = stats.total ? Math.round(stats.done/stats.total*100) : 0;
    $('progressValue').textContent = percent+'%';
    $('progressRing').style.background = 'conic-gradient(var(--green) '+percent*3.6+'deg,#e8ecdf 0deg)';
    $('progressRing').parentElement.setAttribute('aria-label', '전체 '+stats.total+'개 중 '+stats.done+'개 완료, '+percent+'%');
    $('progressCaption').textContent = stats.done+'개를 끝냈어요';
    document.querySelectorAll('[data-filter]').forEach(button => { if(button.dataset.filter===filter) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view===view)));
    $('sortSelect').value = sort;
    $('demoNotice').hidden = !demo;
    const list = visibleTasks();
    $('filterTitle').innerHTML = escapeHTML(names[filter])+' <span id="visibleCount">'+list.length+'</span>';
    $('imageButton').disabled = list.length === 0;
    $('exportButton').disabled = tasks.length === 0 || brokenData !== null;
    $('importButton').disabled = brokenData !== null;
    if (!list.length) {
      let title = '가볍게, 첫 메모를 남겨보세요.';
      let description = '날짜를 정하지 않아도 괜찮아요.<br>위에 적어두면, 끝낼 때까지 여기에 남습니다.';
      if (displayedTasks().length) {
        title = $('searchInput').value.trim() ? '찾는 메모가 없어요.' : filter==='done'?'아직 완료한 메모가 없어요.':filter==='open'?'적어둔 일을 모두 끝냈어요.':'이 분류에 메모가 없어요.';
        description = $('searchInput').value.trim()?'다른 검색어를 입력하거나 전체 메모에서 찾아보세요.':'다른 분류를 선택하거나 새 메모를 남겨보세요.';
      }
      $('board').innerHTML = '<div class="empty"><div class="empty-icon">'+icon('note')+'</div><h3>'+title+'</h3><p>'+description+'</p><button class="btn small" data-action="focus">메모 적으러 가기</button></div>';
    } else {
      $('board').innerHTML = [false,true].map(done => {
        const group = list.filter(t=>t.done===done);
        if (!group.length) return '';
        return '<section class="group" aria-label="'+(done?'끝낸 일':'아직 안 끝낸 일')+'">'+groupHeading(done, group.length)+(view==='cards'?'<div class="card-grid">'+group.map(card).join('')+'</div>':table(group))+'</section>';
      }).join('');
    }
    showStorageState();
  }

  function addMemo() {
    showInputError('');
    let additions;
    const selectedDate = $('newDate').value;
    if ($('newDate').validity.badInput || (selectedDate && !Core.validateDate(selectedDate))) { showInputError('지정한 날짜를 다시 확인해 주세요.'); return; }
    try { additions = Core.parseMemo($('memoInput').value, {date:selectedDate||null,color}); }
    catch(error) { showInputError(error.message); return; }
    if(!additions.length) { showInputError('추가할 메모를 한 줄 이상 적어 주세요.'); $('memoInput').focus(); return; }
    if(!refreshStoredTasks(false))return;
    const formerFilter=filter;
    filter='all';
    if(commit(additions.concat(tasks), additions.length+'개의 메모를 추가했어요.', true)) {
      $('memoInput').value='';
      $('searchInput').value='';
      clearNewDate();
      render();
      if (window.matchMedia('(pointer:coarse)').matches) $('memoInput').blur();
      else $('memoInput').focus();
    } else filter=formerFilter;
  }

  function changeDisplayed(next, message) {
    if(demo) {
      const before=clone(demoTasks);
      demoTasks=next;
      render();
      showToast('예시에서 '+message,()=>{demoTasks=before;render();showToast('예시 변경을 되돌렸어요.');});
    } else commit(next,message,true);
  }
  function toggleTask(id) {
    if(!refreshStoredTasks(false))return;
    const next=displayedTasks().map(task=>task.id===id?{...task,done:!task.done,completedAt:task.done?null:stampDone(task)}:task);
    const changed=next.find(task=>task.id===id);
    if(changed) changeDisplayed(next,changed.done?'완료로 표시했어요.':'미완료로 되돌렸어요.');
  }
  function deleteTask(id) {
    if(!refreshStoredTasks(false))return;
    if(!displayedTasks().some(task=>task.id===id)) return;
    changeDisplayed(displayedTasks().filter(task=>task.id!==id),'메모를 삭제했어요.');
  }
  function setColorButtons(container,selected) { container.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===selected))); }
  function openEdit(id) {
    if(!refreshStoredTasks(false))return;
    const task=displayedTasks().find(t=>t.id===id);
    if(!task) return;
    editId=id;
    editOriginal=JSON.stringify(task);
    editColor=task.color;
    $('editText').value=task.title;
    $('editNotes').value=task.notes;
    $('editDate').value=task.date||'';
    $('editDone').checked=task.done;
    $('editError').hidden=true;
    setColorButtons($('editColors'),editColor);
    $('editDialog').showModal();
  }
  function saveEdit(event) {
    event.preventDefault();
    if(!refreshStoredTasks(false))return;
    const original=displayedTasks().find(t=>t.id===editId);
    if(!original || JSON.stringify(original)!==editOriginal) { $('editError').textContent='다른 창에서 이 메모가 변경되었어요. 창을 닫고 최신 내용을 다시 열어 주세요.'; $('editError').hidden=false; return; }
    const title=$('editText').value.trim();
    if(!Core.hasVisibleText(title)) { $('editError').textContent='메모 내용을 적어 주세요.'; $('editError').hidden=false; return; }
    const date=$('editDate').value;
    if($('editDate').validity.badInput || (date&&!Core.validateDate(date))) { $('editError').textContent='지정한 날짜를 확인해 주세요.'; $('editError').hidden=false; return; }
    const done=$('editDone').checked;
    const updated={...original,title,notes:$('editNotes').value,date:date||null,color:editColor,done,completedAt:done?(original.completedAt||stampDone(original)):null};
    const next=displayedTasks().map(t=>t.id===editId?updated:t);
    try { validateList(next); }
    catch(error) { $('editError').textContent=error.message; $('editError').hidden=false; return; }
    changeDisplayed(next,'메모를 수정했어요.');
    $('editDialog').close();
  }

  function clearNewDate() { $('newDate').value=''; $('dateInputWrap').hidden=true; $('dateToggle').hidden=false; }
  function closeMenu() { $('backupMenu').hidden=true; $('backupButton').setAttribute('aria-expanded','false'); }
  function downloadText(text,name) {
    const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function backup() {
    closeMenu();
    if(!tasks.length) { showToast('백업할 내 메모가 아직 없어요.');return; }
    const blob = new Blob([exportText(tasks)], {type:'application/json'});
    const fileName = 'Memo_Backup_'+currentDate()+'.json';
    presentExport({blob, fileName, file:typeof File==='function'?new File([blob],fileName,{type:'application/json'}):null, count:tasks.length}, 'backup');
  }
  function clearExport() {
    if(previewURL) URL.revokeObjectURL(previewURL);
    previewURL=null;
    preparedExport=null;
    $('exportPreview').removeAttribute('src');
  }
  function presentExport(prepared, kind) {
    clearExport();
    preparedExport=prepared;
    exportKind=kind;
    const isImage=kind==='image';
    $('exportTitle').textContent=isImage?'이미지 저장':'내 메모 백업하기';
    $('exportDescription').textContent=isImage?prepared.count+'개의 메모를 한 장에 담았어요.':prepared.count+'개의 메모와 완료 상태, 날짜를 파일로 보관하세요.';
    $('exportPreviewWrap').hidden=!isImage;
    $('exportFileName').hidden=isImage;
    $('exportFileName').textContent=prepared.fileName;
    if(isImage){previewURL=URL.createObjectURL(prepared.blob);$('exportPreview').src=previewURL;}
    const canShare=window.MemoImage.canShareImage(prepared);
    $('shareExportButton').hidden=!canShare;
    $('shareExportButton').textContent=isImage?'사진 / 파일로 공유':'파일에 저장 / 공유';
    $('exportHint').textContent=canShare?(isImage?'공유 메뉴에서 사진이나 파일로 보관할 수 있어요.':'공유 메뉴의 ‘파일에 저장’으로 백업을 보관하세요.'):'다운로드한 파일은 브라우저의 다운로드 목록이나 파일 앱에서 확인할 수 있어요.';
    $('exportError').hidden=true;
    $('exportDialog').showModal();
  }
  async function importBackup(event) {
    const file=event.target.files[0];
    event.target.value='';
    if(!file)return;
    try {
      if(file.size>Core.LIMITS.importBytes)throw new Error('백업 파일은 4MB 이하여야 합니다.');
      const incoming=Core.parseImport(await file.text());
      if(!refreshStoredTasks(false))return;
      const merged=Core.mergeImported(tasks,incoming);
      const added=merged.length-tasks.length;
      const skipped=incoming.length-added;
      if(!added) { showToast(skipped?'이미 있는 메모 '+skipped+'개를 건너뛰었어요.':'가져올 메모가 없는 백업 파일이에요.');return; }
      filter='all';$('searchInput').value='';
      commit(merged,added+'개를 가져왔어요.'+(skipped?' 기존 '+skipped+'개는 유지했어요.':''),true);
    } catch(error){showToast(error.message);}
  }

  $('addButton').addEventListener('click',addMemo);
  $('memoInput').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.isComposing){event.preventDefault();addMemo();}});
  $('memoInput').addEventListener('input',()=>showInputError(''));
  document.querySelector('.compose-options .colors').addEventListener('click',event=>{const button=event.target.closest('[data-color]');if(button){color=button.dataset.color;setColorButtons(button.parentElement,color);}});
  $('dateToggle').addEventListener('click',()=>{$('dateToggle').hidden=true;$('dateInputWrap').hidden=false;$('newDate').focus();});
  $('clearNewDate').addEventListener('click',clearNewDate);
  $('clearEditDate').addEventListener('click',()=>{$('editDate').value='';});
  $('editColors').addEventListener('click',event=>{const button=event.target.closest('[data-color]');if(button){editColor=button.dataset.color;setColorButtons($('editColors'),editColor);}});
  $('editForm').addEventListener('submit',saveEdit);
  $('deleteFromEdit').addEventListener('click',()=>{$('editDialog').close();deleteTask(editId);});
  $('board').addEventListener('change',event=>{const control=event.target.closest('[data-action="toggle"]');if(control)toggleTask(control.dataset.id);});
  $('board').addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(!control)return;const action=control.dataset.action;if(action==='edit')openEdit(control.dataset.id);if(action==='delete')deleteTask(control.dataset.id);if(action==='focus')$('memoInput').focus();});
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{if(!refreshStoredTasks(false))return;filter=button.dataset.filter;persist();render();}));
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(!refreshStoredTasks(false))return;view=button.dataset.view;persist();render();}));
  $('sortSelect').addEventListener('change',()=>{const selectedSort=$('sortSelect').value;if(!refreshStoredTasks(false))return;sort=selectedSort;persist();render();});
  $('searchInput').addEventListener('input',render);
  $('startEmptyButton').addEventListener('click',()=>{if(!refreshStoredTasks(false))return;if(!demo){showToast('다른 창에 저장된 내 메모를 불러왔어요.');return;}filter='all';$('searchInput').value='';commit([],'나만의 빈 보드를 시작했어요.',false);$('memoInput').focus();});
  $('backupButton').addEventListener('click',()=>{const opening=$('backupMenu').hidden;$('backupMenu').hidden=!opening;$('backupButton').setAttribute('aria-expanded',String(opening));});
  document.addEventListener('click',event=>{if(!event.target.closest('.menu-wrap'))closeMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
  $('exportButton').addEventListener('click',backup);
  $('importButton').addEventListener('click',()=>{closeMenu();$('importFile').click();});
  $('importFile').addEventListener('change',importBackup);
  ['helpButton','menuHelpButton'].forEach(id=>$(id).addEventListener('click',()=>{closeMenu();$('helpDialog').showModal();}));
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.closeDialog).close()));
  $('exportDialog').addEventListener('close',clearExport);
  $('shareExportButton').addEventListener('click',async()=>{
    if(!preparedExport)return;
    $('exportError').hidden=true;
    try {
      // 이미지·파일 준비는 이미 끝났습니다. 클릭 안에서 바로 공유 창을 엽니다.
      await navigator.share({files:[preparedExport.file],title:'메모 한눈에'});
      if(exportKind==='backup')unsavedChanges=false;
    } catch(error) {
      if(error.name==='AbortError')return;
      $('exportError').textContent='공유 창을 열지 못했어요. 다운로드로 저장해 주세요.';
      $('exportError').hidden=false;
    }
  });
  $('downloadExportButton').addEventListener('click',()=>{
    if(!preparedExport)return;
    try {
      window.MemoImage.downloadImage(preparedExport);
      if(exportKind==='backup')unsavedChanges=false;
      showToast('다운로드를 시작했어요. 파일 앱이나 다운로드 목록에서 확인해 주세요.');
    }catch(error){$('exportError').textContent=error.message;$('exportError').hidden=false;}
  });
  $('undoButton').addEventListener('click',()=>{const action=undoAction;undoAction=null;clearTimeout(toastTimer);if(action)action();});
  $('imageButton').addEventListener('click',async()=>{
    const button=$('imageButton');
    button.disabled=true;
    try {
      const result=await window.MemoImage.prepareImage(visibleTasks(),{title:'메모 한눈에',filterLabel:names[filter]+($('searchInput').value.trim()?' · 검색 결과':''),isDemo:demo});
      presentExport(result,'image');
    } catch(error){showToast(error.message||'이미지를 만들지 못했어요. 메모 수를 줄여 다시 시도해 주세요.');}
    finally{button.disabled=visibleTasks().length===0;}
  });
  $('recoverButton').addEventListener('click',()=>{if(brokenData!==null)downloadText(brokenData,'Memo_Original_Data_'+currentDate()+'.json');});
  $('resetStorageButton').addEventListener('click',()=>{
    if(!confirm('기존 데이터를 내려받아 보관했나요? 새 목록을 시작하면 이 브라우저의 기존 저장 내용을 교체합니다.'))return;
    brokenData=null;tasks=[];demo=false;persist();render();showToast('새 목록을 시작했어요.');
  });
  // 예시 화면인 새 창도 다른 창의 첫 저장을 받아야 기존 메모를 덮어쓰지 않습니다.
  function refreshStoredTasks(notify) {
    if(brokenData!==null)return false;
    if(memoryOnly)return true;
    try {
      const raw=localStorage.getItem(KEY);
      if(raw===null&&demo)return true;
      const incoming=raw?Core.parseImport(raw):[];
      const changed=demo||JSON.stringify(tasks)!==JSON.stringify(incoming);
      if(!changed)return true;
      tasks=incoming;
      demo=false;
      undoAction=null;$('undoButton').hidden=true;
      render();
      if(notify)showToast('다른 창의 메모 변경을 반영했어요.');
      return true;
    } catch(_){showToast('최신 저장 내용을 읽지 못해 변경을 멈췄어요. 현재 목록과 입력은 유지합니다.');return false;}
  }
  window.addEventListener('storage',event=>{
    if(event.key!==KEY&&event.key!==null)return;
    refreshStoredTasks(true);
  });
  window.addEventListener('pageshow',()=>refreshStoredTasks(false));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshStoredTasks(false);});
  window.addEventListener('beforeunload',event=>{if(unsavedChanges){event.preventDefault();event.returnValue='';}});
  load();
  render();
})();
