/* app.js - Tiny Dart-only playground
   - Multi-file (virtual FS) with localStorage persistence
   - Compile via dart_sdk_new.js
   - Mobile-friendly UI with console & live preview iframe
*/
(() => {
  'use strict';

  /*** ---------- Constants ---------- ***/
  const LS_KEY = 'dartpad_mini_project_v1';
  const DEFAULT_FILES = {
    'main.dart': `import 'dart:html';

void main() {
  querySelector('#app')?.text = 'Hello from Dart!';
  print('Hello, console!');
}
`,
  };

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
      li.addEventListener('click', () => setActive(name));

      let pressTimer;
      li.addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => promptRename(name), 600);
      });
      ['mouseup', 'mouseleave'].forEach(ev =>
        li.addEventListener(ev, () => clearTimeout(pressTimer))
      );

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
    UI.lineNums.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }

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
    if (!name.endsWith('.dart')) { alert('拡張子は .dart にしてください'); return; }
    if (state.files[name]) { alert('同名ファイルが既にあります'); return; }
    state.files[name] = `// ${name}\n`;
    persist();
    setActive(name);
    renderFileList();
  }

  function promptRename(oldName) {
    const name = prompt('新しいファイル名', oldName);
    if (!name || name === oldName) return;
    if (!name.endsWith('.dart')) { alert('拡張子は .dart にしてください'); return; }
    if (state.files[name]) { alert('同名ファイルが既にあります'); return; }
    state.files[name] = state.files[oldName];
    delete state.files[oldName];
    if (state.active === oldName) state.active = name;
    persist();
    renderFileList();
    setActive(state.active);
  }

  function promptDelete(name) {
    if (Object.keys(state.files).length === 1) { alert('最低1ファイルは必要です'); return; }
    if (!confirm(`${name} を削除しますか？`)) return;
    delete state.files[name];
    ensureActiveExists();
    persist();
    renderFileList();
    setActive(state.active);
  }

  /*** ---------- Compile & Run via dart_sdk_new.js ---------- ***/
  async function compileAndRun() {
  setStatus('コンパイル中…');
  UI.console.textContent = '';

  try {
    // main.dartのみを実行対象に
    const mainCode = state.files['main.dart'];
    if (!mainCode) throw new Error('main.dartが存在しません');
    const encoder = new TextEncoder();
    const sourceBytes = encoder.encode(mainCode);

    if (!window.dart || !dart.dart2js) {
      throw new Error('dart_sdk_new.js が読み込まれていません');
    }

    // Uint8Array 形式で渡す
    const js = await dart.dart2js(sourceBytes);

    if (!js) throw new Error('コンパイル結果が空です');

    setStatus('実行中…');
    runInIframe(js);
    setStatus('完了');
  } catch (e) {
    setStatus('コンパイル失敗: ' + e.message, true);
    appendConsole('error', e.stack || String(e));
    UI.console.appendChild(Object.assign(document.createElement('div'), {
      className: 'log error',
      textContent: '[error] ' + (e.message || e)
    }));
  }
}

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
    UI.preview.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }

  window.addEventListener('message', (e) => {
    if (!e?.data) return;
    if (e.data.type === 'console') appendConsole(e.data.level || 'log', e.data.text);
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
    if (!isError) statusTimer = setTimeout(() => (UI.status.textContent = ''), 3000);
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

  // Disable analyze / format (SDK だけでは未対応)
  UI.analyzeBtn.disabled = true;
  UI.formatBtn.disabled = true;

  // Initial render
  renderFileList();
  setActive(state.active);
  refreshLineNumbers();
  setStatus('準備OK');
})();
