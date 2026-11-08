'use strict';
// JSON file store (zero-dependency), debounced atomic writes. data/ is gitignored —
// the Groq key never leaves this machine and must never be committed.
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');

function defaultConfig() {
  return {
    groqKey: '',
    model: 'openai/gpt-oss-120b',
    transcribeModel: 'whisper-large-v3',
  };
}

let data = null;
let writeTimer = null;

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') data = {};
  if (!data.config || typeof data.config !== 'object') data.config = defaultConfig();
  data.config = Object.assign(defaultConfig(), data.config);
  if (!Array.isArray(data.notes)) data.notes = [];
  return data;
}

function saveNow() {
  clearTimeout(writeTimer);
  writeTimer = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('[db] save failed:', e.message);
  }
}

function scheduleSave() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(saveNow, 150);
}

const store = {
  get config() { return load().config; },
  setConfig(patch) {
    Object.assign(load().config, patch);
    scheduleSave();
  },
  listNotes() {
    return load().notes.slice().sort((a, b) => b.createdAt - a.createdAt);
  },
  getNote(id) {
    return load().notes.find((n) => n.id === id) || null;
  },
  createNote(n) {
    load().notes.push(n);
    scheduleSave();
    return n;
  },
  updateNote(id, patch) {
    const n = this.getNote(id);
    if (!n) return null;
    Object.assign(n, patch);
    scheduleSave();
    return n;
  },
  deleteNote(id) {
    const d = load();
    const i = d.notes.findIndex((n) => n.id === id);
    if (i === -1) return false;
    d.notes.splice(i, 1);
    scheduleSave();
    return true;
  },
  flush: saveNow,
};

module.exports = store;
