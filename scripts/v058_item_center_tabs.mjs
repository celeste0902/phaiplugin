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

replaceOnce('// @version      0.5.7', '// @version      0.5.8', 'metadata version');
replaceOnce(
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含物品聚合、全屏工作台、三态草稿层与安全单字段注入',
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含物品聚合工作台、三态草稿层与安全单字段注入',
  'metadata description'
);
source = source.replace(/Mufy 字段助手 V0\.5\.7/g, 'Mufy 字段助手 V0.5.8');
source = source.replace('/* ─── V0.5.7｜单字段注入安全层 ─── */', '/* ─── V0.5.8｜单字段注入安全层 ─── */');

if (source.includes('V0.5.8｜物品上下文标签')) {
  throw new Error('v0.5.8 patch already present');
}

const patch = String.raw`
  /* ─── V0.5.8｜物品上下文标签 ─── */
  /*
    物品仍由名称、描述等原子字段组成；这里只给工作台中间区加入“物品上下文 + 子字段标签”。
    点击标签只切换当前原子字段，写入、撤回、草稿与 Token 链路全部保持原样。
  */

  var v058SelectWbField = selectWbField;
  var v058OpenWorkbench = openWorkbench;

  function v058InjectItemContextStyle() {
    if (document.getElementById('mufy-v058-item-context-style')) return;

    var style = document.createElement('style');
    style.id = 'mufy-v058-item-context-style';
    style.textContent = [
      '#mufy-v058-item-context{display:none;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 11px;border:1px solid #393254;border-radius:8px;background:#1a1928;flex-shrink:0}',
      '#mufy-v058-item-context.show{display:flex}',
      '.mufy-v058-item-context-title{font-size:12px;color:#e5dfff;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mufy-v058-item-tabs{display:flex;gap:6px;flex-wrap:wrap}',
      '.mufy-v058-item-tab{background:#302d45!important;color:#bdb6df!important;border:none;border-radius:5px;padding:4px 9px!important;font-size:12px!important;cursor:pointer}',
      '.mufy-v058-item-tab.active{background:#6d4bc2!important;color:#fff!important}',
      '.mufy-v058-item-context-note{width:100%;font-size:10px;color:#8f89ab;line-height:1.45}'
    ].join('');
    document.head.appendChild(style);
  }

  function v058GetItemName(group) {
    return asText(group).replace(/^物品｜/, '').replace(/（#[0-9]+）$/, '').trim() || '未命名物品';
  }

  function v058GetItemSnapGroup(index) {
    if (index < 0 || index >= wbSnapshot.length) return [];

    var current = wbSnapshot[index];
    var field = getWbFieldByIdV051(current.fieldId);

    if (!field || !field.group || field.group.indexOf('物品｜') !== 0) return [];

    return wbSnapshot.map(function (snap, snapIndex) {
      return { snap: snap, index: snapIndex, field: getWbFieldByIdV051(snap.fieldId) };
    }).filter(function (entry) {
      return entry.field && entry.field.group === field.group;
    });
  }

  function v058EnsureItemContext() {
    if (!wbEl) return null;

    v058InjectItemContextStyle();

    var center = wbEl.querySelector('#mufy-wb-center');
    var label = wbEl.querySelector('#mufy-wb-center-label');
    var context = wbEl.querySelector('#mufy-v058-item-context');

    if (!center || !label) return null;

    if (!context) {
      context = document.createElement('div');
      context.id = 'mufy-v058-item-context';
      center.insertBefore(context, label.nextSibling);
    }

    return context;
  }

  function v058RenderItemContext() {
    var context = v058EnsureItemContext();
    if (!context) return;

    var entries = v058GetItemSnapGroup(wbCurrentIndex);

    if (!entries.length) {
      context.classList.remove('show');
      context.innerHTML = '';
      return;
    }

    var currentField = entries[0].field;
    var title = document.createElement('div');
    title.className = 'mufy-v058-item-context-title';
    title.textContent = '物品｜' + v058GetItemName(currentField.group);
    title.title = currentField.group;

    var tabs = document.createElement('div');
    tabs.className = 'mufy-v058-item-tabs';

    entries.forEach(function (entry) {
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mufy-v058-item-tab' + (entry.index === wbCurrentIndex ? ' active' : '');
      tab.textContent = entry.field.role || entry.snap.label.replace(/^物品｜[^｜]+｜/, '字段');
      tab.title = entry.snap.label;
      tab.addEventListener('click', function () {
        selectWbField(entry.index);
      });
      tabs.appendChild(tab);
    });

    var note = document.createElement('div');
    note.className = 'mufy-v058-item-context-note';
    note.textContent = '当前仍按单字段安全写入 Mufy；名称、描述与后续交互字段不会被拼成一段文本。';

    context.innerHTML = '';
    context.appendChild(title);
    context.appendChild(tabs);
    context.appendChild(note);
    context.classList.add('show');

    var active = wbSnapshot[wbCurrentIndex];
    var activeField = getWbFieldByIdV051(active.fieldId);
    var centerLabel = wbEl.querySelector('#mufy-wb-center-label');
    var wbTitle = wbEl.querySelector('#mufy-wb-title');
    var role = activeField && activeField.role ? activeField.role : '字段';
    var itemName = activeField ? v058GetItemName(activeField.group) : '物品';

    if (centerLabel) centerLabel.textContent = '物品｜' + itemName + ' · ' + role;
    if (wbTitle) wbTitle.textContent = '工作台 · 物品｜' + itemName + ' · ' + role;
  }

  openWorkbench = function () {
    var result = v058OpenWorkbench.apply(this, arguments);
    v058RenderItemContext();
    return result;
  };

  selectWbField = function (index) {
    var result = v058SelectWbField.call(this, index);
    v058RenderItemContext();
    return result;
  };
`;

const anchor = '  function init() {';
const at = source.indexOf(anchor);
if (at < 0) throw new Error('init anchor not found');
source = source.slice(0, at) + patch + '\n\n' + source.slice(at);
fs.writeFileSync(file, source, 'utf8');
