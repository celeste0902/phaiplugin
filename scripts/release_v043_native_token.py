from pathlib import Path

p = Path('plugintempermonkey.js')
s = p.read_text(encoding='utf-8')

s = s.replace(
    '// @version      0.4.2\n// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、草稿保护与严格 Token 预算',
    '// @version      0.4.3\n// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、草稿保护与 Mufy 原生 Token 预算',
    1
)
s = s.replace(
    "'    <div class=\"wb-section-title\">Mufy 核心字段 Token（5项）</div>',",
    "'    <div class=\"wb-section-title\">Mufy 原生 Token（5项）</div>',",
    1
)

start = s.index('  function updateWbRightPanel() {')
end = s.index('  /* ─── 样式注入 ─── */', start)

fn = '''  function updateWbRightPanel() {
    if (!wbEl || wbCurrentIndex < 0) return;

    function findField(fieldId) {
      for (var i = 0; i < fields.length; i += 1) {
        if (fields[i].id === fieldId) return fields[i];
      }
      return null;
    }

    function readNativeToken(field) {
      if (!field || !field.el || !field.el.isConnected) return null;

      var selector = 'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';
      var current = field.el.parentElement;

      for (var depth = 0; depth < 9 && current; depth += 1) {
        var edits = Array.from(current.querySelectorAll(selector));

        if (edits.length === 1 && edits[0] === field.el) {
          var nodes = Array.from(current.querySelectorAll('*'));

          for (var n = 0; n < nodes.length; n += 1) {
            var node = nodes[n];
            if (node.querySelector(selector)) continue;

            var match = asText(node.textContent).trim().match(/^token\\s*:\\s*([0-9][0-9,]*)$/i);
            if (match) return Number(match[1].replace(/,/g, ''));
          }
        }

        current = current.parentElement;
      }

      return null;
    }

    var snap = wbSnapshot[wbCurrentIndex];
    var currentField = findField(snap.fieldId);
    var currentNative = readNativeToken(currentField);
    var draftChanged = snap.draftContent !== snap.originalContent;

    wbEl.querySelector('#mufy-wb-orig-token').textContent =
      currentNative === null ? '未读取' : currentNative + ' token';
    wbEl.querySelector('#mufy-wb-draft-token').textContent = draftChanged
      ? '待 Mufy 计数'
      : (currentNative === null ? '未读取' : currentNative + ' token');

    var deltaEl = wbEl.querySelector('#mufy-wb-token-delta');
    deltaEl.textContent = draftChanged ? '草稿待注入确认' : '无变化';
    deltaEl.style.color = draftChanged ? '#fbbf24' : '#9a9aae';

    var list = wbEl.querySelector('#mufy-wb-tracked-list');
    list.innerHTML = '';

    var total = 0;
    var unread = [];

    TRACKED_FIELD_LABELS.forEach(function (label) {
      var field = null;
      var expected = compactText(label).replace(/[＆﹠]/g, '&');

      for (var i = 0; i < fields.length; i += 1) {
        var actual = compactText(fields[i].label).replace(/[＆﹠]/g, '&');
        var raw = compactText(fields[i].rawLabel).replace(/[＆﹠]/g, '&');
        if (actual === expected || raw === expected) {
          field = fields[i];
          break;
        }
      }

      var tokens = readNativeToken(field);
      if (tokens === null) unread.push(label);
      else total += tokens;

      var row = document.createElement('div');
      row.className = 'wb-info-row wb-tracked-row';
      row.innerHTML =
        '<span class="wb-info-key wb-tracked-label" title="' + escapeHtml(label) + '">' +
        escapeHtml(label) + '</span>' +
        '<span class="wb-info-val">' + (tokens === null ? '未读取' : tokens) + '</span>';
      list.appendChild(row);
    });

    if (unread.length) {
      var note = document.createElement('div');
      note.style.cssText = 'font-size:10px;line-height:1.5;color:#fbbf24;margin-top:2px';
      note.textContent = '缺少 ' + unread.length + ' 项原生读数：展开字段后重新扫描';
      list.appendChild(note);
    }

    var totalEl = wbEl.querySelector('#mufy-wb-total-token');
    var bar = wbEl.querySelector('#mufy-wb-bar');

    if (unread.length) {
      totalEl.textContent = '待读取 ' + unread.length + ' 项';
      totalEl.style.color = '#fbbf24';
      bar.style.width = '0%';
      bar.style.background = '#f59e0b';
      return;
    }

    totalEl.textContent = total + ' / ' + TOKEN_LIMIT + ' token';

    var pct = Math.min(total / TOKEN_LIMIT * 100, 100);
    var isOver = total > TOKEN_LIMIT;
    var isWarn = total > TOKEN_LIMIT * 0.85;

    bar.style.width = pct + '%';
    bar.style.background = isOver ? '#ef4444' : (isWarn ? '#f59e0b' : '#8b5cf6');
    totalEl.style.color = isOver ? '#f87171' : (isWarn ? '#fbbf24' : '#c4b5fd');
  }

'''

s = s[:start] + fn + s[end:]
p.write_text(s, encoding='utf-8')

c = Path('CHANGELOG.md')
entry = '''## v0.4.3 — 2026-06-21

### 修复
- Token 预算改用 Mufy 编辑器各字段标题旁的原生 token 数值，不再采用本地字符近似算法。
- 只统计人设、开场设计、输出设定、情节设定、样例对话&文风五项。
- 草稿未写回 Mufy 前显示“待 Mufy 计数”，不会以估算值参与 20090 上限判断。
- 未读到原生读数时显示“未读取”，并要求展开字段后重新扫描。
- 资料库仍不自动计入五项合计；若卡内包含资料库，用户自行额外预留约 5000 Token。

'''
old = c.read_text(encoding='utf-8') if c.exists() else '# 更新日志\n\n'
if '## v0.4.3' not in old:
    prefix = '# 更新日志\n\n'
    body = old[len(prefix):] if old.startswith(prefix) else old
    c.write_text(prefix + entry + body.lstrip(), encoding='utf-8')
