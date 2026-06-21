import fs from 'node:fs';

const file = 'plugintempermonkey.js';
let s = fs.readFileSync(file, 'utf8');

function replaceOnce(from, to, label) {
  const first = s.indexOf(from);
  if (first < 0 || s.indexOf(from, first + from.length) >= 0) {
    throw new Error(label + ': expected exactly one match');
  }
  s = s.slice(0, first) + to + s.slice(first + from.length);
}

replaceOnce('// @version      0.5.5', '// @version      0.5.6', 'metadata version');
replaceOnce(
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、三态草稿层与安全单字段注入',
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含物品聚合扫描、全屏工作台、三态草稿层与安全单字段注入',
  'metadata description'
);
replaceOnce('<span>🧩 Mufy 字段助手 V0.5.5</span>', '<span>🧩 Mufy 字段助手 V0.5.6</span>', 'panel version');
replaceOnce("helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.5';", "helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.6';", 'runtime version');
replaceOnce('/* ─── V0.5.5｜单字段注入安全层 ─── */', '/* ─── V0.5.6｜单字段注入安全层 ─── */', 'safety layer title');

replaceOnce(
  '  var wbTokenTimer = null;\n',
  '  var wbTokenTimer = null;\n  // 物品分组面板的展开状态：仅当前页面会话有效。\n  var itemGroupExpanded = {};\n',
  'item group state'
);

replaceOnce(
  '    pairItemFields(fields);\n    disambiguateLabels(fields);\n    return fields;',
  '    pairItemFields(fields);\n    disambiguateLabels(fields);\n    itemGroupExpanded = {};\n    return fields;',
  'scan reset'
);

const styleAnchor = "       '.mufy-field-badge.unconfirmed{background:#4b351d;color:#fcd34d}',";
const styleExtra = [
  styleAnchor,
  "       '.mufy-item-entity{margin:7px 0;border:1px solid #3b345b;border-radius:8px;background:#20202c;overflow:hidden}',",
  "       '.mufy-item-head{display:flex;align-items:center;gap:7px;padding:8px 8px;background:#29263a}',",
  "       '.mufy-item-name{flex:1;min-width:0;color:#f0ecff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',",
  "       '.mufy-item-summary{font-size:10px;color:#aaa3cf;white-space:nowrap}',",
  "       '.mufy-item-toggle{background:#3b3655!important;color:#ded8ff!important;border:none;border-radius:5px;padding:3px 7px!important;font-size:10px!important;cursor:pointer}',",
  "       '.mufy-item-children{border-top:1px solid #38334f;padding:0 5px 4px}',",
  "       '.mufy-item-child-row{padding-left:8px!important;border-bottom-color:#302d40!important}',",
  "       '.mufy-item-child-name{flex:1;min-width:130px;color:#c8c3e8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',",
  "       '.mufy-item-note{padding:0 9px 8px;font-size:10px;color:#8f8ca8;line-height:1.5}'"
].join('\n');
replaceOnce(styleAnchor, styleExtra, 'item styles');

const renderStart = '  /* ─── 字段列表渲染（浮动面板） ─── */\n\n';
const renderEnd = '  /* ─── 面板构建 ─── */';
const a = s.indexOf(renderStart);
const b = s.indexOf(renderEnd, a);
if (a < 0 || b < 0) throw new Error('render section not found');

