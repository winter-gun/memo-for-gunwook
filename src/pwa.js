(function () {
  'use strict';
  // 서버로 메모를 보내지 않습니다. 이 스크립트는 앱 화면의 오프라인 준비만 담당합니다.
  const $ = id => document.getElementById(id);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const mobile = window.matchMedia('(max-width: 850px)').matches || /iPhone|iPad|iPod/.test(navigator.userAgent);
  const hosted = location.protocol === 'https:' || location.protocol === 'http:';
  let cacheReady = false;
  let registration = null;
  let checking = false;

  function showStatus(text) {
    $('offlineStatus').textContent = text;
    $('phoneNoticeStatus').textContent = text;
  }
  function readyText() {
    return navigator.onLine ? '오프라인 준비 완료 · 이 기기에 저장돼요.' : '오프라인 사용 중 · 이 기기에 저장돼요.';
  }
  async function checkCache() {
    if (checking) return;
    const worker = navigator.serviceWorker.controller || (registration && registration.active);
    if (!worker) return;
    checking = true;
    try {
      const result = await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('timeout')); }, 4500);
        channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
        worker.postMessage({type:'MEMO_CACHE_STATUS'}, [channel.port2]);
      });
      cacheReady = result && result.ready === true;
      showStatus(cacheReady ? readyText() : '오프라인 준비 전 · 인터넷에 연결해 다시 열어 주세요.');
    } catch (_) {
      showStatus('오프라인 준비를 확인하지 못했어요. 인터넷 연결 후 다시 열어 주세요.');
    } finally { checking = false; }
  }
  function openInstall() {
    $('backupMenu').hidden = true;
    $('backupButton').setAttribute('aria-expanded','false');
    $('installDialog').showModal();
    if (registration) checkCache();
  }
  ['installButton','installMenuButton'].forEach(id => $(id).addEventListener('click',openInstall));
  $('phoneNotice').hidden = !hosted || (!mobile && !standalone);
  if (standalone) {
    $('phoneNoticeTitle').textContent = '나만의 작은 메모 공간';
    $('installButton').textContent = '사용 안내';
  }
  if (!hosted) {
    showStatus('아이폰 홈 화면 설치는 웹 주소로 열었을 때 사용할 수 있어요.');
    return;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    showStatus('이 실행 환경에서는 오프라인 준비를 사용할 수 없어요.');
    return;
  }
  showStatus('오프라인 사용 준비 중…');
  const startupTimer = setTimeout(() => {
    if (!cacheReady) showStatus('오프라인 준비를 기다리고 있어요. 연결 상태를 확인해 주세요.');
  }, 12000);
  navigator.serviceWorker.addEventListener('controllerchange', () => { checking=false; checkCache(); });
  navigator.serviceWorker.register('./sw.js', {scope:'./',updateViaCache:'none'}).then(reg => {
    registration=reg;
    if (reg.active) checkCache();
    return navigator.serviceWorker.ready;
  }).then(reg => {
    clearTimeout(startupTimer);
    registration=reg;
    checkCache();
  }).catch(() => {
    clearTimeout(startupTimer);
    showStatus('오프라인 준비를 완료하지 못했어요. 인터넷 연결 후 다시 열어 주세요.');
  });
  window.addEventListener('online', () => { if(cacheReady)showStatus(readyText()); else if(registration)checkCache(); });
  window.addEventListener('offline', () => showStatus(cacheReady ? readyText() : '인터넷 연결이 없어요. 창을 닫기 전에 메모를 백업해 주세요.'));
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && registration)checkCache(); });
})();
