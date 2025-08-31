/* app.js - Tiny Dart-only playground
   - Multi-file (virtual FS) with localStorage persistence
   - Analyze / Format / Compile via dart-services v2
   - Mobile-friendly UI with console & live preview iframe
*/
(() => {
  'use strict';

  /*** ---------- Constants ---------- ***/
  const LS_KEY = 'dartpad_mini_project_v1';
  const DEFAULT_FILES = {
    'main.dart': `// Welcome to mini DartPad (Dart only)
// You can add more files with the + button (e.g., utils.dart)
// Then import them in main.dart:
//   import 'utils.dart';

import 'dart:html';

void main() {
  querySelector('#app')?.text = 'Hello from Dart!';
  print('Hello, console!');
}
`,
  };

  // Try multiple backends for robustness (CORS-enabled)
  const BACKENDS = [
    'https://v1.api.dartpad.dev/api/dartservices/v2',
    'https://dart-services.appspot.com/api/dartservices/v2'
  ];

  const UI = {
    fileList: document.getElementById('file-list'),
    addFileBtn: document.getElementById('add-file'),
    runBtn: document.getElementById('run'),
    analyzeBtn: document.getElementById('analyze'),
    formatBtn: document.getElementById('format'),
    exportBtn: document.getElementById('export'),
    importBtn: document.getElementById('import'),
    importInput: document.getElementById('import-input'),
    resetBtn: document.getElementById('reset'),
    editor: document.getElementById('editor'),
    lineNums: document.getElementById('line-nums'),
    status: document.getElementById('status'),
    preview: document.getElementById('preview'),
    console: document.getElementById('console'),
    filenameTitle: document.getElementById('filename-title'),
    drawerToggle: document.getElementById('drawer-toggle')
  };

  /*** ---------- State & FS ---------- ***/
  let state = loadState();
  if (!state || !state.files || Object.keys(state.files).length === 0) {
    state = { files: { ...DEFAULT_FILES }, active: 'main.dart' };
    persist();
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function persist() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function ensureActiveExists() {
    if (!state.files[state.active]) {
      state.active = Object.keys(state.files)[0] || 'main.dart';
    }
  }

  /*** ---------- UI Rendering ---------- ***/
  function renderFileList() {
    UI.fileList.innerHTML = '';
    Object.keys(state.files).forEach((name) => {
      const li = document.createElement('button');
      li.className = 'file-item' + (name === state.active ? ' active' : '');
      li.textContent = name;
      li.title = 'クリックで切替 / 長押しでリネーム';
      li.addEventListener('click', () => {
        setActive(name);
      });
      // Long press rename
      let pressTimer;
      li.addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => promptRename(name), 600);
      });
      ['mouseup', 'mouseleave'].forEach(ev =>
        li.addEventListener(ev, () => clearTimeout(pressTimer))
      );
      // Context menu: delete
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        promptDelete(name);
      });
      UI.fileList.appendChild(li);
    });
  }

  function setActive(name) {
    if (!state.files[name]) return;
    state.active = name;
    UI.filenameTitle.textContent = name;
    UI.editor.value = state.files[name];
    refreshLineNumbers();
    renderFileList();
    persist();
  }

  function refreshLineNumbers() {
    const lines = UI.editor.value.split('\n').length;
    const nums = Array.from({ length: lines }, (_, i) => (i + 1)).join('\n');
    UI.lineNums.textContent = nums;
  }

  // Debounce line numbers for performance
  let lnTimer;
  UI.editor.addEventListener('input', () => {
    state.files[state.active] = UI.editor.value;
    persist();
    clearTimeout(lnTimer);
    lnTimer = setTimeout(refreshLineNumbers, 10);
  });
  UI.editor.addEventListener('scroll', () => {
    UI.lineNums.scrollTop = UI.editor.scrollTop;
  });

  /*** ---------- File ops ---------- ***/
  function promptNewFile() {
    const name = prompt('新しいDartファイル名を入力 (例: utils.dart)');
    if (!name) return;
    if (!name.endsWith('.dart')) {
      alert('拡張子は .dart にしてください');
      return;
    }
    if (state.files[name]) {
      alert('同名ファイルが既にあります');
      return;
    }
    state.files[name] = `// ${name}\n`;
    persist();
    setActive(name);
    renderFileList();
  }

  function promptRename(oldName) {
    const name = prompt('新しいファイル名', oldName);
    if (!name || name === oldName) return;
    if (!name.endsWith('.dart')) {
      alert('拡張子は .dart にしてください');
      return;
    }
    if (state.files[name]) {
      alert('同名ファイルが既にあります');
      return;
    }
    state.files[name] = state.files[oldName];
    delete state.files[oldName];
    if (state.active === oldName) state.active = name;
    persist();
    renderFileList();
    setActive(state.active);
  }

  function promptDelete(name) {
    if (Object.keys(state.files).length === 1) {
      alert('最低1ファイルは必要です');
      return;
    }
    if (!confirm(`${name} を削除しますか？`)) return;
    delete state.files[name];
    ensureActiveExists();
    persist();
    renderFileList();
    setActive(state.active);
  }

  /*** ---------- Backend helpers ---------- ***/
  async function postJSON(path, payload) {
    let lastErr;
    for (const base of BACKENDS) {
      try {
        const res = await fetch(`${base}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        // Try next backend
      }
    }
    throw lastErr || new Error('All backends failed');
  }

  // Some endpoints accept {source}, some accept {sources:{name:code}}
  function buildSourcePayload(singleOnly = false) {
    const files = { ...state.files };
    // Always ensure main.dart exists
    if (!files['main.dart']) {
      files['main.dart'] = DEFAULT_FILES['main.dart'];
    }
    const payload = singleOnly
      ? { source: files['main.dart'] }
      : { sources: files, source: files['main.dart'] }; // include both for compatibility
    return payload;
  }

  /*** ---------- Analyze / Format / Compile ---------- ***/
  async function analyze() {
    setStatus('解析中…');
    try {
      const payload = buildSourcePayload();
      // /analyze expects SourceRequest; including both fields for safety
      const json = await postJSON('analyze', payload);
      renderAnalysis(json);
      setStatus('解析完了');
    } catch (e) {
      setStatus('解析失敗: ' + e.message, true);
    }
  }

  function renderAnalysis(result) {
    UI.console.textContent = ''; // clear
    const out = [];
    const probs = (result.issues || result.issues?.issues) || [];
    if (!probs.length) {
      out.push('✅ 問題は見つかりませんでした');
    } else {
      for (const p of probs) {
        // Known shape: {kind, line, charStart, message, location, sourceName}
        const file = p.sourceName || p.location?.sourceName || state.active;
        const line = p.line || p.location?.line || '?';
        const severity = p.kind || p.severity || 'info';
        out.push(`[${severity}] ${file}:${line}\n  ${p.message}`);
      }
    }
    UI.console.textContent = out.join('\n');
  }

  async function formatCurrentFile() {
    setStatus('整形中…');
    try {
      const source = UI.editor.value;
      const json = await postJSON('format', { source });
      const formatted = json.newString || json.newStringFormatted || json.source || source;
      state.files[state.active] = formatted;
      UI.editor.value = formatted;
      refreshLineNumbers();
      persist();
      setStatus('整形完了');
    } catch (e) {
      setStatus('整形失敗: ' + e.message, true);
    }
  }

  async function compileAndRun() {
    setStatus('コンパイル中…');
    UI.console.textContent = '';
    try {
      const payload = buildSourcePayload();
      // Prefer dart2js (/compile) because it yields single-file JS
      let json = await postJSON('compile', payload);
      let js = json.result || json.compiledJS || json.compiledJavascript || json.js;
      // If the first attempt didn't return code, try with {source} only
      if (!js) {
        json = await postJSON('compile', buildSourcePayload(true));
        js = json.result || json.compiledJS || json.compiledJavascript || json.js;
      }
      if (!js) throw new Error('Compiled JavaScript not found in response');

      setStatus('実行中…');
      runInIframe(js);
      setStatus('完了');
    } catch (e) {
      setStatus('コンパイル失敗: ' + e.message, true);
      appendConsole('error', e.stack || String(e));
    }
  }

  /*** ---------- Preview Iframe ---------- ***/
  function runInIframe(compiledJS) {
    const prelude = `
      (function(){
        const send=(level,msg)=>parent.postMessage({type:'console',level:level,text:String(msg)},'*');
        ['log','info','warn','error'].forEach(k=>{
          const orig=console[k].bind(console);
          console[k]=function(){ send(k,[...arguments].join(' ')); orig.apply(console,arguments); };
        });
        window.onerror=function(msg,src,line,col,err){ send('error', msg+' @'+line+':'+col); };
      })();
    `;
    const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,'Noto Sans JP',sans-serif;">
    <div id="app" style="padding:12px"></div>
    <script>${prelude}<\/script>
    <script>${compiledJS}<\/script>
  </body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    UI.preview.src = url;
  }

  window.addEventListener('message', (e) => {
    if (!e?.data) return;
    if (e.data.type === 'console') {
      appendConsole(e.data.level || 'log', e.data.text);
    }
  });

  function appendConsole(level, text) {
    const line = document.createElement('div');
    line.className = `log ${level}`;
    line.textContent = `[${level}] ${text}`;
    UI.console.appendChild(line);
    UI.console.scrollTop = UI.console.scrollHeight;
  }

  /*** ---------- Status ---------- ***/
  let statusTimer;
  function setStatus(msg, isError = false) {
    UI.status.textContent = msg;
    UI.status.dataset.kind = isError ? 'error' : 'ok';
    clearTimeout(statusTimer);
    if (!isError) {
      statusTimer = setTimeout(() => (UI.status.textContent = ''), 3000);
    }
  }

  /*** ---------- Import / Export / Reset ---------- ***/
  function exportProject() {
    const data = { files: state.files, active: state.active, ts: Date.now() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dartpad-mini-project.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importProject(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (!obj.files || typeof obj.files !== 'object') throw new Error('不正な形式');
        state.files = obj.files;
        state.active = obj.active || 'main.dart';
        persist();
        renderFileList();
        setActive(state.active);
        setStatus('インポート完了');
      } catch (e) {
        setStatus('インポート失敗: ' + e.message, true);
      }
    };
    reader.readAsText(file);
  }

  function hardReset() {
    if (!confirm('すべて初期化しますか？（元に戻せません）')) return;
    state = { files: { ...DEFAULT_FILES }, active: 'main.dart' };
    persist();
    renderFileList();
    setActive('main.dart');
    setStatus('初期化しました');
  }

  /*** ---------- Event wiring ---------- ***/
  UI.addFileBtn.addEventListener('click', promptNewFile);
  UI.runBtn.addEventListener('click', compileAndRun);
  UI.analyzeBtn.addEventListener('click', analyze);
  UI.formatBtn.addEventListener('click', formatCurrentFile);
  UI.exportBtn.addEventListener('click', exportProject);
  UI.importBtn.addEventListener('click', () => UI.importInput.click());
  UI.importInput.addEventListener('change', () => {
    if (UI.importInput.files && UI.importInput.files[0]) {
      importProject(UI.importInput.files[0]);
      UI.importInput.value = '';
    }
  });
  UI.resetBtn.addEventListener('click', hardReset);
  UI.drawerToggle.addEventListener('click', () => {
    document.body.classList.toggle('drawer-open');
  });

  // Initial render
  renderFileList();
  setActive(state.active);
  refreshLineNumbers();
  setStatus('準備OK');
})();
