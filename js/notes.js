/**
 * notes.js —— 笔记编辑：纯文本 textarea，自动保存 + Ctrl+S。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  function bindNoteEditor(textarea, item) {
    let saveTimer = null;
    const save = () => {
      item.notes = textarea.value;
      App.Storage.save(App.state.data);
    };
    textarea.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 600);   // 停止输入 600ms 后自动保存
    });
    textarea.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        clearTimeout(saveTimer);
        save();
        App.UI.toast && App.UI.toast('笔记已保存');
      }
    });
    // 离开页面时兜底保存
    window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); save(); });
  }

  App.Notes = { bindNoteEditor };
})();
