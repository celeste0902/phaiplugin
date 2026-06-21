import fs from 'node:fs';

const file = 'plugintempermonkey.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(from, to, name) {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + from.length) >= 0) {
    throw new Error(name + ': expected exactly one match');
  }
  source = source.slice(0, at) + to + source.slice(at + from.length);
}

replaceOnce('// @version      0.5.5', '// @version      0.5.7', 'metadata version');
replaceOnce(
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、三态草稿层与安全单字段注入',
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含物品聚合、全屏工作台、三态草稿层与安全单字段注入',
  'metadata description'
);
replaceOnce('<span>🧩 Mufy 字段助手 V0.5.5</span>', '<span>🧩 Mufy 字段助手 V0.5.7</span>', 'panel title');
replaceOnce("helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.5';", "helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.7';", 'runtime title');
replaceOnce('/* ─── V0.5.5｜单字段注入安全层 ─── */', '/* ─── V0.5.7｜单字段注入安全层 ─── */', 'safety title');

if (source.includes('V0.5.7｜物品聚合视图')) {
  throw new Error('v0.5.7 patch already present');
}

const patch = String.raw`
  /* ─── V0.5.7｜物品聚合视图 ─── */
  /*
    只调整导航与列表呈现：
    - 浮动面板：名称/描述聚成一件物品，可折叠。
    - 工作台左栏：同样按物品聚合，子字段仍保留精确写入链路。
    - 不采集未打开的交互弹窗，不改写入、Token 或撤回逻辑。
  */

  var v057ItemListExpanded = {};
  var v057WbItemExpanded = {};
  var v057BaseRenderList = renderList;
  var v057BaseSelectWbField = selectWbField;

  function v057InjectItemStyles() {
    if (document.getElementById('mufy-v057-item-style')) return;

    var style = document.createElement('style');
    style.id = 'mufy-v057-item-style';
    style.textContent = [
      '.mufy-v057-section{margin:8px 0 4px;padding:7px 8px;border-radius:6px;background:#242238;color:#cfc9ff;font-size:11px;font-weight:600}',
      '.mufy-v057-section small{margin-left:6px;color:#8f8aac;font-weight:400}',
      '.mufy-v057-item-card{margin:6px 0;border:1px solid #3b355a;border-radius:8px;background:#1f1f2b;overflow:hidden}',
      '.mufy-v057-item-head{display:flex;align-items:center;gap:7px;padding:8px;background:#2a273d}',
      '.mufy-v057-item-name{flex:1;min-width:0;color:#f0ecff;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
      '.mufy-v057-item-summary{font-size:10px;color:#aaa4ce;white-space:nowrap}',
      '.mufy-v057-toggle{background:#403a60!important;color:#e5dfff!important;border:none;border-radius:5px;padding:3px 7px!important;font-size:10px!important;cursor:pointer}',
      '.mufy-v057-note{padding:0 9px 8px;color:#8f8ba4;font-size:10px;line-height:1.5}',
      '.mufy-v057-children{border-top:1px solid #37324f;padding:0 5px 4px}',
      '.mufy-v057-child-row{padding-left:8px!important;border-bottom-color:#302d42!important}',
      '.mufy-v057-child-label{flex:1;min-width:110px;color:#cbc6e7;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mufy-v057-wb-section{padding:8px 12px;background:#1c1b2b;color:#9e96d5;font-size:11px;font-weight:600;border-bottom:1px solid #29263d}',
      '.mufy-v057-wb-card{border-bottom:1px solid #242238;background:#181825}',
      '.mufy-v057-wb-head{display:flex;align-items:center;gap:7px;padding:9px 10px;background:#211f31}',
      '.mufy-v057-wb-name{flex:1;min-width:0;color:#d9d3ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
      '.mufy-v057-wb-summary{font-size:10px;color:#8f89ac;white-space:nowrap}',
      '.mufy-v057-wb-toggle{background:#34304e;border:none;color:#ded8ff;border-radius:5px;padding:3px 7px;font-size:10px;cursor:pointer}',
      '.mufy-v057-wb-children{background:#151521}',
      '.mufy-v057-wb-child{padding:8px 12px 8px 26px;cursor:pointer;border-bottom:1px solid #1d1c2b;font-size:12px;color:#aaa5c9;display:flex;align-items:center;gap:8px}',
      '.mufy-v057-wb-child:hover{background:#1e1d31}',
      '.mufy-v057-wb-child.active{background:#28194a;color:#d5cbff;border-left:3px solid #8b5cf6;padding-left:23px}'
    ].join('');
    document.head.appendChild(style);
  }

  function v057IsItemField(field) {
    return !!(field && field.group && field.group.indexOf('物品｜') === 0);
  }

  function v057FieldById(fieldId) {
    for (var i = 0; i < fields.length; i += 1) {
      if (fields[i].id === fieldId) return fields[i];
    }
    return null;
  }

  function v057ItemNameFromGroup(group, fallback) {
    var name = asText(group).replace(/^物品｜/, '').replace(/（#[0-9]+）$/, '').trim();
    return name || fallback || '未命名物品';
  }

  function v057BuildEntities(records, getField, getIndex) {
    var entities = [];
    var active = null;

    records.forEach(function (record, position) {
      var field = getField(record);

      if (!v057IsItemField(field)) {
        active = null;
        return;
      }

      var index = getIndex(record, position);
      var startsItem = field.role === '名称' || !active || active.group !== field.group;

      if (startsItem) {
        active = {
          key: 'item-' + field.id,
          group: field.group,
          name: v057ItemNameFromGroup(field.group, field.label),
          indexes: [],
          records: []
        };
        entities.push(active);
      }

      active.indexes.push(index);
      active.records.push(record);
    });

    return entities;
  }

  function v057BuildFieldEntities() {
    return v057BuildEntities(
      fields,
      function (field) { return field; },
      function (field, index) { return index; }
    );
  }

  function v057BuildWbEntities() {
    return v057BuildEntities(
      wbSnapshot,
      function (snap) { return v057FieldById(snap.fieldId); },
      function (snap, index) { return index; }
    );
  }

  function v057EntitySelection(entity) {
    var enabled = entity.records.filter(function (field) {
      return field.enabled;
    }).length;

    return {
      enabled: enabled,
      all: entity.records.length > 0 && enabled === entity.records.length,
      mixed: enabled > 0 && enabled < entity.records.length
    };
  }

  function v057EntityStatus(entity) {
    var status = 'clean';

    entity.records.forEach(function (snap) {
      if (snap.syncStatus === 'failed' || snap.syncStatus === 'stale') status = 'failed';
      else if (status !== 'failed' && snap.syncStatus === 'dirty') status = 'dirty';
      else if (status === 'clean' && snap.syncStatus === 'synced') status = 'synced';
    });

    return status;
  }

  function v057StatusText(status) {
    if (status === 'failed') return '需检查';
    if (status === 'dirty') return '有草稿';
    if (status === 'synced') return '已同步';
    return '未修改';
  }

  function v057StatusColor(status) {
    return WB_DOT_COLOR[status] || '#4a4a62';
  }

  function v057BuildFloatItemCard(entity, rowsByIndex) {
    var card = document.createElement('div');
    card.className = 'mufy-v057-item-card';

    var head = document.createElement('div');
    head.className = 'mufy-v057-item-head';

    var selection = v057EntitySelection(entity);
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selection.all;
    checkbox.indeterminate = selection.mixed;
    checkbox.title = '勾选或取消勾选这件物品当前扫描到的全部基础字段';
    checkbox.addEventListener('change', function () {
      entity.records.forEach(function (field) {
        field.enabled = checkbox.checked;
      });
      renderList();
    });

    var name = document.createElement('span');
    name.className = 'mufy-v057-item-name';
    name.textContent = '物品｜' + entity.name;
    name.title = entity.group;
    name.addEventListener('click', function () {
      v057ItemListExpanded[entity.key] = !v057ItemListExpanded[entity.key];
      renderList();
    });

    var summary = document.createElement('span');
    summary.className = 'mufy-v057-item-summary';
    summary.textContent = '基础字段 ' + entity.records.length + ' 项';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mufy-v057-toggle';
    toggle.textContent = v057ItemListExpanded[entity.key] ? '收起' : '展开';
    toggle.addEventListener('click', function () {
      v057ItemListExpanded[entity.key] = !v057ItemListExpanded[entity.key];
      renderList();
    });

    head.appendChild(checkbox);
    head.appendChild(name);
    head.appendChild(summary);
    head.appendChild(toggle);
    card.appendChild(head);

    var note = document.createElement('div');
    note.className = 'mufy-v057-note';
    note.textContent = '交互提示词与使用后文案需打开对应交互编辑窗后再采集。';
    card.appendChild(note);

    if (v057ItemListExpanded[entity.key]) {
      var children = document.createElement('div');
      children.className = 'mufy-v057-children';
      entity.indexes.forEach(function (index) {
        var row = rowsByIndex[index];
        if (!row) return;
        row.classList.add('mufy-v057-child-row');
        children.appendChild(row);
      });
      card.appendChild(children);
    }

    return card;
  }

  renderList = function () {
    v057BaseRenderList.apply(this, arguments);
    if (!listEl) return;

    v057InjectItemStyles();

    var title = panelEl ? panelEl.querySelector('#mufy-helper-header span') : null;
    if (title) title.textContent = '🧩 Mufy 字段助手 V0.5.7';

    var rows = Array.from(listEl.querySelectorAll('.mufy-field-row'));
    if (rows.length !== fields.length) return;

    var entities = v057BuildFieldEntities();
    if (!entities.length) return;

    var entityByStart = {};
    var skip = {};
    entities.forEach(function (entity) {
      entityByStart[entity.indexes[0]] = entity;
      entity.indexes.slice(1).forEach(function (index) { skip[index] = true; });
    });

    var fragment = document.createDocumentFragment();
    var sectionAdded = false;

    fields.forEach(function (field, index) {
      if (!v057IsItemField(field)) {
        fragment.appendChild(rows[index]);
        return;
      }

      if (skip[index]) return;

      var entity = entityByStart[index];
      if (!entity) {
        fragment.appendChild(rows[index]);
        return;
      }

      if (!sectionAdded) {
        var section = document.createElement('div');
        section.className = 'mufy-v057-section';
        section.innerHTML = '物品栏<small>' + entities.length + ' 件物品已聚合；交互弹窗需单独采集</small>';
        fragment.appendChild(section);
        sectionAdded = true;
      }

      fragment.appendChild(v057BuildFloatItemCard(entity, rows));
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  };

  function v057BuildWbChild(snap, index) {
    var item = document.createElement('div');
    item.className = 'mufy-v057-wb-child' + (index === wbCurrentIndex ? ' active' : '');
    item.dataset.index = index;

    var dot = document.createElement('span');
    dot.className = 'mufy-wb-dot';
    dot.style.background = v057StatusColor(snap.syncStatus);

    var label = document.createElement('span');
    label.textContent = snap.role || snap.label.replace(/^物品｜[^｜]+｜/, '');
    label.title = snap.label;
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace = 'nowrap';

    item.appendChild(dot);
    item.appendChild(label);
    item.addEventListener('click', function () {
      selectWbField(index);
    });

    return item;
  }

  function v057BuildWbItemCard(entity) {
    var card = document.createElement('div');
    card.className = 'mufy-v057-wb-card';

    var head = document.createElement('div');
    head.className = 'mufy-v057-wb-head';

    var status = v057EntityStatus(entity);
    var dot = document.createElement('span');
    dot.className = 'mufy-wb-dot';
    dot.style.background = v057StatusColor(status);

    var name = document.createElement('span');
    name.className = 'mufy-v057-wb-name';
    name.textContent = '物品｜' + entity.name;
    name.title = entity.group;
    name.addEventListener('click', function () {
      v057WbItemExpanded[entity.key] = true;
      selectWbField(entity.indexes[0]);
    });

    var summary = document.createElement('span');
    summary.className = 'mufy-v057-wb-summary';
    summary.textContent = entity.records.length + ' 项 · ' + v057StatusText(status);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mufy-v057-wb-toggle';

    var expanded = !!v057WbItemExpanded[entity.key] || entity.indexes.indexOf(wbCurrentIndex) >= 0;
    toggle.textContent = expanded ? '收起' : '展开';
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      v057WbItemExpanded[entity.key] = !expanded;
      renderWbFieldList();
    });

    head.appendChild(dot);
    head.appendChild(name);
    head.appendChild(summary);
    head.appendChild(toggle);
    card.appendChild(head);

    if (expanded) {
      var children = document.createElement('div');
      children.className = 'mufy-v057-wb-children';
      entity.records.forEach(function (snap, pos) {
        children.appendChild(v057BuildWbChild(snap, entity.indexes[pos]));
      });
      card.appendChild(children);
    }

    return card;
  }

  renderWbFieldList = function () {
    if (!wbEl) return;

    v057InjectItemStyles();

    var fieldListEl = wbEl.querySelector('#mufy-wb-field-list');
    if (!fieldListEl) return;
    fieldListEl.innerHTML = '';

    var entities = v057BuildWbEntities();
    var entityByStart = {};
    var skip = {};
    entities.forEach(function (entity) {
      entityByStart[entity.indexes[0]] = entity;
      entity.indexes.slice(1).forEach(function (index) { skip[index] = true; });
    });

    var sectionAdded = false;

    wbSnapshot.forEach(function (snap, index) {
      var field = v057FieldById(snap.fieldId);

      if (!v057IsItemField(field)) {
        var item = document.createElement('div');
        item.className = 'mufy-wb-field-item';
        item.dataset.index = index;

        var dot = document.createElement('span');
        dot.className = 'mufy-wb-dot';
        dot.style.background = v057StatusColor(snap.syncStatus);
        dot.title = snap.syncStatus;

        var label = document.createElement('span');
        label.textContent = snap.label;
        label.style.overflow = 'hidden';
        label.style.textOverflow = 'ellipsis';
        label.style.whiteSpace = 'nowrap';

        item.title = snap.label;
        item.appendChild(dot);
        item.appendChild(label);
        item.classList.toggle('active', index === wbCurrentIndex);
        item.addEventListener('click', function () {
          selectWbField(index);
        });
        fieldListEl.appendChild(item);
        return;
      }

      if (skip[index]) return;

      var entity = entityByStart[index];
      if (!entity) return;

      if (!sectionAdded) {
        var section = document.createElement('div');
        section.className = 'mufy-v057-wb-section';
        section.textContent = '物品栏 · ' + entities.length + ' 件物品';
        fieldListEl.appendChild(section);
        sectionAdded = true;
      }

      fieldListEl.appendChild(v057BuildWbItemCard(entity));
    });
  };

  selectWbField = function (index) {
    var result = v057BaseSelectWbField.call(this, index);
    var entities = v057BuildWbEntities();

    entities.forEach(function (entity) {
      if (entity.indexes.indexOf(index) >= 0) {
        v057WbItemExpanded[entity.key] = true;
      }
    });

    renderWbFieldList();
    return result;
  };
`;

const anchor = '  function init() {';
const at = source.indexOf(anchor);
if (at < 0) throw new Error('init anchor not found');
source = source.slice(0, at) + patch + '\n\n' + source.slice(at);
fs.writeFileSync(file, source, 'utf8');
