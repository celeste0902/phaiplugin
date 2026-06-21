from pathlib import Path

p = Path('plugintempermonkey.js')
s = p.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(label + ': expected 1 match, found ' + str(count))
    s = s.replace(old, new, 1)


replace_once(
    '// @version      0.5.0\n'
    '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、草稿层与单字段手动注入',
    '// @version      0.5.1\n'
    '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台与安全单字段注入',
    'metadata'
)

note = '''  /*
    V0.5.1 修复：单字段注入确认与撤销
    - 成功状态明确为“已填入 Mufy 编辑器”，仍需用户手动点击“更新角色”保存到云端。
    - 写入后触发 blur，并等待 160ms 再校验，减少 React 尚未接收状态时的假成功。
    - 新增“撤销本次写入”：恢复 Mufy 编辑器原内容，同时保留工作台草稿，方便再次确认后写入。
    - 写入进行中禁用按钮；重新编辑、恢复或切换字段后不允许对过期写入执行撤销。

'''
needle = '  /*\n    V0.5.0 新增：单字段手动注入 Mufy（步骤 3）'
if needle in s and 'V0.5.1 修复：单字段注入确认与撤销' not in s:
    s = s.replace(needle, note + needle, 1)

replace_once(
    '  var wbTokenTimer = null;',
    '  var wbTokenTimer = null;\n'
    '  // 工作台单字段写入：只保留最近一次、且尚未被后续编辑覆盖的撤销记录。\n'
    '  var wbLastWriteUndo = null;\n'
    '  var wbWritePending = false;',
    'workbench write state'
)

replace_once(
    "       '    <div id=\"mufy-wb-write-row\">',\n"
    "       '      <button id=\"mufy-wb-write-btn\">写入当前字段到 Mufy</button>',\n"
    "       '      <span id=\"mufy-wb-write-status\"></span>',",
    "       '    <div id=\"mufy-wb-write-row\">',\n"
    "       '      <button id=\"mufy-wb-write-btn\">写入当前字段到 Mufy</button>',\n"
    "       '      <button id=\"mufy-wb-undo-write-btn\" class=\"secondary\" disabled>撤销本次写入</button>',\n"
    "       '      <span id=\"mufy-wb-write-status\"></span>',",
    'write row'
)

replace_once(
    "    /* 写入当前字段到 Mufy */\n"
    "    wbEl.querySelector('#mufy-wb-write-btn').addEventListener('click', function () {\n"
    "      writeCurrentFieldToMufy();\n"
    "    });",
    "    /* 写入当前字段到 Mufy */\n"
    "    wbEl.querySelector('#mufy-wb-write-btn').addEventListener('click', function () {\n"
    "      writeCurrentFieldToMufy();\n"
    "    });\n\n"
    "    wbEl.querySelector('#mufy-wb-undo-write-btn').addEventListener('click', function () {\n"
    "      undoCurrentWbWrite();\n"
    "    });",
    'write listeners'
)

replace_once(
    "      snap.syncStatus = 'clean';\n"
    "      wbEl.querySelector('#mufy-wb-editor').value = snap.originalContent;",
    "      snap.syncStatus = 'clean';\n"
    "      clearWbUndoForField(snap.fieldId);\n"
    "      wbEl.querySelector('#mufy-wb-editor').value = snap.originalContent;",
    'restore clears undo'
)

replace_once(
    "      snap.syncStatus = 'clean';\n"
    "      wbEl.querySelector('#mufy-wb-editor').value = snap.originalContent;",
    "      snap.syncStatus = 'clean';\n"
    "      clearWbUndoForField(snap.fieldId);\n"
    "      wbEl.querySelector('#mufy-wb-editor').value = snap.originalContent;",
    'discard clears undo'
)

replace_once(
    "        var isDirty = snap.draftContent !== snap.originalContent;\n"
    "        var prevStatus = snap.syncStatus;",
    "        clearWbUndoForField(snap.fieldId);\n\n"
    "        var isDirty = snap.draftContent !== snap.originalContent;\n"
    "        var prevStatus = snap.syncStatus;",
    'edit clears undo'
)

replace_once(
    "    wbCurrentIndex = -1;\n"
    "    renderWbFieldList();",
    "    wbCurrentIndex = -1;\n"
    "    wbLastWriteUndo = null;\n"
    "    wbWritePending = false;\n"
    "    renderWbFieldList();",
    'open reset write state'
)

start = s.index('  /* 把当前字段的草稿写入 Mufy 对应 DOM 节点（约束 4：写前检查 isConnected） */')
end = s.index('  function closeWorkbench() {', start)

