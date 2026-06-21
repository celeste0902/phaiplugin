// ==UserScript==
// @name         Mufy 角色卡编辑助手
// @namespace    mufy-card-helper
// @version      0.5.9
// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含物品聚合工作台、三态草稿层与安全单字段注入
// @match        https://chat.mufy.ai/create*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /*
    V0.5.0 新增：单字段手动注入 Mufy（步骤 3）
    - 编辑器下方新增"写入当前字段到 Mufy"按钮。
    - 写入前检查 el.isConnected，失败给明确提示（已卸载 / 写入失败 / 校验不一致）。
    - 写入成功后 syncedContent 更新为 draftContent，entryContent 保持不变。
    - wbSnapshot 每条增加 syncStatus：clean / dirty / synced / failed / stale。
    - 左侧字段列表显示彩色圆点反映同步状态。
    - 切换字段时自动恢复该字段的写入状态提示。

    V0.4.1 修复：草稿导出、退出保护与 Token 统计性能
    - “人设”纳入关键字段 Token 合计。
    - 复制给 LLM 改为导出当前草稿，不再回退到进入工作台时的旧原文。
    - 退出工作台前检测未写入 Mufy 的草稿，避免误退出丢失内容。
    - Token 面板改为 300ms 防抖更新，降低超长字段编辑卡顿。

    V0.4.0 新增：草稿层 + Token 计数（步骤 2）
    - wbSnapshot 条目增加 draftContent，切换字段时自动保存草稿。
    - 恢复初始版本：draft → original（不触碰 Mufy DOM）。
    - 右侧信息区全面换成 Token 估算（本地近似：CJK≈1token，非CJK≈1/4token）。
    - 关键字段 Token 合计：角色设定、开场设计、输出设定、情节设定、样例对话、文风。
    - 上限 20090 Token，超出变红；固定提示资料库额外占 ~5000 Token。

    V0.3.0 工作台外壳沿用，V0.2.2 写入逻辑完全未改动。
  */

  /* ─── Mufy 核心字段（Token 合计只统计这五项） ─── */
  var TRACKED_FIELD_LABELS = ['人设', '开场设计', '输出设定', '情节设定', '样例对话&文风'];
  var TOKEN_LIMIT = 20090;

  /* ─── 全局状态 ─── */

  var fields = [];
  var lastSnapshot = null;
  var panelEl = null;
  var listEl = null;

  // 工作台状态
  var wbEl = null;
  var wbCurrentIndex = -1;
  // wbSnapshot 条目：{ label, entryContent, syncedContent, draftContent, syncStatus, fieldId }
  var wbSnapshot = [];
  // 右侧 Token 面板防抖计时器，避免超长字段每次按键都全量重算。
  var wbTokenTimer = null;
  var wbLastWriteUndo = null;
  var wbWritePending = false;
  var itemListExpanded = {};
  var wbItemExpanded = {};

  /* ─── 工具函数 ─── */

  function asText(value) {
    return String(value || '');
  }

  function cleanText(value) {
    return asText(value).replace(/\r/g, '').trim();
  }

  function compactText(value) {
    return cleanText(value)
      .replace(/token[:：]?\s*\d+/gi, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function firstMeaningfulLine(value) {
    var lines = asText(value).replace(/\r/g, '').split('\n');
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (line) return line;
    }
    return '';
  }

  function shortName(value, fallback) {
    var name = asText(value)
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/｜/g, '/')
      .trim();
    if (!name) return fallback;
    if (name.length > 28) return name.slice(0, 28) + '…';
    return name;
  }

  function getFieldType(el) {
    if (!el || !el.tagName) return 'contenteditable';
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.tagName === 'INPUT') return 'input';
    return 'contenteditable';
  }

  function getValue(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return asText(el.value);
    }
    return asText(el.innerText || el.textContent);
  }

  function isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0';
  }

  function isEditableElement(el) {
    return !!(
      el &&
      el.matches &&
      el.matches('textarea, input, [contenteditable="true"]')
    );
  }

  function isPureLabel(el) {
    return !!el && !el.querySelector('textarea, input, [contenteditable="true"]');
  }

  function cleanLabel(value) {
    var line = firstMeaningfulLine(value);
    if (!line) return '';
    return line.replace(/token[:：]?\s*\d+/gi, '').trim();
  }

  function guessLabel(el) {
    var current = el;
    for (var depth = 0; depth < 4 && current; depth += 1) {
      var sibling = current.previousElementSibling;
      if (sibling) {
        if (!isPureLabel(sibling)) return '';
        var text = cleanText(sibling.innerText || sibling.textContent || '');
        if (text && text.length < 160) {
          var label = cleanLabel(text);
          if (label) return label;
        }
      }
      current = current.parentElement;
    }
    return '';
  }

  function labelEquals(value, expected) {
    return compactText(value) === compactText(expected);
  }

  /* Token 估算：CJK 字符约 1 token，其余约每 4 字符 1 token */
  function estimateTokens(text) {
    if (!text) return 0;
    var s = asText(text);
    var cjkCount = (s.match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length;
    var nonCjk = s.length - cjkCount;
    return cjkCount + Math.ceil(nonCjk / 4);
  }

  function normalizeTrackedLabel(label) {
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

  function escapeHtml(value) {
    return asText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ─── React 写入 ─── */

  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setEditableValue(el, value) {
    el.focus();
    document.execCommand('selectAll', false, null);
    var inserted = document.execCommand('insertText', false, value);
    if (!inserted) {
      el.innerText = value;
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: value,
          inputType: 'insertText'
        }));
      } catch (error) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ─── Toast ─── */

  function toast(message) {
    var node = document.createElement('div');
    node.textContent = message;
    node.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#1f1f27',
      'color:#fff',
      'padding:10px 16px',
      'border-radius:8px',
      'font-size:13px',
      'z-index:2147483647',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'border:1px solid #8b5cf6',
      'max-width:min(90vw,680px)',
      'text-align:center'
    ].join(';');
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 2800);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    var ok = document.execCommand('copy');
    area.remove();
    return ok;
  }

  /* ─── 字段身份标注 ─── */

  function assignFieldIdentity(field, label, group, role, options) {
    var opts = options || {};
    field.label = label;
    field.group = group || '';
    field.role = role || '';
    if (opts.recognized) {
      field.isUnrecognized = false;
      field.needsReview = false;
      field.enabled = true;
    }
    if (opts.needsReview) {
      field.needsReview = true;
      field.enabled = false;
    }
    if (opts.inferred) {
      field.isInferred = true;
    }
  }

  function pairDefaultCognitionEntries(list) {
    var anchorIndexes = [];
    list.forEach(function (field, index) {
      if (labelEquals(field.rawLabel, '默认认知') && field.type === 'textarea') {
        anchorIndexes.push(index);
      }
    });
    anchorIndexes.forEach(function (anchorIndex) {
      var anchor = list[anchorIndex];
      if (anchor.role) return;
      assignFieldIdentity(anchor, '默认认知｜主内容', '默认认知', '主内容', { recognized: true });
      var entryNumber = 0;
      var cursor = anchorIndex + 1;
      while (cursor < list.length) {
        var candidate = list[cursor];
        var candidateIsDefault = labelEquals(candidate.rawLabel, '默认认知');
        var candidateIsUnknown = candidate.isUnrecognized;
        if (!candidateIsDefault && !candidateIsUnknown) break;
        if (candidate.type !== 'input') {
          if (candidateIsUnknown) break;
          cursor += 1;
          continue;
        }
        entryNumber += 1;
        var entryTitle = shortName(getValue(candidate.el), '未命名条目 ' + entryNumber);
        var group = '默认认知条目｜' + entryTitle;
        assignFieldIdentity(candidate, group + '｜标题', group, '标题', {
          recognized: true,
          inferred: candidateIsUnknown
        });
        var next = list[cursor + 1];
        var canPair = next &&
          next.type === 'textarea' &&
          (labelEquals(next.rawLabel, '默认认知') || next.isUnrecognized);
        if (canPair) {
          assignFieldIdentity(next, group + '｜内容', group, '内容', {
            recognized: true,
            inferred: next.isUnrecognized
          });
          cursor += 2;
        } else {
          candidate.needsReview = true;
          candidate.enabled = false;
          cursor += 1;
        }
      }
    });
  }

  function pairItemFields(list) {
    var activeTitle = null;
    var itemNumber = 0;
    list.forEach(function (field, index) {
      var isItemName = labelEquals(field.rawLabel, '物品名称') && field.type === 'input';
      var isItemDescription = labelEquals(field.rawLabel, '物品描述') && field.type === 'textarea';
      if (isItemName) {
        itemNumber += 1;
        var itemName = shortName(getValue(field.el), '未命名物品 ' + itemNumber);
        var group = '物品｜' + itemName;
        assignFieldIdentity(field, group + '｜名称', group, '名称', { recognized: true });
        activeTitle = { index: index, group: group };
        return;
      }
      if (isItemDescription) {
        var isNearby = activeTitle && index - activeTitle.index <= 2;
        if (isNearby) {
          assignFieldIdentity(field, activeTitle.group + '｜描述', activeTitle.group, '描述', { recognized: true });
        } else {
          assignFieldIdentity(field, '物品描述（未配对 ' + index + '）', '物品', '描述', {
            recognized: true,
            needsReview: true
          });
        }
        activeTitle = null;
        return;
      }
      if (activeTitle && index - activeTitle.index > 2) {
        activeTitle = null;
      }
    });
  }

  function isItemField(field) {
    return !!(field && field.group && field.group.indexOf('物品｜') === 0);
  }

  function itemNameFromGroup(group, fallback) {
    var name = asText(group).replace(/^物品｜/, '').replace(/（#[0-9]+）$/, '').trim();
    return name || fallback || '未命名物品';
  }

  function assignUniqueItemGroups(list) {
    var countByBase = {};
    var active = null;

    list.forEach(function (field) {
      if (field.role === '名称' && isItemField(field)) {
        var base = field.group;
        countByBase[base] = (countByBase[base] || 0) + 1;

        var uniqueGroup = base;
        if (countByBase[base] > 1) {
          uniqueGroup = base + '（#' + countByBase[base] + '）';
        }

        field.group = uniqueGroup;
        field.label = uniqueGroup + '｜名称';
        active = { oldGroup: base, uniqueGroup: uniqueGroup };
        return;
      }

      if (field.role === '描述' && active && field.group === active.oldGroup) {
        field.group = active.uniqueGroup;
        field.label = active.uniqueGroup + '｜描述';
        active = null;
        return;
      }

      if (!isItemField(field)) active = null;
    });
  }

  function buildItemEntities(records, getField, getIndex) {
    var entities = [];
    var active = null;

    records.forEach(function (record, position) {
      var field = getField(record);
      if (!isItemField(field)) {
        active = null;
        return;
      }

      var index = getIndex(record, position);
      var startsItem = field.role === '名称' || !active || active.itemKey !== field.group;

      if (startsItem) {
        active = {
          itemKey: field.group,
          itemName: itemNameFromGroup(field.group, field.label),
          fields: [],
          fieldIndexes: [],
          records: [],
          recordIndexes: []
        };
        entities.push(active);
      }

      active.fields.push(field);
      active.fieldIndexes.push(field.domIndex);
      active.records.push(record);
      active.recordIndexes.push(index);
    });

    return entities;
  }

  function buildScannedItemEntities() {
    return buildItemEntities(
      fields,
      function (field) { return field; },
      function (field, index) { return index; }
    );
  }

  function findFieldById(fieldId) {
    for (var i = 0; i < fields.length; i += 1) {
      if (fields[i].id === fieldId) return fields[i];
    }
    return null;
  }

  function buildWorkbenchItemEntities() {
    return buildItemEntities(
      wbSnapshot,
      function (snap) { return findFieldById(snap.fieldId); },
      function (snap, index) { return index; }
    );
  }

  function disambiguateLabels(list) {
    var counts = {};
    var seen = {};
    list.forEach(function (field) {
      counts[field.label] = (counts[field.label] || 0) + 1;
    });
    list.forEach(function (field) {
      if (counts[field.label] <= 1) return;
      seen[field.label] = (seen[field.label] || 0) + 1;
      field.label = field.label + '（#' + seen[field.label] + '）';
    });
  }

  /* ─── 字段扫描 ─── */

  function scanFields() {
    itemListExpanded = {};
    var selector =
      'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';
    var nodes = Array.from(document.querySelectorAll(selector)).filter(function (el) {
      return isVisible(el) &&
        !el.closest('#mufy-helper-panel') &&
        !el.closest('#mufy-helper-toggle') &&
        !el.closest('#mufy-workbench');
    });
    fields = nodes.map(function (el, index) {
      var rawLabel = guessLabel(el);
      var recognized = !!rawLabel;
      return {
        id: 'field-' + index,
        domIndex: index,
        el: el,
        type: getFieldType(el),
        rawLabel: rawLabel,
        label: recognized ? rawLabel : '字段' + index + '（未识别）',
        group: '',
        role: '',
        enabled: recognized,
        isUnrecognized: !recognized,
        needsReview: !recognized,
        isInferred: false,
        manualName: false
      };
    });
    pairDefaultCognitionEntries(fields);
    pairItemFields(fields);
    assignUniqueItemGroups(fields);
    disambiguateLabels(fields);
    return fields;
  }

  function getEnabledFields() {
    return fields.filter(function (f) { return f.enabled; });
  }

  function getUnsafeEnabledFields() {
    return fields.filter(function (f) {
      return f.enabled && (f.isUnrecognized || f.needsReview);
    });
  }

  function getDuplicateEnabledLabels() {
    var counts = {};
    getEnabledFields().forEach(function (f) {
      counts[f.label] = (counts[f.label] || 0) + 1;
    });
    return Object.keys(counts).filter(function (l) { return counts[l] > 1; });
  }

  function getFieldStatus(field) {
    if (field.isUnrecognized) return '未识别';
    if (field.needsReview) return '需确认';
    if (field.isInferred) return '已分组';
    return '已识别';
  }

  function getFieldMeta(field) {
    if (field.group && field.role) return field.group + ' · ' + field.role;
    if (field.rawLabel) return '原标签：' + field.rawLabel;
    return '未找到可用字段标题';
  }

  /* ─── 取色器（手动重绑） ─── */

  function startPicker(onPick) {
    document.body.style.cursor = 'crosshair';
    var highlighter = document.createElement('div');
    highlighter.style.cssText = [
      'position:fixed',
      'border:2px solid #8b5cf6',
      'background:rgba(139,92,246,.15)',
      'z-index:2147483646',
      'pointer-events:none',
      'border-radius:4px'
    ].join(';');
    document.body.appendChild(highlighter);
    function move(event) {
      var rect = event.target.getBoundingClientRect();
      highlighter.style.top = rect.top + 'px';
      highlighter.style.left = rect.left + 'px';
      highlighter.style.width = rect.width + 'px';
      highlighter.style.height = rect.height + 'px';
    }
    function click(event) {
      event.preventDefault();
      event.stopPropagation();
      if (!isEditableElement(event.target)) {
        toast('请直接点输入框本体，不要点容器、标签或空白处');
        return;
      }
      cleanup();
      onPick(event.target);
    }
    function keydown(event) {
      if (event.key === 'Escape') cleanup();
    }
    function cleanup() {
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keydown, true);
      highlighter.remove();
    }
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', keydown, true);
  }

  /* ─── Markdown 构建 / 解析（原有写入流程） ─── */

  function buildMarkdown() {
    var selected = getEnabledFields();
    var header = [
      '以下仅包含本次已选中的角色卡字段。',
      '请按需修改，并严格使用"## 字段名"作为分隔标题原样返回这些字段。',
      '未修改字段也请保留原文返回。不要新增未列出的字段，不要改写字段标题，不要添加解释、前言或结语。',
      ''
    ].join('\n');
    var body = selected.map(function (field) {
      return '## ' + field.label + '\n\n' + getValue(field.el) + '\n';
    }).join('\n');
    return header + '\n' + body;
  }

  function sectionBufferToContent(buffer) {
    var lines = buffer.slice();
    if (lines.length && lines[0] === '') lines.shift();
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  function parseMarkdownToMap(text, enabledFields) {
    var labelSet = new Set(enabledFields.map(function (f) { return f.label; }));
    var lines = asText(text).replace(/\r/g, '').split('\n');
    var map = {};
    var currentLabel = null;
    var buffer = [];
    function flush() {
      if (currentLabel !== null) map[currentLabel] = sectionBufferToContent(buffer);
      buffer = [];
    }
    lines.forEach(function (line) {
      var match = line.match(/^##\s+(.+?)\s*$/);
      var possibleLabel = match ? match[1].trim() : '';
      if (possibleLabel && labelSet.has(possibleLabel)) {
        flush();
        currentLabel = possibleLabel;
      } else if (currentLabel !== null) {
        buffer.push(line);
      }
    });
    flush();
    return map;
  }

  function buildApplyPlan(map, enabledFields) {
    var plan = [];
    var missed = [];
    enabledFields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(map, field.label)) {
        var oldValue = getValue(field.el);
        var newValue = map[field.label];
        if (oldValue !== newValue) {
          plan.push({ field: field, oldVal: oldValue, newVal: newValue });
        }
      } else {
        missed.push(field.label);
      }
    });
    var extra = Object.keys(map).filter(function (label) {
      return !enabledFields.some(function (f) { return f.label === label; });
    });
    return { plan: plan, missed: missed, extra: extra };
  }

  function executeApplyPlan(plan) {
    lastSnapshot = plan.map(function (item) {
      return { field: item.field, oldVal: item.oldVal };
    });
    plan.forEach(function (item) {
      if (item.field.type === 'contenteditable') {
        setEditableValue(item.field.el, item.newVal);
      } else {
        setNativeValue(item.field.el, item.newVal);
      }
    });
  }

  function undoLastApply() {
    if (!lastSnapshot || !lastSnapshot.length) {
      toast('没有可撤销的写入');
      return 0;
    }
    var stale = lastSnapshot.filter(function (item) {
      return !item.field.el || !item.field.el.isConnected;
    });
    if (stale.length) {
      toast('有 ' + stale.length + ' 个字段已被页面重新渲染，无法安全撤销，请手动检查内容');
      lastSnapshot = null;
      return 0;
    }
    lastSnapshot.forEach(function (item) {
      if (item.field.type === 'contenteditable') {
        setEditableValue(item.field.el, item.oldVal);
      } else {
        setNativeValue(item.field.el, item.oldVal);
      }
    });
    var count = lastSnapshot.length;
    lastSnapshot = null;
    return count;
  }

  /* ─── 全屏工作台 ─── */

  function buildWorkbench() {
    wbEl = document.createElement('div');
    wbEl.id = 'mufy-workbench';

    wbEl.innerHTML = [
      '<div id="mufy-wb-topbar">',
      '  <button id="mufy-wb-exit">← 退出工作台</button>',
      '  <button id="mufy-wb-copy-llm" class="secondary">复制给 LLM</button>',
      '  <button id="mufy-wb-restore" class="secondary" title="放弃当前字段尚未写入 Mufy 的编辑，恢复到最近一次成功同步的版本。">还原当前字段草稿</button>',
      '  <span id="mufy-wb-title" class="wb-title">工作台</span>',
      '</div>',
      '<div id="mufy-wb-body">',
      '  <div id="mufy-wb-left">',
      '    <div id="mufy-wb-field-list"></div>',
      '  </div>',
      '  <div id="mufy-wb-center">',
      '    <div id="mufy-wb-center-label"></div>',
      '    <div id="mufy-item-context"></div>',
      '    <textarea id="mufy-wb-editor" placeholder="从左侧选择一个字段…"></textarea>',
      '    <div id="mufy-wb-write-row">',
      '      <button id="mufy-wb-write-btn">写入当前字段到 Mufy</button>',
      '      <button id="mufy-wb-undo-write-btn" class="secondary" disabled>撤回编辑页写入</button>',
      '      <span id="mufy-wb-write-status"></span>',
      '    </div>',
      '  </div>',
      '  <div id="mufy-wb-right">',
      '    <div class="wb-section-title">当前字段</div>',
      '    <div class="wb-info-row">',
      '      <span class="wb-info-key">Mufy 当前</span>',
      '      <span id="mufy-wb-orig-token" class="wb-info-val">—</span>',
      '    </div>',
      '    <div class="wb-info-row">',
      '      <span class="wb-info-key">草稿</span>',
      '      <span id="mufy-wb-draft-token" class="wb-info-val">—</span>',
      '    </div>',
      '    <div class="wb-info-row">',
      '      <span class="wb-info-key">变化</span>',
      '      <span id="mufy-wb-token-delta" class="wb-info-val">—</span>',
      '    </div>',
      '    <div class="wb-divider"></div>',
      '    <div class="wb-section-title">Mufy 原生 Token（5项）</div>',
      '    <div id="mufy-wb-tracked-list"></div>',
      '    <div class="wb-divider"></div>',
      '    <div class="wb-info-row wb-total-row">',
      '      <span class="wb-info-key">合计</span>',
      '      <span id="mufy-wb-total-token" class="wb-info-val">—</span>',
      '    </div>',
      '    <div id="mufy-wb-bar-wrap">',
      '      <div id="mufy-wb-bar"></div>',
      '    </div>',
      '    <div id="mufy-wb-limit-label">/ ' + TOKEN_LIMIT + ' Token</div>',
      '    <div class="wb-divider"></div>',
      '    <div class="wb-library-note">',
      '      ⚠️ 若此卡包含资料库，请手动额外预留约 5000 Token；本计数不自动加入。',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(wbEl);

    /* 退出 */
    wbEl.querySelector('#mufy-wb-exit').addEventListener('click', function () {
      closeWorkbench();
    });

    /* 复制给 LLM：导出当前草稿（draftContent），保留本次工作台的最新编辑。 */
    wbEl.querySelector('#mufy-wb-copy-llm').addEventListener('click', function () {
      if (!wbSnapshot.length) {
        toast('工作台里没有字段');
        return;
      }
      var header = [
        '以下仅包含本次已选中的角色卡字段。',
        '请按需修改，并严格使用"## 字段名"作为分隔标题原样返回这些字段。',
        '未修改字段也请保留原文返回。不要新增未列出的字段，不要改写字段标题，不要添加解释、前言或结语。',
        ''
      ].join('\n');
      var body = wbSnapshot.map(function (snap) {
        return '## ' + snap.label + '\n\n' + snap.draftContent + '\n';
      }).join('\n');
      copyText(header + '\n' + body).then(function (ok) {
        toast(ok ? '已复制工作台字段（当前草稿），可粘贴给 LLM' : '复制失败，请手动选择文本');
      });
    });

    /* 还原草稿至当前同步版本：draft → syncedContent，不修改 Mufy 页面 */
    wbEl.querySelector('#mufy-wb-restore').addEventListener('click', function () {
      if (wbCurrentIndex < 0 || wbCurrentIndex >= wbSnapshot.length) return;
      var snap = wbSnapshot[wbCurrentIndex];
      snap.draftContent = snap.syncedContent;
      snap.syncStatus = 'clean';
      clearWbUndoForField(snap.fieldId);
      wbEl.querySelector('#mufy-wb-editor').value = snap.syncedContent;
      setWbWriteStatus('', '');
      renderWbFieldList();
      updateWbRightPanel();
      updateWbWriteControls();
      toast('已将"' + snap.label + '"还原至当前同步版本');
    });

    /* 写入当前字段到 Mufy */
    wbEl.querySelector('#mufy-wb-write-btn').addEventListener('click', function () {
      writeCurrentFieldToMufy();
    });

    wbEl.querySelector('#mufy-wb-undo-write-btn').addEventListener('click', function () {
      undoCurrentWbWrite();
    });

    /* 编辑器实时保存草稿 + 更新 syncStatus + 更新右侧 */
    wbEl.querySelector('#mufy-wb-editor').addEventListener('input', function () {
      if (wbCurrentIndex >= 0 && wbCurrentIndex < wbSnapshot.length) {
        var snap = wbSnapshot[wbCurrentIndex];
        snap.draftContent = wbEl.querySelector('#mufy-wb-editor').value;
        clearWbUndoForField(snap.fieldId);

        var isDirty = snap.draftContent !== snap.syncedContent;
        var prevStatus = snap.syncStatus;

        if (isDirty && prevStatus !== 'dirty') {
          snap.syncStatus = 'dirty';
          renderWbFieldList();
        } else if (!isDirty && prevStatus === 'dirty') {
          // Draft reverted back to match synced version
          snap.syncStatus = 'clean';
          setWbWriteStatus('', '');
          renderWbFieldList();
        }
      }
      scheduleWbRightPanelUpdate();
      updateWbWriteControls();
    });
  }

  function openWorkbench() {
    var enabled = getEnabledFields();
    if (!enabled.length) {
      toast('当前没有勾选字段，请先在面板里勾选要编辑的字段');
      return;
    }
    // 快照：entryContent 为进入时原文（只读）；syncedContent 为当前同步基线；draftContent 为工作台草稿
    wbSnapshot = enabled.map(function (field) {
      var content = getValue(field.el);
      return {
        fieldId: field.id,
        label: field.label,
        entryContent: content,    // 进入工作台时的原文，只读，不随写入更新
        syncedContent: content,   // 最近一次成功写入并校验的内容
        draftContent: content,    // 工作台当前草稿
        // syncStatus: clean | dirty | synced | failed | stale
        syncStatus: 'clean'
      };
    });
    wbCurrentIndex = -1;
    wbLastWriteUndo = null;
    wbWritePending = false;
    renderWbFieldList();
    wbEl.classList.add('open');
    selectWbField(0);
  }

  function hasDirtyWbDrafts() {
    return wbSnapshot.some(function (snap) {
      return snap.draftContent !== snap.syncedContent;
    });
  }

  function clearWbTokenTimer() {
    if (!wbTokenTimer) return;
    window.clearTimeout(wbTokenTimer);
    wbTokenTimer = null;
  }

  function scheduleWbRightPanelUpdate() {
    clearWbTokenTimer();
    wbTokenTimer = window.setTimeout(function () {
      wbTokenTimer = null;
      if (wbEl && wbEl.classList.contains('open') && wbCurrentIndex >= 0) {
        updateWbRightPanel();
      }
    }, 300);
  }

  function getCurrentWbSnap() {
    if (wbCurrentIndex < 0 || wbCurrentIndex >= wbSnapshot.length) return null;
    return wbSnapshot[wbCurrentIndex];
  }

  function clearWbUndoForField(fieldId) {
    if (wbLastWriteUndo && wbLastWriteUndo.fieldId === fieldId) {
      wbLastWriteUndo = null;
    }
  }

  function updateWbWriteControls() {
    if (!wbEl) return;

    var snap = getCurrentWbSnap();
    var writeButton = wbEl.querySelector('#mufy-wb-write-btn');
    var undoButton = wbEl.querySelector('#mufy-wb-undo-write-btn');

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
        snap.draftContent === snap.syncedContent
      );
      undoButton.disabled = !canUndo;
    }
  }

  function writeFieldValue(field, value) {
    if (field.type === 'contenteditable') {
      setEditableValue(field.el, value);
    } else {
      setNativeValue(field.el, value);
    }

    try {
      field.el.blur();
      field.el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (error) {}
  }

  /* 把当前字段的草稿写入 Mufy 对应 DOM 节点（写前检查 isConnected，写后延迟校验） */
  function writeCurrentFieldToMufy() {
    if (wbWritePending) return;

    var snap = getCurrentWbSnap();
    if (!snap) return;

    var editor = wbEl.querySelector('#mufy-wb-editor');
    snap.draftContent = editor.value;

    var field = findFieldById(snap.fieldId);
    if (!field || !field.el || !field.el.isConnected) {
      snap.syncStatus = 'stale';
      setWbWriteStatus('err', '字段已卸载，请重新扫描');
      renderWbFieldList();
      updateWbWriteControls();
      return;
    }

    var pageValueBeforeWrite = getValue(field.el);
    var syncedBeforeWrite = snap.syncedContent;
    var expectedValue = snap.draftContent;

    wbWritePending = true;
    setWbWriteStatus('warn', '正在填入 Mufy 编辑器…');
    updateWbWriteControls();

    try {
      writeFieldValue(field, expectedValue);
    } catch (err) {
      wbWritePending = false;
      snap.syncStatus = 'failed';
      setWbWriteStatus('err', '写入失败：' + (err && err.message ? err.message : '未知错误'));
      renderWbFieldList();
      updateWbWriteControls();
      return;
    }

    window.setTimeout(function () {
      if (wbSnapshot.indexOf(snap) === -1) return;

      wbWritePending = false;

      if (!field.el || !field.el.isConnected) {
        snap.syncStatus = 'stale';
        setWbWriteStatus('err', '字段在校验时已卸载，请重新扫描');
      } else if (getValue(field.el) === expectedValue) {
        wbLastWriteUndo = {
          fieldId: snap.fieldId,
          pageValueBeforeWrite: pageValueBeforeWrite,
          syncedBeforeWrite: syncedBeforeWrite
        };
        snap.syncedContent = expectedValue;
        snap.draftContent = expectedValue;
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
    if (wbWritePending) return;

    var snap = getCurrentWbSnap();
    var undo = wbLastWriteUndo;

    if (!snap || !undo || undo.fieldId !== snap.fieldId || snap.syncStatus !== 'synced' || snap.draftContent !== snap.syncedContent) {
      setWbWriteStatus('warn', '当前字段没有可安全撤销的写入');
      updateWbWriteControls();
      return;
    }

    var field = findFieldById(snap.fieldId);
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
      writeFieldValue(field, undo.pageValueBeforeWrite);
    } catch (err) {
      wbWritePending = false;
      setWbWriteStatus('err', '撤销失败：' + (err && err.message ? err.message : '未知错误'));
      updateWbWriteControls();
      return;
    }

    window.setTimeout(function () {
      if (wbSnapshot.indexOf(snap) === -1) return;

      wbWritePending = false;

      if (!field.el || !field.el.isConnected) {
        snap.syncStatus = 'stale';
        setWbWriteStatus('err', '字段在撤销校验时已卸载，请重新扫描');
      } else if (getValue(field.el) === undo.pageValueBeforeWrite) {
        snap.syncedContent = undo.syncedBeforeWrite;
        snap.syncStatus = snap.draftContent === snap.syncedContent ? 'clean' : 'dirty';
        wbLastWriteUndo = null;
        setWbWriteStatus('warn', '已撤销填入；工作台草稿仍保留，待再次写入');
      } else {
        snap.syncStatus = 'failed';
        setWbWriteStatus('err', '撤销失败：延迟校验不一致');
      }

      renderWbFieldList();
      updateWbWriteControls();
      scheduleWbRightPanelUpdate();
    }, 160);
  }

  function setWbWriteStatus(type, message) {
    var el = wbEl && wbEl.querySelector('#mufy-wb-write-status');
    if (!el) return;
    el.textContent = message;
    el.className = type;  // 'ok' | 'err' | 'warn' | ''
  }

  function closeWorkbench() {
    if (hasDirtyWbDrafts()) {
      var confirmed = window.confirm('当前有未写入 Mufy 的草稿。退出后将丢失，确定退出吗？');
      if (!confirmed) return;
    }

    clearWbTokenTimer();
    wbLastWriteUndo = null;
    wbWritePending = false;
    wbEl.classList.remove('open');
    wbCurrentIndex = -1;
    wbSnapshot = [];
  }

  var WB_DOT_COLOR = {
    clean:  '#4a4a62',
    dirty:  '#fbbf24',
    synced: '#4ade80',
    failed: '#f87171',
    stale:  '#f87171'
  };

  function itemStatus(records) {
    var status = 'clean';

    records.forEach(function (snap) {
      if (snap.syncStatus === 'failed' || snap.syncStatus === 'stale') status = 'failed';
      else if (status !== 'failed' && snap.syncStatus === 'dirty') status = 'dirty';
      else if (status === 'clean' && snap.syncStatus === 'synced') status = 'synced';
    });

    return status;
  }

  function itemStatusText(status) {
    if (status === 'failed') return '需检查';
    if (status === 'dirty') return '有草稿';
    if (status === 'synced') return '已同步';
    return '未修改';
  }

  function renderWorkbenchNormalField(snap, index) {
    var item = document.createElement('div');
    item.className = 'mufy-wb-field-item';
    item.dataset.index = index;

    var dot = document.createElement('span');
    dot.className = 'mufy-wb-dot';
    dot.style.background = WB_DOT_COLOR[snap.syncStatus] || '#4a4a62';
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

    return item;
  }

  function renderItemWorkbenchChild(snap, index) {
    var item = document.createElement('div');
    item.className = 'mufy-item-wb-child' + (index === wbCurrentIndex ? ' active' : '');
    item.dataset.index = index;

    var dot = document.createElement('span');
    dot.className = 'mufy-wb-dot';
    dot.style.background = WB_DOT_COLOR[snap.syncStatus] || '#4a4a62';

    var field = findFieldById(snap.fieldId);
    var label = document.createElement('span');
    label.textContent = field && field.role ? field.role : snap.label.replace(/^物品｜[^｜]+｜/, '');
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

  function renderItemWorkbenchCard(entity) {
    var card = document.createElement('div');
    card.className = 'mufy-item-wb-card';

    var head = document.createElement('div');
    head.className = 'mufy-item-wb-head';

    var status = itemStatus(entity.records);
    var dot = document.createElement('span');
    dot.className = 'mufy-wb-dot';
    dot.style.background = WB_DOT_COLOR[status] || '#4a4a62';

    var name = document.createElement('span');
    name.className = 'mufy-item-wb-name';
    name.textContent = '物品｜' + entity.itemName;
    name.title = entity.itemKey;
    name.addEventListener('click', function () {
      wbItemExpanded[entity.itemKey] = true;
      selectWbField(entity.recordIndexes[0]);
    });

    var summary = document.createElement('span');
    summary.className = 'mufy-item-wb-summary';
    summary.textContent = entity.records.length + ' 项 · ' + itemStatusText(status);

    var expanded = !!wbItemExpanded[entity.itemKey] || entity.recordIndexes.indexOf(wbCurrentIndex) >= 0;
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mufy-item-wb-toggle';
    toggle.textContent = expanded ? '收起' : '展开';
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      wbItemExpanded[entity.itemKey] = !expanded;
      renderWbFieldList();
    });

    head.appendChild(dot);
    head.appendChild(name);
    head.appendChild(summary);
    head.appendChild(toggle);
    card.appendChild(head);

    if (expanded) {
      var children = document.createElement('div');
      children.className = 'mufy-item-wb-children';
      entity.records.forEach(function (snap, pos) {
        children.appendChild(renderItemWorkbenchChild(snap, entity.recordIndexes[pos]));
      });
      card.appendChild(children);
    }

    return card;
  }

  function renderWbFieldList() {
    var fieldListEl = wbEl.querySelector('#mufy-wb-field-list');
    fieldListEl.innerHTML = '';

    var entities = buildWorkbenchItemEntities();
    var entityByStart = {};
    var skip = {};

    entities.forEach(function (entity) {
      entityByStart[entity.recordIndexes[0]] = entity;
      entity.recordIndexes.slice(1).forEach(function (index) { skip[index] = true; });
    });

    var itemSectionAdded = false;

    wbSnapshot.forEach(function (snap, index) {
      var field = findFieldById(snap.fieldId);

      if (!isItemField(field)) {
        fieldListEl.appendChild(renderWorkbenchNormalField(snap, index));
        return;
      }

      if (skip[index]) return;

      var entity = entityByStart[index];
      if (!entity) return;

      if (!itemSectionAdded) {
        var section = document.createElement('div');
        section.className = 'mufy-item-wb-section';
        section.textContent = '物品栏 · ' + entities.length + ' 件物品';
        fieldListEl.appendChild(section);
        itemSectionAdded = true;
      }

      fieldListEl.appendChild(renderItemWorkbenchCard(entity));
    });
  }

  function renderItemContextTabs() {
    if (!wbEl) return;

    var context = wbEl.querySelector('#mufy-item-context');
    if (!context) return;

    var snap = getCurrentWbSnap();
    var field = snap ? findFieldById(snap.fieldId) : null;

    if (!snap || !isItemField(field)) {
      context.classList.remove('show');
      context.innerHTML = '';
      return;
    }

    var entries = wbSnapshot.map(function (item, index) {
      return { snap: item, index: index, field: findFieldById(item.fieldId) };
    }).filter(function (entry) {
      return entry.field && entry.field.group === field.group;
    });

    var title = document.createElement('div');
    title.className = 'mufy-item-context-title';
    title.textContent = '物品｜' + itemNameFromGroup(field.group, field.label);
    title.title = field.group;

    var tabs = document.createElement('div');
    tabs.className = 'mufy-item-context-tabs';

    entries.forEach(function (entry) {
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mufy-item-context-tab' + (entry.index === wbCurrentIndex ? ' active' : '');
      tab.textContent = entry.field.role || entry.snap.label.replace(/^物品｜[^｜]+｜/, '字段');
      tab.title = entry.snap.label;
      tab.addEventListener('click', function () {
        selectWbField(entry.index);
      });
      tabs.appendChild(tab);
    });

    var note = document.createElement('div');
    note.className = 'mufy-item-context-note';
    note.textContent = '当前仍按单字段安全写入 Mufy；名称、描述与后续交互字段不会被拼成一段文本。';

    context.innerHTML = '';
    context.appendChild(title);
    context.appendChild(tabs);
    context.appendChild(note);
    context.classList.add('show');
  }

  function selectWbField(index) {
    if (index < 0 || index >= wbSnapshot.length) return;

    clearWbTokenTimer();
    var editor = wbEl.querySelector('#mufy-wb-editor');

    // 切换前先把编辑器内容存入当前字段的草稿
    if (wbCurrentIndex >= 0 && wbCurrentIndex < wbSnapshot.length) {
      wbSnapshot[wbCurrentIndex].draftContent = editor.value;
    }

    wbCurrentIndex = index;
    var snap = wbSnapshot[index];
    var selectedField = findFieldById(snap.fieldId);
    if (isItemField(selectedField)) {
      wbItemExpanded[selectedField.group] = true;
    }

    editor.value = snap.draftContent;
    if (isItemField(selectedField)) {
      var role = selectedField.role || '字段';
      var itemName = itemNameFromGroup(selectedField.group, snap.label);
      wbEl.querySelector('#mufy-wb-center-label').textContent = '当前字段：' + role;
      wbEl.querySelector('#mufy-wb-title').textContent = '工作台 · 物品｜' + itemName + ' · ' + role;
    } else {
      wbEl.querySelector('#mufy-wb-center-label').textContent = snap.label;
      wbEl.querySelector('#mufy-wb-title').textContent = '工作台 · ' + snap.label;
    }

    renderWbFieldList();

    // 恢复该字段的写入状态提示
    if (snap.syncStatus === 'synced') {
      setWbWriteStatus('ok', '已填入 Mufy 编辑器 ✓ 请手动点击“更新角色”保存');
    } else if (snap.syncStatus === 'failed') {
      setWbWriteStatus('err', '写入失败');
    } else if (snap.syncStatus === 'stale') {
      setWbWriteStatus('err', '字段已卸载，请重新扫描');
    } else {
      setWbWriteStatus('', '');
    }

    updateWbRightPanel();
    renderItemContextTabs();
    updateWbWriteControls();
    editor.focus();
  }

  function updateWbRightPanel() {
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

            var match = asText(node.textContent).trim().match(/^token\s*:\s*([0-9][0-9,]*)$/i);
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
    var draftChanged = snap.draftContent !== snap.syncedContent;

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

  /* ─── 样式注入 ─── */

  function injectStyleOnce() {
    if (document.getElementById('mufy-helper-style')) return;
    var style = document.createElement('style');
    style.id = 'mufy-helper-style';
    style.textContent = [
      /* ── 浮动面板 ── */
      '#mufy-helper-toggle{position:fixed;bottom:24px;right:24px;width:48px;height:48px;border-radius:50%;background:#8b5cf6;color:#fff;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483000;box-shadow:0 4px 14px rgba(0,0,0,.4);user-select:none}',
      '#mufy-helper-panel{position:fixed;top:80px;right:24px;width:430px;max-height:78vh;background:#1b1b22;border:1px solid #3a3a46;border-radius:12px;z-index:2147483000;display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6e6ef;font-size:13px;box-shadow:0 8px 28px rgba(0,0,0,.5);overflow:hidden}',
      '#mufy-helper-panel.open{display:flex}',
      '#mufy-helper-header{padding:10px 14px;background:#26263a;cursor:move;font-weight:600;display:flex;justify-content:space-between;align-items:center}',
      '#mufy-helper-header span.close{cursor:pointer;opacity:.7}',
      '#mufy-helper-toolbar{display:flex;gap:6px;padding:8px 10px;flex-wrap:wrap}',
      '#mufy-helper-toolbar button{flex:1;min-width:88px;background:#8b5cf6;border:none;color:#fff;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px}',
      '#mufy-helper-toolbar button.secondary{background:#34344a}',
      '#mufy-helper-list{overflow-y:auto;padding:4px 10px;flex:1}',
      '.mufy-field-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 4px;border-bottom:1px solid #2c2c3a}',
      '.mufy-field-row.is-unconfirmed{background:rgba(245,158,11,.07)}',
      '.mufy-field-row input[type=text]{flex:1;min-width:150px;background:#2a2a38;border:1px solid #3f3f52;color:#fff;padding:4px 6px;border-radius:4px;font-size:12px}',
      '.mufy-field-row .len{font-size:11px;color:#9a9aae;min-width:42px;text-align:right}',
      '.mufy-field-row button{background:#34344a;border:none;color:#cfcfe6;border-radius:4px;padding:3px 6px;font-size:11px;cursor:pointer}',
      '.mufy-field-meta{width:100%;padding-left:24px;font-size:11px;color:#8d8da4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mufy-field-badge{font-size:10px;padding:2px 5px;border-radius:999px;background:#244638;color:#a7f3d0;white-space:nowrap}',
      '.mufy-field-badge.inferred{background:#24364a;color:#bfdbfe}',
      '.mufy-field-badge.unconfirmed{background:#4b351d;color:#fcd34d}',
      '#mufy-helper-paste{margin:8px 10px;display:none;flex-direction:column;gap:6px}',
      '#mufy-helper-paste.open{display:flex}',
      '#mufy-helper-paste textarea{width:100%;height:120px;background:#15151c;color:#e6e6ef;border:1px solid #3a3a46;border-radius:6px;padding:6px;font-size:12px;box-sizing:border-box;resize:vertical}',
      '#mufy-helper-preview-box{display:none;margin-top:4px;padding:8px;background:#15151c;border:1px solid #3a3a46;border-radius:6px;font-size:12px;line-height:1.7;max-height:160px;overflow-y:auto;color:#cfcfe6}',
      '#mufy-helper-preview-box.show{display:block}',
      '#mufy-helper-confirm-row{display:none;gap:6px}',
      '#mufy-helper-confirm-row.show{display:flex}',
      '#mufy-helper-confirm-row button{flex:1}',
      '#mufy-helper-confirm-row button.secondary{background:#34344a}',
      '#mufy-helper-undo{display:none;width:100%;background:#5b3434;border:none;color:#fff;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px}',
      '#mufy-helper-undo.show{display:block}',
      '.mufy-item-section{margin:8px 0 4px;padding:7px 8px;border-radius:6px;background:#242238;color:#cfc9ff;font-size:11px;font-weight:600}',
      '.mufy-item-section small{margin-left:6px;color:#8f8aac;font-weight:400}',
      '.mufy-item-card{margin:6px 0;border:1px solid #3b355a;border-radius:8px;background:#1f1f2b;overflow:hidden}',
      '.mufy-item-card-head{display:flex;align-items:center;gap:7px;padding:8px;background:#2a273d}',
      '.mufy-item-card-name{flex:1;min-width:0;color:#f0ecff;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
      '.mufy-item-card-summary{font-size:10px;color:#aaa4ce;white-space:nowrap}',
      '.mufy-item-card-toggle{background:#403a60!important;color:#e5dfff!important;border:none;border-radius:5px;padding:3px 7px!important;font-size:10px!important;cursor:pointer}',
      '.mufy-item-card-note{padding:0 9px 8px;color:#8f8ba4;font-size:10px;line-height:1.5}',
      '.mufy-item-card-children{border-top:1px solid #37324f;padding:0 5px 4px}',
      '.mufy-item-child-row{padding-left:8px!important;border-bottom-color:#302d42!important}',
      '.mufy-item-child-label{flex:1;min-width:110px;color:#cbc6e7;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mufy-item-child-title{flex:1;min-width:120px!important;background:#252238!important;color:#cbc6e7!important;border-color:#3a3554!important}',
      '@media (max-width:560px){#mufy-helper-panel{left:10px;right:10px;top:56px;width:auto;max-height:82vh}#mufy-helper-toggle{right:16px;bottom:16px}}',

      /* ── 全屏工作台 ── */
      '#mufy-workbench{position:fixed;inset:0;background:#13131a;z-index:2147483100;display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6e6ef;font-size:13px}',
      '#mufy-workbench.open{display:flex}',

      '#mufy-wb-topbar{height:50px;min-height:50px;background:#1a1a28;border-bottom:1px solid #2a2a3e;display:flex;align-items:center;gap:8px;padding:0 16px;flex-shrink:0}',
      '#mufy-wb-topbar button{background:#8b5cf6;border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',
      '#mufy-wb-topbar button.secondary{background:#2e2e44}',
      '#mufy-wb-topbar button:hover{filter:brightness(1.15)}',
      '.wb-title{margin-left:auto;font-size:12px;color:#5a5a7a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}',

      '#mufy-wb-body{flex:1;display:flex;overflow:hidden}',

      '#mufy-wb-left{width:210px;min-width:210px;border-right:1px solid #222236;overflow-y:auto;background:#161622;flex-shrink:0}',
      '.mufy-wb-field-item{padding:9px 12px;cursor:pointer;border-bottom:1px solid #1c1c2e;font-size:13px;color:#b0b0cc;transition:background .12s;display:flex;align-items:center;gap:8px;overflow:hidden}',
      '.mufy-wb-field-item:hover{background:#1e1e32}',
      '.mufy-wb-field-item.active{background:#28194a;color:#c4b5fd;border-left:3px solid #8b5cf6;padding-left:9px}',
      '.mufy-wb-dot{width:7px;height:7px;min-width:7px;border-radius:50%;display:inline-block}',

      '#mufy-wb-center{flex:1;display:flex;flex-direction:column;padding:16px;gap:8px;overflow:hidden}',
      '#mufy-wb-center-label{font-size:12px;color:#6b6b8a;padding-bottom:6px;border-bottom:1px solid #222236;flex-shrink:0}',
      '#mufy-wb-editor{flex:1;width:100%;background:#1b1b28;color:#e6e6ef;border:1px solid #333350;border-radius:8px;padding:14px;font-size:14px;line-height:1.85;resize:none;box-sizing:border-box;font-family:inherit;outline:none}',
      '#mufy-wb-editor:focus{border-color:#8b5cf6}',
      '#mufy-wb-write-row{display:flex;align-items:center;gap:10px;flex-shrink:0}',
      '#mufy-wb-write-btn{background:#059669;border:none;color:#fff;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',
      '#mufy-wb-write-btn:hover{filter:brightness(1.12)}',
      '#mufy-wb-write-btn:disabled,#mufy-wb-undo-write-btn:disabled{cursor:not-allowed;opacity:.45;filter:none}',
      '#mufy-wb-undo-write-btn{background:#34344a;border:none;color:#e6e6ef;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',
      '#mufy-wb-write-status{font-size:12px;color:#9a9aae}',
      '#mufy-wb-write-status.ok{color:#4ade80}',
      '#mufy-wb-write-status.err{color:#f87171}',
      '#mufy-wb-write-status.warn{color:#fbbf24}',

      '#mufy-wb-right{width:210px;min-width:210px;border-left:1px solid #222236;padding:14px 12px;overflow-y:auto;background:#161622;flex-shrink:0;display:flex;flex-direction:column;gap:8px;font-size:12px}',
      '.wb-section-title{font-size:10px;color:#5a5a7a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;margin-top:4px}',
      '.wb-info-row{display:flex;justify-content:space-between;align-items:center;gap:4px}',
      '.wb-info-key{color:#6b6b8a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}',
      '.wb-info-val{color:#c4b5fd;font-weight:500;text-align:right;white-space:nowrap}',
      '.wb-total-row .wb-info-val{font-size:13px}',
      '.wb-tracked-row .wb-info-key{font-size:11px;color:#5a5a7a}',
      '.wb-tracked-label{display:block;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wb-divider{height:1px;background:#222236;margin:4px 0}',
      '#mufy-wb-bar-wrap{height:5px;background:#222236;border-radius:999px;overflow:hidden;margin-top:2px}',
      '#mufy-wb-bar{height:100%;width:0%;background:#8b5cf6;border-radius:999px;transition:width .2s,background .2s}',
      '#mufy-wb-limit-label{font-size:10px;color:#4a4a62;text-align:right;margin-top:2px}',
      '.wb-library-note{font-size:11px;color:#7c6a2e;background:#2a2010;border:1px solid #4a3a10;border-radius:6px;padding:7px 9px;line-height:1.6;margin-top:4px}',
      '.mufy-item-wb-section{padding:8px 12px;background:#1c1b2b;color:#9e96d5;font-size:11px;font-weight:600;border-bottom:1px solid #29263d}',
      '.mufy-item-wb-card{border-bottom:1px solid #242238;background:#181825}',
      '.mufy-item-wb-head{display:flex;align-items:center;gap:7px;padding:9px 10px;background:#211f31}',
      '.mufy-item-wb-name{flex:1;min-width:0;color:#d9d3ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
      '.mufy-item-wb-summary{font-size:10px;color:#8f89ac;white-space:nowrap}',
      '.mufy-item-wb-toggle{background:#34304e;border:none;color:#ded8ff;border-radius:5px;padding:3px 7px;font-size:10px;cursor:pointer}',
      '.mufy-item-wb-children{background:#151521}',
      '.mufy-item-wb-child{padding:8px 12px 8px 26px;cursor:pointer;border-bottom:1px solid #1d1c2b;font-size:12px;color:#aaa5c9;display:flex;align-items:center;gap:8px}',
      '.mufy-item-wb-child:hover{background:#1e1d31}',
      '.mufy-item-wb-child.active{background:#28194a;color:#d5cbff;border-left:3px solid #8b5cf6;padding-left:23px}',
      '#mufy-item-context{display:none;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 11px;border:1px solid #393254;border-radius:8px;background:#1a1928;flex-shrink:0}',
      '#mufy-item-context.show{display:flex}',
      '.mufy-item-context-title{font-size:12px;color:#e5dfff;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mufy-item-context-tabs{display:flex;gap:6px;flex-wrap:wrap}',
      '.mufy-item-context-tab{background:#302d45!important;color:#bdb6df!important;border:none;border-radius:5px;padding:4px 9px!important;font-size:12px!important;cursor:pointer}',
      '.mufy-item-context-tab.active{background:#6d4bc2!important;color:#fff!important}',
      '.mufy-item-context-note{width:100%;font-size:10px;color:#8f89ab;line-height:1.45}'
    ].join('');
    document.head.appendChild(style);
  }

  /* ─── 字段列表渲染（浮动面板） ─── */

  function buildFieldBadge(field) {
    var badge = document.createElement('span');
    var status = getFieldStatus(field);

    badge.textContent = status;
    badge.className = 'mufy-field-badge';
    if (status === '已分组') badge.className += ' inferred';
    if (status === '未识别' || status === '需确认') badge.className += ' unconfirmed';

    return badge;
  }

  function buildRebindButton(field) {
    var rebindButton = document.createElement('button');
    rebindButton.textContent = '本次重绑';
    rebindButton.title = '仅在本次页面会话内生效，刷新或重新扫描后会失效';
    rebindButton.addEventListener('click', function () {
      toast('请直接点击页面上的输入框本体（Esc 取消）');
      panelEl.classList.remove('open');
      startPicker(function (target) {
        field.el = target;
        field.type = getFieldType(target);
        field.isUnrecognized = false;
        field.needsReview = false;
        field.isInferred = false;
        field.enabled = true;
        panelEl.classList.add('open');
        renderList();
        toast('"' + field.label + '"本次重绑成功');
      });
    });

    return rebindButton;
  }

  function renderNormalFieldRow(field, compact) {
    var row = document.createElement('div');
    row.className = 'mufy-field-row' +
      (compact ? ' mufy-item-child-row' : '') +
      (field.isUnrecognized || field.needsReview ? ' is-unconfirmed' : '');

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = field.enabled;
    checkbox.addEventListener('change', function () {
      field.enabled = checkbox.checked;
      if (compact) renderList();
    });

    row.appendChild(checkbox);

    if (compact) {
      var childInput = document.createElement('input');
      childInput.type = 'text';
      childInput.className = 'mufy-item-child-title';
      childInput.value = field.label;
      childInput.title = '可修改本次会话中的导出标题；不改变物品聚合或 Mufy 页面原始值';
      childInput.addEventListener('change', function () {
        var nextLabel = childInput.value.trim();
        if (!nextLabel) {
          childInput.value = field.label;
          return;
        }
        field.label = nextLabel;
        field.manualName = true;
        field.isUnrecognized = false;
        field.needsReview = false;
        field.isInferred = false;
        renderList();
      });
      row.appendChild(childInput);
    } else {
      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = field.label;
      nameInput.title = '可修改本次会话中的导出标题；重新扫描后会恢复自动识别';
      nameInput.addEventListener('change', function () {
        var nextLabel = nameInput.value.trim();
        if (!nextLabel) {
          nameInput.value = field.label;
          return;
        }
        field.label = nextLabel;
        field.manualName = true;
        field.isUnrecognized = false;
        field.needsReview = false;
        field.isInferred = false;
        renderList();
      });
      row.appendChild(nameInput);
    }

    var length = document.createElement('span');
    length.className = 'len';
    length.textContent = estimateTokens(getValue(field.el)) + ' tk';

    row.appendChild(buildFieldBadge(field));
    row.appendChild(length);
    row.appendChild(buildRebindButton(field));

    if (!compact) {
      var meta = document.createElement('div');
      meta.className = 'mufy-field-meta';
      meta.textContent = getFieldMeta(field);
      meta.title = meta.textContent;
      row.appendChild(meta);
    }

    return row;
  }

  function getItemSelection(entity) {
    var enabled = entity.fields.filter(function (field) {
      return field.enabled;
    }).length;

    return {
      all: entity.fields.length > 0 && enabled === entity.fields.length,
      mixed: enabled > 0 && enabled < entity.fields.length
    };
  }

  function renderItemCard(entity) {
    var card = document.createElement('div');
    card.className = 'mufy-item-card';

    var head = document.createElement('div');
    head.className = 'mufy-item-card-head';

    var selection = getItemSelection(entity);
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selection.all;
    checkbox.indeterminate = selection.mixed;
    checkbox.title = '勾选或取消勾选这件物品当前已扫描到的全部基础字段';
    checkbox.addEventListener('change', function () {
      entity.fields.forEach(function (field) {
        field.enabled = checkbox.checked;
      });
      renderList();
    });

    var name = document.createElement('span');
    name.className = 'mufy-item-card-name';
    name.textContent = entity.itemName;
    name.title = entity.itemKey;
    name.addEventListener('click', function () {
      itemListExpanded[entity.itemKey] = !itemListExpanded[entity.itemKey];
      renderList();
    });

    var summary = document.createElement('span');
    summary.className = 'mufy-item-card-summary';
    summary.textContent = '基础字段 ' + entity.fields.length + ' 项';

    var expanded = !!itemListExpanded[entity.itemKey];
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mufy-item-card-toggle';
    toggle.textContent = expanded ? '收起' : '展开';
    toggle.addEventListener('click', function () {
      itemListExpanded[entity.itemKey] = !expanded;
      renderList();
    });

    head.appendChild(checkbox);
    head.appendChild(name);
    head.appendChild(summary);
    head.appendChild(toggle);
    card.appendChild(head);

    var note = document.createElement('div');
    note.className = 'mufy-item-card-note';
    note.textContent = '交互提示词与使用后文案需打开对应交互编辑窗后再采集。';
    card.appendChild(note);

    if (expanded) {
      var children = document.createElement('div');
      children.className = 'mufy-item-card-children';
      entity.fields.forEach(function (field) {
        children.appendChild(renderNormalFieldRow(field, true));
      });
      card.appendChild(children);
    }

    return card;
  }

  function renderList() {
    if (!listEl) return;

    var title = panelEl ? panelEl.querySelector('#mufy-helper-header span') : null;
    if (title) title.textContent = '🧩 Mufy 字段助手 V0.5.9';

    listEl.innerHTML = '';

    var entities = buildScannedItemEntities();
    var entityByStart = {};
    var skip = {};

    entities.forEach(function (entity) {
      entityByStart[entity.recordIndexes[0]] = entity;
      entity.recordIndexes.slice(1).forEach(function (index) { skip[index] = true; });
    });

    var itemSectionAdded = false;

    fields.forEach(function (field, index) {
      if (!isItemField(field)) {
        listEl.appendChild(renderNormalFieldRow(field, false));
        return;
      }

      if (skip[index]) return;

      var entity = entityByStart[index];
      if (!entity) {
        listEl.appendChild(renderNormalFieldRow(field, false));
        return;
      }

      if (!itemSectionAdded) {
        var section = document.createElement('div');
        section.className = 'mufy-item-section';
        section.innerHTML = '物品栏<small>' + entities.length + ' 件</small>';
        listEl.appendChild(section);
        itemSectionAdded = true;
      }

      listEl.appendChild(renderItemCard(entity));
    });
  }

  /* ─── 面板构建 ─── */

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'mufy-helper-panel';
    panelEl.innerHTML = [
      '<div id="mufy-helper-header">',
      '<span>🧩 Mufy 字段助手 V0.5.9</span>',
      '<span class="close">✕</span>',
      '</div>',
      '<div id="mufy-helper-toolbar">',
      '<button data-act="scan">扫描字段</button>',
      '<button data-act="copy">提取为 Markdown</button>',
      '<button data-act="workbench">进入工作台</button>',
      '<button class="secondary" data-act="toggle-paste">粘贴 AI 结果</button>',
      '</div>',
      '<div id="mufy-helper-list"></div>',
      '<div id="mufy-helper-paste">',
      '<textarea placeholder="粘贴 LLM 返回的 Markdown：## 字段名 + 内容"></textarea>',
      '<button id="mufy-helper-preview">预览改动</button>',
      '<div id="mufy-helper-preview-box"></div>',
      '<div id="mufy-helper-confirm-row">',
      '<button id="mufy-helper-confirm">确认写入</button>',
      '<button id="mufy-helper-cancel-preview" class="secondary">取消</button>',
      '</div>',
      '<button id="mufy-helper-undo">撤销本次写入</button>',
      '</div>'
    ].join('');

    document.body.appendChild(panelEl);
    listEl = panelEl.querySelector('#mufy-helper-list');

    panelEl.querySelector('.close').addEventListener('click', function () {
      panelEl.classList.remove('open');
    });

    panelEl.querySelector('[data-act="scan"]').addEventListener('click', function () {
      scanFields();
      renderList();
      var pending = fields.filter(function (f) {
        return f.isUnrecognized || f.needsReview;
      }).length;
      var message = '扫描到 ' + fields.length + ' 个字段';
      if (pending) message += '，其中 ' + pending + ' 个需确认且默认未勾选';
      toast(message);
    });

    panelEl.querySelector('[data-act="copy"]').addEventListener('click', function () {
      if (!fields.length) { scanFields(); renderList(); }
      var selected = getEnabledFields();
      if (!selected.length) { toast('当前没有勾选字段，先选择本次要导出的内容'); return; }
      var unsafe = getUnsafeEnabledFields();
      if (unsafe.length) { toast('有 ' + unsafe.length + ' 个未确认字段已勾选，请先改名、重绑或取消勾选'); return; }
      var duplicateLabels = getDuplicateEnabledLabels();
      if (duplicateLabels.length) { toast('已选字段有重名标题：' + duplicateLabels.join('、') + '；请先改成不同标题'); return; }
      copyText(buildMarkdown()).then(function (ok) {
        toast(ok ? '已复制已选字段，可直接粘贴给 LLM' : '复制失败，请手动选择文本复制');
      });
    });

    panelEl.querySelector('[data-act="workbench"]').addEventListener('click', function () {
      if (!fields.length) { scanFields(); renderList(); }
      var unsafe = getUnsafeEnabledFields();
      if (unsafe.length) {
        toast('有 ' + unsafe.length + ' 个未确认字段已勾选，请先改名、重绑或取消勾选后再进入工作台');
        return;
      }
      panelEl.classList.remove('open');
      openWorkbench();
    });

    var pasteBox = panelEl.querySelector('#mufy-helper-paste');
    panelEl.querySelector('[data-act="toggle-paste"]').addEventListener('click', function () {
      pasteBox.classList.toggle('open');
    });

    var previewBox = panelEl.querySelector('#mufy-helper-preview-box');
    var confirmRow = panelEl.querySelector('#mufy-helper-confirm-row');
    var undoButton = panelEl.querySelector('#mufy-helper-undo');
    var pendingPlan = null;

    function hidePreview() {
      pendingPlan = null;
      previewBox.classList.remove('show');
      confirmRow.classList.remove('show');
    }

    panelEl.querySelector('#mufy-helper-preview').addEventListener('click', function () {
      var text = pasteBox.querySelector('textarea').value;
      if (!text.trim()) { toast('粘贴框是空的'); return; }
      var enabledFields = getEnabledFields();
      if (!enabledFields.length) { toast('当前没有勾选字段，先在字段列表里勾选要写入的内容'); return; }
      var unsafe = getUnsafeEnabledFields();
      if (unsafe.length) { toast('有 ' + unsafe.length + ' 个未确认字段已勾选，请先改名、重绑或取消勾选'); return; }
      var duplicateLabels = getDuplicateEnabledLabels();
      if (duplicateLabels.length) { toast('已选字段有重名标题：' + duplicateLabels.join('、') + '；请先改成不同标题'); return; }
      var map = parseMarkdownToMap(text, enabledFields);
      var result = buildApplyPlan(map, enabledFields);
      if (!result.plan.length) {
        hidePreview();
        toast('没有检测到需要写入的改动：内容相同，或字段标题没有精确匹配');
        return;
      }
      pendingPlan = result.plan;
      var lines = result.plan.map(function (item) {
        return '<b>' + escapeHtml(item.field.label) + '</b>：' +
          item.oldVal.length + ' → ' + item.newVal.length + ' 字';
      });
      var html = '共 <b>' + result.plan.length + '</b> 个字段将被修改：<br>' + lines.join('<br>');
      if (result.missed.length) html += '<br><br>勾选但未匹配到内容：' + escapeHtml(result.missed.join('、'));
      if (result.extra.length) html += '<br>文本里有多余字段（已忽略）：' + escapeHtml(result.extra.join('、'));
      previewBox.innerHTML = html;
      previewBox.classList.add('show');
      confirmRow.classList.add('show');
    });

    panelEl.querySelector('#mufy-helper-confirm').addEventListener('click', function () {
      if (!pendingPlan || !pendingPlan.length) { hidePreview(); return; }
      var stale = pendingPlan.filter(function (item) {
        return !item.field.el || !item.field.el.isConnected;
      });
      if (stale.length) {
        hidePreview();
        toast('有 ' + stale.length + ' 个字段已被页面重新渲染，请重新扫描后再预览写入');
        return;
      }
      var count = pendingPlan.length;
      executeApplyPlan(pendingPlan);
      hidePreview();
      undoButton.classList.add('show');
      renderList();
      toast('已写入 ' + count + ' 个字段；需要时可点"撤销本次写入"');
    });

    panelEl.querySelector('#mufy-helper-cancel-preview').addEventListener('click', function () {
      hidePreview();
    });

    undoButton.addEventListener('click', function () {
      var count = undoLastApply();
      if (count > 0) { renderList(); toast('已撤销 ' + count + ' 个字段的写入'); }
      undoButton.classList.remove('show');
    });

    enableDrag(panelEl, panelEl.querySelector('#mufy-helper-header'));
  }

  /* ─── 拖拽 ─── */

  function enableDrag(panel, handle) {
    var dragging = false;
    var offsetX = 0;
    var offsetY = 0;
    handle.addEventListener('mousedown', function (event) {
      if (event.target && event.target.classList.contains('close')) return;
      dragging = true;
      var rect = panel.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
    });
    document.addEventListener('mousemove', function (event) {
      if (!dragging) return;
      panel.style.left = event.clientX - offsetX + 'px';
      panel.style.top = event.clientY - offsetY + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', function () { dragging = false; });
  }

  /* ─── 悬浮按钮 ─── */

  function buildToggleButton() {
    var button = document.createElement('div');
    button.id = 'mufy-helper-toggle';
    button.textContent = '🧩';
    button.title = 'Mufy 字段助手';
    button.addEventListener('click', function () {
      panelEl.classList.toggle('open');
      if (panelEl.classList.contains('open') && !fields.length) {
        scanFields();
        renderList();
      }
    });
    document.body.appendChild(button);
  }

  /* ─── SPA 自修复 ─── */

  function ensureUI() {
    var toggle = document.getElementById('mufy-helper-toggle');
    var panel = document.getElementById('mufy-helper-panel');
    var workbench = document.getElementById('mufy-workbench');

    if (toggle && panel && workbench) return;

    if (toggle) toggle.remove();
    if (panel) panel.remove();
    if (workbench) workbench.remove();

    panelEl = null;
    listEl = null;
    wbEl = null;

    buildWorkbench();
    buildPanel();
    buildToggleButton();

    if (fields.length && listEl) renderList();
  }

  /* ─── 初始化 ─── */

  function init() {
    injectStyleOnce();
    ensureUI();

    var queued = false;
    var observer = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        ensureUI();
      });
    });
    observer.observe(document.body, { childList: true });
  }

  init();
})();