const renderReplacement = [
  '  /* ─── 字段列表渲染（浮动面板） ─── */',
  '',
  '  function isItemEntityField(field) {',
  "    return !!(field && field.group && field.group.indexOf('物品｜') === 0);",
  '  }',
  '',
  '  function getItemEntities() {',
  '    var byKey = {};',
  '    var result = [];',
  '    fields.forEach(function (field) {',
  '      if (!isItemEntityField(field)) return;',
  '      var key = field.group;',
  '      if (!byKey[key]) {',
  '        byKey[key] = {',
  '          key: key,',
  "          name: key.replace(/^物品｜/, '') || '未命名物品',",
  '          fields: []',
  '        };',
  '        result.push(byKey[key]);',
  '      }',
  '      byKey[key].fields.push(field);',
  '    });',
  '    return result;',
  '  }',
  '',
  '  function getItemEntitySelection(entity) {',
  '    var enabled = entity.fields.filter(function (field) { return field.enabled; }).length;',
  '    return {',
  '      enabled: enabled,',
  '      all: entity.fields.length > 0 && enabled === entity.fields.length,',
  '      mixed: enabled > 0 && enabled < entity.fields.length',
  '    };',
  '  }',
  '',
  '  function buildFieldRow(field, options) {',
  '    var opts = options || {};',
  "    var row = document.createElement('div');",
  "    row.className = 'mufy-field-row' +",
  "      (opts.compact ? ' mufy-item-child-row' : '') +",
  "      (field.isUnrecognized || field.needsReview ? ' is-unconfirmed' : '');",
  '',
  "    var checkbox = document.createElement('input');",
  "    checkbox.type = 'checkbox';",
  '    checkbox.checked = field.enabled;',
  "    checkbox.addEventListener('change', function () {",
  '      field.enabled = checkbox.checked;',
  '      if (opts.onChanged) opts.onChanged();',
  '    });',
  '',
  "    var badge = document.createElement('span');",
  '    var status = getFieldStatus(field);',
  '    badge.textContent = status;',
  "    badge.className = 'mufy-field-badge';",
  "    if (status === '已分组') badge.className += ' inferred';",
  "    if (status === '未识别' || status === '需确认') badge.className += ' unconfirmed';",
  '',
  '    if (opts.compact) {',
  "      var childName = document.createElement('span');",
  "      childName.className = 'mufy-item-child-name';",
  '      childName.textContent = field.role || field.label;',
  '      childName.title = field.label;',
  '      row.appendChild(checkbox);',
  '      row.appendChild(childName);',
  '    } else {',
  "      var nameInput = document.createElement('input');",
  "      nameInput.type = 'text';",
  '      nameInput.value = field.label;',
  "      nameInput.title = '可修改本次会话中的导出标题；重新扫描后会恢复自动识别';",
  "      nameInput.addEventListener('change', function () {",
  '        var nextLabel = nameInput.value.trim();',
  '        if (!nextLabel) { nameInput.value = field.label; return; }',
  '        field.label = nextLabel;',
  '        field.manualName = true;',
  '        field.isUnrecognized = false;',
  '        field.needsReview = false;',
  '        field.isInferred = false;',
  "        row.classList.remove('is-unconfirmed');",
  "        badge.textContent = '已手动确认';",
  "        badge.className = 'mufy-field-badge inferred';",
  '      });',
  '      row.appendChild(checkbox);',
  '      row.appendChild(nameInput);',
  '    }',
  '',
  "    var length = document.createElement('span');",
  "    length.className = 'len';",
  '    length.textContent = estimateTokens(getValue(field.el)) + \' tk\';',
  '',
  "    var rebindButton = document.createElement('button');",
  "    rebindButton.textContent = '本次重绑';",
  "    rebindButton.title = '仅在本次页面会话内生效，刷新或重新扫描后会失效';",
  "    rebindButton.addEventListener('click', function () {",
  "      toast('请直接点击页面上的输入框本体（Esc 取消）');",
  "      panelEl.classList.remove('open');",
  '      startPicker(function (target) {',
  '        field.el = target;',
  '        field.type = getFieldType(target);',
  '        field.isUnrecognized = false;',
  '        field.needsReview = false;',
  '        field.isInferred = false;',
  '        field.enabled = true;',
  "        panelEl.classList.add('open');",
  '        renderList();',
  '        toast(\'"\' + field.label + \'"本次重绑成功\');',
  '      });',
  '    });',
  '',
  "    var meta = document.createElement('div');",
  "    meta.className = 'mufy-field-meta';",
  '    meta.textContent = getFieldMeta(field);',
  '    meta.title = meta.textContent;',
  '',
  '    row.appendChild(badge);',
  '    row.appendChild(length);',
  '    row.appendChild(rebindButton);',
  '    if (!opts.compact) row.appendChild(meta);',
  '    return row;',
  '  }',
  '',
  '  function buildItemEntityRow(entity) {',
  "    var box = document.createElement('div');",
  "    box.className = 'mufy-item-entity';",
  "    var head = document.createElement('div');",
  "    head.className = 'mufy-item-head';",
  "    var checkbox = document.createElement('input');",
  "    checkbox.type = 'checkbox';",
  '    var selected = getItemEntitySelection(entity);',
  '    checkbox.checked = selected.all;',
  '    checkbox.indeterminate = selected.mixed;',
  "    checkbox.title = '勾选或取消勾选此物品的全部基础字段';",
  "    checkbox.addEventListener('change', function () {",
  '      entity.fields.forEach(function (field) { field.enabled = checkbox.checked; });',
  '      renderList();',
  '    });',
  "    var name = document.createElement('div');",
  "    name.className = 'mufy-item-name';",
  "    name.textContent = '物品｜' + entity.name;",
  '    name.title = entity.key;',
  "    var summary = document.createElement('span');",
  "    summary.className = 'mufy-item-summary';",
  "    summary.textContent = '基础字段 ' + entity.fields.length + ' 项';",
  "    var toggle = document.createElement('button');",
  "    toggle.className = 'mufy-item-toggle';",
  "    toggle.type = 'button';",
  '    var expanded = !!itemGroupExpanded[entity.key];',
  "    toggle.textContent = expanded ? '收起' : '展开';",
  "    toggle.addEventListener('click', function () {",
  '      itemGroupExpanded[entity.key] = !itemGroupExpanded[entity.key];',
  '      renderList();',
  '    });',
  '    head.appendChild(checkbox);',
  '    head.appendChild(name);',
  '    head.appendChild(summary);',
  '    head.appendChild(toggle);',
  '    box.appendChild(head);',
  "    var note = document.createElement('div');",
  "    note.className = 'mufy-item-note';",
  "    note.textContent = '交互提示词与使用后文案需打开对应交互编辑窗后再采集。';",
  '    box.appendChild(note);',
  '    if (expanded) {',
  "      var children = document.createElement('div');",
  "      children.className = 'mufy-item-children';",
  '      entity.fields.forEach(function (field) {',
  '        children.appendChild(buildFieldRow(field, {',
  '          compact: true,',
  '          onChanged: function () { renderList(); }',
  '        }));',
  '      });',
  '      box.appendChild(children);',
  '    }',
  '    return box;',
  '  }',
  '',
  '  function renderList() {',
  '    if (!listEl) return;',
  "    listEl.innerHTML = '';",
  '    var entities = getItemEntities();',
  '    var entityByKey = {};',
  '    entities.forEach(function (entity) { entityByKey[entity.key] = entity; });',
  '    var renderedItems = {};',
  '    fields.forEach(function (field) {',
  '      if (isItemEntityField(field)) {',
  '        if (renderedItems[field.group]) return;',
  '        renderedItems[field.group] = true;',
  '        listEl.appendChild(buildItemEntityRow(entityByKey[field.group]));',
  '        return;',
  '      }',
  '      listEl.appendChild(buildFieldRow(field));',
  '    });',
  '  }',
  '',
].join('\n');

s = s.slice(0, a) + renderReplacement + s.slice(b);

replaceOnce(
  "      var message = '扫描到 ' + fields.length + ' 个字段';\n      if (pending) message += '，其中 ' + pending + ' 个需确认且默认未勾选';",
  "      var message = '扫描到 ' + fields.length + ' 个字段';\n      var itemCount = getItemEntities().length;\n      if (itemCount) message += '；已聚合 ' + itemCount + ' 件物品';\n      if (pending) message += '，其中 ' + pending + ' 个需确认且默认未勾选';",
  'scan message'
);

fs.writeFileSync(file, s, 'utf8');