new_functions = '''  /* ─── 工作台：单字段安全写入与撤销 ─── */

  function getWbFieldById(fieldId) {
    for (var i = 0; i < fields.length; i += 1) {
      if (fields[i].id === fieldId) return fields[i];
    }
    return null;
  }

  function clearWbUndoForField(fieldId) {
    if (wbLastWriteUndo && wbLastWriteUndo.fieldId === fieldId) {
      wbLastWriteUndo = null;
    }
  }

  function updateWbWriteControls() {
    if (!wbEl) return;

    var writeButton = wbEl.querySelector('#mufy-wb-write-btn');
    var undoButton = wbEl.querySelector('#mufy-wb-undo-write-btn');
    var snap = wbCurrentIndex >= 0 ? wbSnapshot[wbCurrentIndex] : null;

    if (writeButton) {
      writeButton.disabled = wbWritePending || !snap;
      writeButton.textContent = wbWritePending ? '正在确认写入…' : '写入当前字段到 Mufy';
    }

    if (undoButton) {
      var canUndo = !!(
        !wbWritePending &&
        snap &&
        wbLastWriteUndo &&
        wbLastWriteUndo.fieldId === snap.fieldId &&
        snap.syncStatus === 'synced' &&
        snap.draftContent === snap.originalContent
      );

      undoButton.disabled = !canUndo;
    }
  }

  function setWbWriteStatus(type, message) {
    var el = wbEl && wbEl.querySelector('#mufy-wb-write-status');
    if (!el) return;
    el.textContent = message;
    el.className = type;
  }

  function triggerMufyBlur(field) {
    if (!field || !field.el) return;

    try {
      field.el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (error) {
      // blur is a supplemental React signal. The later DOM-value check remains authoritative.
    }
  }

  function writeWbValue(field, value) {
    if (field.type === 'contenteditable') {
      setEditableValue(field.el, value);
    } else {
      setNativeValue(field.el, value);
    }

    triggerMufyBlur(field);
  }

  function writeCurrentFieldToMufy() {
    if (wbWritePending || wbCurrentIndex < 0 || wbCurrentIndex >= wbSnapshot.length) return;

    var snap = wbSnapshot[wbCurrentIndex];
    var editor = wbEl.querySelector('#mufy-wb-editor');
    snap.draftContent = editor.value;

    var field = getWbFieldById(snap.fieldId);
    if (!field || !field.el || !field.el.isConnected) {
      snap.syncStatus = 'stale';
      setWbWriteStatus('err', '字段已卸载，请重新扫描');
      renderWbFieldList();
      updateWbWriteControls();
      return;
    }

    var before = getValue(field.el);
    var previousOriginal = snap.originalContent;
    var previousDraft = snap.draftContent;
    var previousStatus = snap.syncStatus;

    wbWritePending = true;
    setWbWriteStatus('warn', '正在填入 Mufy 编辑器…');
    updateWbWriteControls();

    try {
      writeWbValue(field, snap.draftContent);
    } catch (err) {
      wbWritePending = false;
      snap.syncStatus = 'failed';
      setWbWriteStatus('err', '写入失败：' + (err && err.message ? err.message : '未知错误'));
      renderWbFieldList();
      updateWbWriteControls();
      return;
    }

    window.setTimeout(function () {
      wbWritePending = false;

      if (!field.el || !field.el.isConnected) {
        snap.syncStatus = 'stale';
        setWbWriteStatus('err', '字段在校验时已卸载，请重新扫描');
      } else if (getValue(field.el) === snap.draftContent) {
        wbLastWriteUndo = {
          fieldId: snap.fieldId,
          pageValueBeforeWrite: before,
          originalBeforeWrite: previousOriginal,
          draftBeforeWrite: previousDraft,
          statusBeforeWrite: previousStatus
        };

        snap.originalContent = snap.draftContent;
        snap.syncStatus = 'synced';
        setWbWriteStatus('ok', '已填入 Mufy 编辑器 ✓ 请手动点击“更新角色”保存');
      } else {
        snap.syncStatus = 'failed';
        setWbWriteStatus('err', '写入失败：延迟校验不一致');
      }

      renderWbFieldList();
      updateWbWriteControls();
      scheduleWbRightPanelUpdate();
    }, 160);
  }

  function undoCurrentWbWrite() {
    if (wbWritePending || wbCurrentIndex < 0 || wbCurrentIndex >= wbSnapshot.length) return;

    var snap = wbSnapshot[wbCurrentIndex];
    var undo = wbLastWriteUndo;

    if (!undo || undo.fieldId !== snap.fieldId || snap.syncStatus !== 'synced' || snap.draftContent !== snap.originalContent) {
      setWbWriteStatus('warn', '当前字段没有可安全撤销的写入');
      updateWbWriteControls();
      return;
    }

    var field = getWbFieldById(snap.fieldId);
    if (!field || !field.el || !field.el.isConnected) {
      snap.syncStatus = 'stale';
      setWbWriteStatus('err', '字段已卸载，无法安全撤销，请重新扫描');
      renderWbFieldList();
      updateWbWriteControls();
      return;
    }

    wbWritePending = true;
    setWbWriteStatus('warn', '正在撤销写入…');
    updateWbWriteControls();

    try {
      writeWbValue(field, undo.pageValueBeforeWrite);
    } catch (err) {
      wbWritePending = false;
      setWbWriteStatus('err', '撤销失败：' + (err && err.message ? err.message : '未知错误'));
      updateWbWriteControls();
      return;
    }

    window.setTimeout(function () {
      wbWritePending = false;

      if (!field.el || !field.el.isConnected) {
        snap.syncStatus = 'stale';
        setWbWriteStatus('err', '字段在撤销校验时已卸载，请重新扫描');
      } else if (getValue(field.el) === undo.pageValueBeforeWrite) {
        snap.originalContent = undo.originalBeforeWrite;
        snap.draftContent = undo.draftBeforeWrite;
        snap.syncStatus = snap.draftContent === snap.originalContent ? 'clean' : 'dirty';
        wbEl.querySelector('#mufy-wb-editor').value = snap.draftContent;
        wbLastWriteUndo = null;
        setWbWriteStatus('warn', '已撤销写入；草稿仍待写入 Mufy');
      } else {
        snap.syncStatus = 'failed';
        setWbWriteStatus('err', '撤销失败：延迟校验不一致');
      }

      renderWbFieldList();
      updateWbWriteControls();
      scheduleWbRightPanelUpdate();
    }, 160);
  }

'''

