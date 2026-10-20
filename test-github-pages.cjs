'use strict';

// GitHub Pages의 같은 origin·여러 프로젝트 환경을 위한 회귀 검증입니다.
// 실제 앱 코드를 VM에서 실행하며 브라우저 설치 실기를 대신하지는 않습니다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('./src/memo-core.js');
const { KEY, StorageHub, makeWindow, assertRealBoard } = require('./test-support/app-harness.cjs');

test('GitHub Pages의 기존 공용 키는 읽거나 덮어쓰지 않고 메모 앱 전용 키만 저장한다', () => {
  const oldKey = 'memonote.local.v1';
  const oldTasks = core.parseMemo('같은 origin의 다른 앱이 보관한 메모');
  const original = JSON.stringify({app:'memonote', version:1, tasks:oldTasks});
  const hub = new StorageHub();
  hub.values.set(oldKey, original);
  const tab = makeWindow(hub);

  assert.equal(KEY, 'memo-for-gunwook.local.v1');
  assert.equal(tab.get('demoNotice').hidden, false, 'an unrelated storage key must not become this app’s real list');
  assert.ok(!tab.get('board').innerHTML.includes(oldTasks[0].title));
  assert.equal(hub.getItem(KEY), null);

  tab.add('메모 앱에서 새로 작성한 항목');
  assert.deepEqual(hub.tasks().map(task => task.title), ['메모 앱에서 새로 작성한 항목']);
  assert.equal(hub.getItem(oldKey), original, 'adding a memo must preserve the other app’s data byte for byte');
  assertRealBoard(makeWindow(hub), ['메모 앱에서 새로 작성한 항목']);

  // 다른 키의 storage 이벤트는 이 앱의 목록에 반영되지 않아야 합니다.
  const changedOther = JSON.stringify({app:'memonote', version:1, tasks:core.parseMemo('다른 앱에서 변경한 항목')});
  hub.write(null, oldKey, changedOther);
  hub.flush();
  assertRealBoard(tab, ['메모 앱에서 새로 작성한 항목']);
  tab.toggle(hub.tasks()[0].id);
  assert.equal(hub.tasks()[0].done, true);
  assert.equal(hub.getItem(oldKey), changedOther);
});

test('manifest·아이콘·서비스워커 등록과 셸 캐시는 GitHub Pages 프로젝트 경로 안으로 해석된다', () => {
  const pageURL = 'https://winter-gun.github.io/memo-for-gunwook/';
  const manifestURL = new URL('./manifest.webmanifest', pageURL);
  const deploymentDirectory = path.join(__dirname, 'docs');
  assert.ok(fs.existsSync(path.join(deploymentDirectory, '.nojekyll')));
  const manifest = JSON.parse(fs.readFileSync(path.join(deploymentDirectory, 'manifest.webmanifest'), 'utf8'));
  for (const property of ['id', 'start_url', 'scope']) {
    assert.equal(new URL(manifest[property], manifestURL).href, pageURL);
  }
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestURL);
    assert.equal(url.origin, new URL(pageURL).origin);
    assert.ok(url.pathname.startsWith('/memo-for-gunwook/'));
    assert.ok(fs.existsSync(path.join(deploymentDirectory, path.basename(url.pathname))));
  }

  const shell = fs.readFileSync(path.join(deploymentDirectory, 'index.html'), 'utf8');
  const links = [...shell.matchAll(/<link\b[^>]*rel="(manifest|apple-touch-icon|icon)"[^>]*href="([^"]+)"/g)];
  assert.equal(links.length, 3);
  for (const [, , href] of links) {
    const url = new URL(href, pageURL);
    assert.ok(url.pathname.startsWith('/memo-for-gunwook/'));
    assert.ok(fs.existsSync(path.join(deploymentDirectory, path.basename(url.pathname))));
  }

  // 실제 pwa.js를 실행해 등록 인자를 관찰합니다. 문자열 검색만으로 판정하지 않습니다.
  const registrations = [];
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, {addEventListener() {}, setAttribute() {}});
    return elements.get(id);
  };
  const serviceWorker = {
    addEventListener() {},
    ready:new Promise(() => {}),
    register(script, options) {
      registrations.push({script, options});
      return Promise.resolve({active:null});
    }
  };
  const pwaContext = vm.createContext({
    document:{getElementById:getElement, addEventListener() {}},
    navigator:{userAgent:'', onLine:true, serviceWorker},
    location:{protocol:'https:'},
    window:{isSecureContext:true, matchMedia:() => ({matches:false}), addEventListener() {}},
    setTimeout:() => 1, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src/pwa.js'), 'utf8'), pwaContext);
  assert.equal(registrations.length, 1);
  assert.equal(new URL(registrations[0].script, pageURL).href, pageURL + 'sw.js');
  assert.equal(new URL(registrations[0].options.scope, pageURL).href, pageURL);

  // 배포된 worker가 계산하는 캐시 URL도 다른 프로젝트 경로로 벗어나지 않아야 합니다.
  const workerContext = vm.createContext({
    URL,
    self:{registration:{scope:pageURL}, location:{origin:new URL(pageURL).origin}, addEventListener() {}}
  });
  vm.runInContext(fs.readFileSync(path.join(deploymentDirectory, 'sw.js'), 'utf8'), workerContext);
  const shellURLs = JSON.parse(vm.runInContext('JSON.stringify(SHELL.map(item => item.url))', workerContext));
  assert.equal(shellURLs.length, 5);
  assert.ok(shellURLs.every(url => url.startsWith(pageURL)));
  assert.ok(!shellURLs.some(url => url.includes('/pet-timer-app/')));
  assert.equal(vm.runInContext('CACHE_NAME', workerContext), 'memo-board-shell-v1:/memo-for-gunwook/');
});
