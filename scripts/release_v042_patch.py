from pathlib import Path

path = Path('plugintempermonkey.js')
source = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(label + ': expected 1 match, found ' + str(count))
    source = source.replace(old, new, 1)


replace_once(
    '// @version      0.4.1\n'
    '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、草稿保护与 Token 预算',
    '// @version      0.4.2\n'
    '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、草稿保护与严格 Token 预算',
    'metadata'
)

replace_once(
    "  /* ─── 关键字段关键词（用于 Token 合计统计） ─── */\n"
    "  var TRACKED_KEYWORDS = ['人设', '角色设定', '开场设计', '输出设定', '情节设定', '样例对话', '文风'];",
    "  /* ─── Mufy 核心字段（Token 合计只统计这五项） ─── */\n"
    "  var TRACKED_FIELD_LABELS = ['人设', '开场设计', '输出设定', '情节设定', '样例对话&文风'];",
    'token whitelist'
)

start = source.index('  function isTrackedLabel(label) {')
end = source.index('  function escapeHtml(value) {', start)
helpers = '''  function normalizeTrackedLabel(label) {
    return compactText(label).replace(/[＆﹠]/g, '&');
  }

  function isTrackedLabel(label) {
    var normalized = normalizeTrackedLabel(label);
    return TRACKED_FIELD_LABELS.some(function (expected) {
      return normalized === normalizeTrackedLabel(expected);
    });
  }

  function getTrackedFieldByLabel(expectedLabel) {
    var expected = normalizeTrackedLabel(expectedLabel);
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (normalizeTrackedLabel(field.label) === expected || normalizeTrackedLabel(field.rawLabel) === expected) {
        return field;
      }
    }
    return null;
  }

  function getWbSnapshotByFieldId(fieldId) {
    for (var i = 0; i < wbSnapshot.length; i += 1) {
      if (wbSnapshot[i].fieldId === fieldId) return wbSnapshot[i];
    }
    return null;
  }

  function getTrackedFieldContent(field) {
    var snap = getWbSnapshotByFieldId(field.id);
    if (snap) return snap.draftContent;
    if (!field.el || !field.el.isConnected) return null;
    return getValue(field.el);
  }

'''
source = source[:start] + helpers + source[end:]

replace_once(
    "      return {\n"
    "        label: field.label,\n"
    "        originalContent: content,\n"
    "        draftContent: content\n"
    "      };",
    "      return {\n"
    "        fieldId: field.id,\n"
    "        label: field.label,\n"
    "        originalContent: content,\n"
    "        draftContent: content\n"
    "      };",
    'snapshot field id'
)

replace_once(
    "      '    <div class=\"wb-section-title\">本次已选关键字段合计</div>',",
    "      '    <div class=\"wb-section-title\">Mufy 核心字段 Token（5项）</div>',",
    'right panel title'
)

replace_once(
    "      '      ⚠️ 若启用资料库，额外占用约 5000 Token，请自行计入上限。',",
    "      '      ⚠️ 若此卡包含资料库，请手动额外预留约 5000 Token；本计数不自动加入。',",
    'library note'
)

old_total_start = source.index('    // 关键字段合计：遍历快照，找到标签匹配关键词的字段')
old_total_end = source.index('    // 进度条', old_total_start)
new_total = '''    // Mufy 核心字段 Token：只统计五个固定字段。
    // 已进入工作台的字段使用草稿；未勾选但已扫描的字段读取 Mufy 当前内容。
    var trackedListEl = wbEl.querySelector('#mufy-wb-tracked-list');
    trackedListEl.innerHTML = '';
    var total = 0;
    var missingLabels = [];

    TRACKED_FIELD_LABELS.forEach(function (label) {
      var field = getTrackedFieldByLabel(label);
      var content = field ? getTrackedFieldContent(field) : null;
      var tokens = 0;

      if (content === null) {
        missingLabels.push(label);
      } else {
        tokens = estimateTokens(content);
        total += tokens;
      }

      var row = document.createElement('div');
      row.className = 'wb-info-row wb-tracked-row';
      row.innerHTML =
        '<span class="wb-info-key wb-tracked-label" title="' + escapeHtml(label) + '">' +
        escapeHtml(label) + '</span>' +
        '<span class="wb-info-val">' + (content === null ? '未扫描' : tokens) + '</span>';
      trackedListEl.appendChild(row);
    });

    if (missingLabels.length) {
      var missingRow = document.createElement('div');
      missingRow.style.cssText = 'font-size:10px;line-height:1.5;color:#fbbf24;margin-top:2px';
      missingRow.textContent = '缺少 ' + missingLabels.length + ' 项：展开对应区块后重新扫描';
      trackedListEl.appendChild(missingRow);
    }

    wbEl.querySelector('#mufy-wb-total-token').textContent = total + ' / ' + TOKEN_LIMIT + ' token';

'''
source = source[:old_total_start] + new_total + source[old_total_end:]

path.write_text(source, encoding='utf-8')

changelog = Path('CHANGELOG.md')
entry = '''## v0.4.2 — 2026-06-21

### 修复
- Token 总量严格只统计：人设、开场设计、输出设定、情节设定、样例对话&文风。
- 移除“角色设定”等额外兼容关键词，不再因模糊匹配把其他字段算进总量。
- 已进入工作台的核心字段使用草稿；未勾选但已扫描的核心字段仍读取 Mufy 当前内容参与预算。
- 未扫描到的核心字段会明确显示“未扫描”，避免静默低估。
- 若卡内包含资料库，用户需自行额外预留约 5000 Token；插件不会自动加入总数。

'''
if changelog.exists():
    old = changelog.read_text(encoding='utf-8')
    if '## v0.4.2' not in old:
        prefix = '# 更新日志\n\n'
        if old.startswith(prefix):
            old = old[len(prefix):]
        changelog.write_text(prefix + entry + old.lstrip(), encoding='utf-8')
else:
    changelog.write_text('# 更新日志\n\n' + entry, encoding='utf-8')
