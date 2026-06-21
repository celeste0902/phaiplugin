from pathlib import Path

p = Path('plugintempermonkey.js')
s = p.read_text(encoding='utf-8')

if '// @version      0.4.3' not in s:
    raise SystemExit('Expected v0.4.3 source before v0.4.4 release')

s = s.replace(
    '// @version      0.4.3\n// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、草稿保护与 Mufy 原生 Token 预算',
    '// @version      0.4.4\n// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、草稿保护与 Mufy 原生 Token 实时预算',
    1
)

version_note = '''  /*
    V0.4.4 修复：Mufy 原生 Token 作为唯一预算读数
    - 五项总量只读取每张字段卡标题旁的 Mufy token 数值。
    - 不再用本地字符估算补数，也不将 20950 硬编码为固定上限。
    - 当前卡的原生五项总量会按 Mufy 页面显示自动汇总；例如当前读数为 20950 时即显示 20950 / 20090。
    - 草稿未写回 Mufy 前标记“待 Mufy 计数”，避免用假精度误导超限判断。

'''
needle = '  /*\n    V0.4.1 修复：草稿导出、退出保护与 Token 统计性能'
if needle in s and 'V0.4.4 修复：Mufy 原生 Token' not in s:
    s = s.replace(needle, version_note + needle, 1)

s = s.replace(
    "'    <div class=\"wb-section-title\">Mufy 核心字段 Token（5项）</div>',",
    "'    <div class=\"wb-section-title\">Mufy 原生 Token（5项）</div>',",
    1
)

start = s.index('  function updateWbRightPanel() {')
end = s.index('  /* ─── 样式注入 ─── */', start)