s = s[:start] + new_functions + s[end:]

replace_once(
    "    clearWbTokenTimer();\n"
    "    wbEl.classList.remove('open');\n"
    "    wbCurrentIndex = -1;\n"
    "    wbSnapshot = [];",
    "    clearWbTokenTimer();\n"
    "    wbLastWriteUndo = null;\n"
    "    wbWritePending = false;\n"
    "    wbEl.classList.remove('open');\n"
    "    wbCurrentIndex = -1;\n"
    "    wbSnapshot = [];",
    'close resets write state'
)

replace_once(
    "    updateWbRightPanel();\n"
    "    editor.focus();",
    "    updateWbRightPanel();\n"
    "    updateWbWriteControls();\n"
    "    editor.focus();",
    'field switch controls'
)

replace_once(
    "       '#mufy-wb-write-btn{background:#059669;border:none;color:#fff;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',\n"
    "       '#mufy-wb-write-btn:hover{filter:brightness(1.12)}',",
    "       '#mufy-wb-write-btn{background:#059669;border:none;color:#fff;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',\n"
    "       '#mufy-wb-write-btn:hover{filter:brightness(1.12)}',\n"
    "       '#mufy-wb-write-btn:disabled,#mufy-wb-undo-write-btn:disabled{cursor:not-allowed;opacity:.45;filter:none}',\n"
    "       '#mufy-wb-undo-write-btn{background:#34344a;border:none;color:#e6e6ef;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',",
    'undo styles'
)

p.write_text(s, encoding='utf-8')

c = Path('CHANGELOG.md')
entry = '''## v0.5.1 — 2026-06-21

### 修复
- 单字段写入成功提示改为“已填入 Mufy 编辑器”，明确仍需手动点击“更新角色”完成云端保存。
- 写入与撤销都会触发 blur，并在 160ms 后再校验页面字段，降低 React 延迟更新造成的假成功。
- 新增“撤销本次写入”：恢复 Mufy 编辑器原内容，同时保留工作台草稿，方便再次核对后写入。
- 写入校验期间禁用写入和撤销；重新编辑、恢复草稿或切换状态后不允许对过期写入执行撤销。

### 边界
- 仍不会自动点击 Mufy 的“更新角色”。
- 撤销只覆盖工作台最近一次、当前字段仍未被后续编辑的单字段写入。

'''
old = c.read_text(encoding='utf-8') if c.exists() else '# 更新日志\n\n'
if '## v0.5.1' not in old:
    prefix = '# 更新日志\n\n'
    body = old[len(prefix):] if old.startswith(prefix) else old
    c.write_text(prefix + entry + body.lstrip(), encoding='utf-8')
