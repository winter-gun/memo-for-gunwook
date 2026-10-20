'use strict';

// 실제 앱 소스를 VM에서 실행합니다. DOM 모형은 브라우저 렌더링·실기 검증을 대신하지 않습니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');

const KEY = 'memo-for-gunwook.local.v1';
const projectRoot = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(projectRoot, 'src/shell.html'), 'utf8');
const coreSource = fs.readFileSync(path.join(projectRoot, 'src/memo-core.js'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'src/app.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, fields = {}) {
    const event = {type, target:this, defaultPrevented:false,
      preventDefault() { this.defaultPrevented = true; }, ...fields};
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  async dispatchAsync(type, fields = {}) {
    const event = {type, target:this, defaultPrevented:false,
      preventDefault() { this.defaultPrevented = true; }, ...fields};
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
    return event;
  }
}

class Element extends Events {
  constructor(document, attributes = {}) {
    super();
    this.document = document;
    this.attributes = new Map(Object.entries(attributes));
    this.id = attributes.id || '';
    this.dataset = {};
    for (const [key, value] of this.attributes) {
      if (key.startsWith('data-')) {
        this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
    }
    this.value = '';
    this.style = {};
    this.hidden = this.attributes.has('hidden');
    this.checked = this.attributes.has('checked');
    this.disabled = this.attributes.has('disabled');
    this.validity = {badInput:false};
    this.open = false;
    this._text = '';
    this._html = '';
    this.children = [];
    this.parentElement = null;
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = String(value); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.document.activeElement = this; }
  blur() { if (this.document.activeElement === this) this.document.activeElement = null; }
  click() { if (!this.disabled) this.dispatch('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  querySelectorAll(selector) {
    if (selector === '[data-color]') return this.children.filter(child => child.dataset.color);
    throw new Error('Unsupported element query: ' + selector);
  }
  querySelector(selector) {
    if (this.id === 'saveState' && selector === '.status-dot') return this.statusDot;
    throw new Error('Unsupported element query: ' + this.id + ' ' + selector);
  }
  closest(selector) {
    const match = selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);
    if (match) {
      const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (Object.hasOwn(this.dataset, key) && (match[2] === undefined || this.dataset[key] === match[2])) return this;
    }
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }
}

function makeDocument() {
  const document = new Events();
  document.visibilityState = 'visible';
  document.activeElement = null;
  const elements = [];
  const byId = new Map();
  // 실제 HTML에 있는 요소만 등록하고, 존재하지 않는 ID는 실패시킵니다.
  for (const match of shell.matchAll(/<[a-z][a-z0-9]*\b([^<>]*)>/gi)) {
    const attributes = {};
    for (const attr of match[1].matchAll(/([a-zA-Z_:][\w:.-]*)(?:="([^"]*)")?/g)) attributes[attr[1]] = attr[2] || '';
    const element = new Element(document, attributes);
    elements.push(element);
    if (element.id) byId.set(element.id, element);
  }
  document.getElementById = id => {
    assert.ok(byId.has(id), 'app requested an ID missing from shell.html: ' + id);
    return byId.get(id);
  };
  document.querySelectorAll = selector => {
    const key = {'[data-filter]':'filter', '[data-view]':'view', '[data-close-dialog]':'closeDialog'}[selector];
    assert.ok(key, 'Unsupported document query: ' + selector);
    return elements.filter(element => Object.hasOwn(element.dataset, key));
  };
  const palette = new Element(document);
  const colors = elements.filter(element => element.dataset.color);
  assert.equal(colors.length, 8, 'expected the compose and edit color palettes');
  palette.children = colors.slice(0, 4);
  const editPalette = document.getElementById('editColors');
  editPalette.children = colors.slice(4);
  for (const container of [palette, editPalette]) for (const color of container.children) color.parentElement = container;
  document.querySelector = selector => {
    assert.equal(selector, '.compose-options .colors');
    return palette;
  };
  document.getElementById('progressRing').parentElement = new Element(document);
  document.getElementById('saveState').statusDot = new Element(document);
  return document;
}

class StorageHub {
  constructor() { this.values = new Map(); this.windows = []; this.pending = []; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  bind(events) {
    this.windows.push(events);
    return {
      getItem:key => this.getItem(key),
      setItem:(key, value) => this.write(events, key, String(value)),
      removeItem:key => this.write(events, key, null)
    };
  }
  write(source, key, value) {
    const oldValue = this.getItem(key);
    if (oldValue === value) return;
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
    for (const target of this.windows) {
      if (target !== source) this.pending.push({target, fields:{key, oldValue, newValue:value}});
    }
  }
  deliverOne() {
    const next = this.pending.shift();
    assert.ok(next, 'expected a queued storage event');
    next.target.dispatch('storage', next.fields);
    return next.fields;
  }
  flush() { while (this.pending.length) this.deliverOne(); }
  tasks() {
    const raw = this.getItem(KEY);
    assert.notEqual(raw, null, 'expected a persisted real memo list');
    return JSON.parse(raw).tasks;
  }
}

function makeWindow(hub) {
  const events = new Events();
  const document = makeDocument();
  let timerId = 0;
  const context = {
    document, localStorage:hub.bind(events), Blob, TextEncoder,
    crypto:{randomUUID}, navigator:{},
    addEventListener:events.addEventListener.bind(events),
    matchMedia:() => ({matches:false}),
    // Toast expiry is unrelated to storage delivery; avoid real-time waits.
    setTimeout:() => ++timerId, clearTimeout:() => {},
    MemoImage:Object.freeze({}),
    fetch:() => { throw new Error('Network is outside this local-storage test'); }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(coreSource, context, {filename:'src/memo-core.js'});
  vm.runInContext(appSource, context, {filename:'src/app.js'});
  const get = id => document.getElementById(id);
  return {
    document, events, get, core:context.MemoCore,
    add(text) { get('memoInput').value = text; get('addButton').click(); },
    search(text) { get('searchInput').value = text; get('searchInput').dispatch('input'); },
    chooseView(view) {
      const button = document.querySelectorAll('[data-view]').find(element => element.dataset.view === view);
      assert.ok(button, 'expected a real view button: ' + view);
      button.click();
    },
    toggle(id) {
      const target = new Element(document, {'data-action':'toggle', 'data-id':id});
      get('board').dispatch('change', {target});
    },
    delete(id) {
      const target = new Element(document, {'data-action':'delete', 'data-id':id});
      get('board').dispatch('click', {target});
    },
    async importText(text, size = Buffer.byteLength(text, 'utf8')) {
      get('importFile').files = [{size, text:async () => text}];
      return get('importFile').dispatchAsync('change');
    },
    openEdit(id) {
      assert.ok(get('board').innerHTML.includes('data-action="edit" data-id="' + id + '"'), 'edit control must be rendered');
      const target = new Element(document, {'data-action':'edit', 'data-id':id});
      get('board').dispatch('click', {target});
      assert.equal(get('editDialog').open, true);
    },
    submitEdit() { assert.equal(get('editForm').dispatch('submit').defaultPrevented, true); }
  };
}

function assertRealBoard(tab, titles) {
  assert.equal(tab.get('demoNotice').hidden, true);
  assert.equal(tab.get('countAll').textContent, String(titles.length));
  assert.equal(tab.get('saveText').textContent, '이 브라우저에 저장됨');
  for (const title of titles) assert.ok(tab.get('board').innerHTML.includes(title), 'expected rendered memo: ' + title);
}

module.exports = { KEY, Events, Element, StorageHub, makeWindow, assertRealBoard };