fn = '''  function updateWbRightPanel() {
    if (!wbEl || wbCurrentIndex < 0) return;

    function normalizeTokenLabel(value) {
      return compactText(value).replace(/[＆﹠]/g, '&');
    }

    function findField(fieldId) {
      for (var i = 0; i < fields.length; i += 1) {
        if (fields[i].id === fieldId) return fields[i];
      }
      return null;
    }

    function findCoreField(label) {
      var expected = normalizeTokenLabel(label);

      for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        var visibleLabel = normalizeTokenLabel(field.label);
        var rawLabel = normalizeTokenLabel(field.rawLabel);

        if (visibleLabel === expected || rawLabel === expected) return field;
      }

      return null;
    }

    function readNativeMufyToken(field) {
      if (!field || !field.el || !field.el.isConnected) return null;

      var selector = 'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';
      var current = field.el.parentElement;

      for (var depth = 0; depth < 9 && current; depth += 1) {
        var editables = Array.from(current.querySelectorAll(selector));

        if (editables.length === 1 && editables[0] === field.el) {
          var nodes = Array.from(current.querySelectorAll('*'));

          for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
            var node = nodes[nodeIndex];

            if (node.querySelector(selector)) continue;

            var text = asText(node.textContent).trim();
            var match = text.match(/^token\s*:\s*([0-9][0-9,]*)$/i);

            if (match) return Number(match[1].replace(/,/g, ''));
          }
        }

        current = current.parentElement;
      }

      return null;
    }

    var snap = wbSnapshot[wbCurrentIndex];
    var currentField = findField(snap.fieldId);
    var currentNativeToken = readNativeMufyToken(currentField);
    var draftChanged = snap.draftContent !== snap.originalContent;

    wbEl.querySelector('#mufy-wb-orig-token').textContent =
      currentNativeToken === null ? '未读取' : currentNativeToken + ' token';

    wbEl.querySelector('#mufy-wb-draft-token').textContent = draftChanged
      ? '待 Mufy 计数'
      : (currentNativeToken === null ? '未读取' : currentNativeToken + ' token');

    var deltaEl = wbEl.querySelector('#mufy-wb-token-delta');
    deltaEl.textContent = draftChanged ? '草稿待注入确认' : '无变化';
    deltaEl.style.color = draftChanged ? '#fbbf24' : '#9a9aae';

    var list = wbEl.querySelector('#mufy-wb-tracked-list');
    list.innerHTML = '';

    var total = 0;
    var unreadLabels = [];

    TRACKED_FIELD_LABELS.forEach(function (label) {
      var field = findCoreField(label);
      var token = readNativeMufyToken(field);

      if (token === null) unreadLabels.push(label);
      else total += token;

      var row = document.createElement('div');
      row.className = 'wb-info-row wb-tracked-row';
      row.innerHTML =
        '<span class="wb-info-key wb-tracked-label" title="' + escapeHtml(label) + '">' +
        escapeHtml(label) + '</span>' +
        '<span class="wb-info-val">' + (token === null ? '未读取' : token) + '</span>';
      list.appendChild(row);
    });

    var totalEl = wbEl.querySelector('#mufy-wb-total-token');
    var bar = wbEl.querySelector('#mufy-wb-bar');
    var limitLabel = wbEl.querySelector('#mufy-wb-limit-label');

    limitLabel.textContent = 'Mufy 原生读数 / ' + TOKEN_LIMIT + ' Token';

    if (unreadLabels.length) {
      var unreadNote = document.createElement('div');
      unreadNote.style.cssText = 'font-size:10px;line-height:1.5;color:#fbbf24;margin-top:2px';
      unreadNote.textContent = '缺少 ' + unreadLabels.length + ' 项原生读数：展开字段后重新扫描';
      list.appendChild(unreadNote);

      totalEl.textContent = '待读取 ' + unreadLabels.length + ' 项';
      totalEl.style.color = '#fbbf24';
      totalEl.title = '只有 Mufy 页面标题旁的 token 数字会参与预算';
      bar.style.width = '0%';
      bar.style.background = '#f59e0b';
      return;
    }

    var overBy = total - TOKEN_LIMIT;
    var isOver = overBy > 0;
    var isWarn = total > TOKEN_LIMIT * 0.85;
    var pct = Math.min(total / TOKEN_LIMIT * 100, 100);

    totalEl.textContent = total + ' / ' + TOKEN_LIMIT + ' token';
    totalEl.style.color = isOver ? '#f87171' : (isWarn ? '#fbbf24' : '#c4b5fd');
    totalEl.title = '来源：Mufy 五个字段标题旁的原生 token 数值';

    bar.style.width = pct + '%';
    bar.style.background = isOver ? '#ef4444' : (isWarn ? '#f59e0b' : '#8b5cf6');

    if (isOver) {
      var overNote = document.createElement('div');
      overNote.style.cssText = 'font-size:10px;line-height:1.5;color:#fca5a5;margin-top:2px';
      overNote.textContent = '当前按 Mufy 原生读数超出 ' + overBy + ' Token';
      list.appendChild(overNote);
    }
  }

'''

s = s[:start] + fn + s[end:]
p.write_text(s, encoding='utf-8')

c = Path('CHANGELOG.md')
entry = '''## v0.4.4 — 2026-06-21

### 修复
- 五项预算统一以 Mufy 字段标题旁的原生 token 数值为准，插件不再用本地字符算法补数。
- 当前卡若 Mufy 读数为 20950，工作台会动态显示 20950 / 20090；20950 是当前消耗，不被写死为固定上限。
- 所有五项原生读数缺失时明确提示展开字段后重新扫描；没有完整读数时不做超限判断。
- 草稿未写回 Mufy 时显示“待 Mufy 计数”，防止本地估算制造错误精度。
- 实际超限时显示超出 Token 数，方便直接决定压缩量。

'''
old = c.read_text(encoding='utf-8') if c.exists() else '# 更新日志\n\n'
if '## v0.4.4' not in old:
    prefix = '# 更新日志\n\n'
    body = old[len(prefix):] if old.startswith(prefix) else old
    c.write_text(prefix + entry + body.lstrip(), encoding='utf-8')
