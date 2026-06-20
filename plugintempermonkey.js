// ==UserScript==
// @name         Mufy 角色卡编辑助手
// @namespace    mufy-card-helper
// @version      0.2.2
// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段
// @match        https://chat.mufy.ai/create*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /*
    V0.2.2 目标：
    1. 未识别字段默认不勾选，避免误送 LLM / 误写回。
    2. 对“默认认知”的主内容、条目标题、条目内容做语义分组。
    3. 对“物品名称 + 物品描述”做同卡分组。
    4. 保留 V0.2.1 的预览、确认、撤销、失效节点保护和 SPA 自修复。

    不做跨刷新字段绑定。Mufy 懒挂载会改变节点数量和顺序，序号持久化不安全。
  */

  var fields = [];
  var lastSnapshot = null;
  var panelEl = null;
  var listEl = null;

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

    setTimeout(function () {
      node.remove();
    }, 2800);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () {
          return true;
        })
        .catch(function () {
          return fallbackCopy(text);
        });
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
      if (
        labelEquals(field.rawLabel, '默认认知') &&
        field.type === 'textarea'
      ) {
        anchorIndexes.push(index);
      }
    });

    anchorIndexes.forEach(function (anchorIndex) {
      var anchor = list[anchorIndex];

      if (anchor.role) return;

      assignFieldIdentity(
        anchor,
        '默认认知｜主内容',
        '默认认知',
        '主内容',
        { recognized: true }
      );

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

        var entryTitle = shortName(
          getValue(candidate.el),
          '未命名条目 ' + entryNumber
        );

        var group = '默认认知条目｜' + entryTitle;

        assignFieldIdentity(
          candidate,
          group + '｜标题',
          group,
          '标题',
          {
            recognized: true,
            inferred: candidateIsUnknown
          }
        );

        var next = list[cursor + 1];

        var canPair = next &&
          next.type === 'textarea' &&
          (
            labelEquals(next.rawLabel, '默认认知') ||
            next.isUnrecognized
          );

        if (canPair) {
          assignFieldIdentity(
            next,
            group + '｜内容',
            group,
            '内容',
            {
              recognized: true,
              inferred: next.isUnrecognized
            }
          );

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
      var isItemName =
        labelEquals(field.rawLabel, '物品名称') &&
        field.type === 'input';

      var isItemDescription =
        labelEquals(field.rawLabel, '物品描述') &&
        field.type === 'textarea';

      if (isItemName) {
        itemNumber += 1;

        var itemName = shortName(
          getValue(field.el),
          '未命名物品 ' + itemNumber
        );

        var group = '物品｜' + itemName;

        assignFieldIdentity(
          field,
          group + '｜名称',
          group,
          '名称',
          { recognized: true }
        );

        activeTitle = {
          index: index,
          group: group
        };

        return;
      }

      if (isItemDescription) {
        var isNearby =
          activeTitle &&
          index - activeTitle.index <= 2;

        if (isNearby) {
          assignFieldIdentity(
            field,
            activeTitle.group + '｜描述',
            activeTitle.group,
            '描述',
            { recognized: true }
          );
        } else {
          assignFieldIdentity(
            field,
            '物品描述（未配对 ' + index + '）',
            '物品',
            '描述',
            {
              recognized: true,
              needsReview: true
            }
          );
        }

        activeTitle = null;

        return;
      }

      if (activeTitle && index - activeTitle.index > 2) {
        activeTitle = null;
      }
    });
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

  function scanFields() {
    var selector =
      'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';

    var nodes = Array.from(document.querySelectorAll(selector)).filter(function (el) {
      return isVisible(el) &&
        !el.closest('#mufy-helper-panel') &&
        !el.closest('#mufy-helper-toggle');
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
        label: recognized
          ? rawLabel
          : '字段' + index + '（未识别）',
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
    disambiguateLabels(fields);

    return fields;
  }

  function getEnabledFields() {
    return fields.filter(function (field) {
      return field.enabled;
    });
  }

  function getUnsafeEnabledFields() {
    return fields.filter(function (field) {
      return field.enabled &&
        (field.isUnrecognized || field.needsReview);
    });
  }

  function getDuplicateEnabledLabels() {
    var counts = {};

    getEnabledFields().forEach(function (field) {
      counts[field.label] = (counts[field.label] || 0) + 1;
    });

    return Object.keys(counts).filter(function (label) {
      return counts[label] > 1;
    });
  }

  function getFieldStatus(field) {
    if (field.isUnrecognized) return '未识别';
    if (field.needsReview) return '需确认';
    if (field.isInferred) return '已分组';

    return '已识别';
  }

  function getFieldMeta(field) {
    if (field.group && field.role) {
      return field.group + ' · ' + field.role;
    }

    if (field.rawLabel) {
      return '原标签：' + field.rawLabel;
    }

    return '未找到可用字段标题';
  }

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
      var target = event.target;
      var rect = target.getBoundingClientRect();

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

  function buildMarkdown() {
    var selected = getEnabledFields();

    var header = [
      '以下仅包含本次已选中的角色卡字段。',
      '请按需修改，并严格使用“## 字段名”作为分隔标题原样返回这些字段。',
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

    if (lines.length && lines[0] === '') {
      lines.shift();
    }

    if (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.join('\n');
  }

  function parseMarkdownToMap(text, enabledFields) {
    var labelSet = new Set(enabledFields.map(function (field) {
      return field.label;
    }));

    var lines = asText(text).replace(/\r/g, '').split('\n');
    var map = {};
    var currentLabel = null;
    var buffer = [];

    function flush() {
      if (currentLabel !== null) {
        map[currentLabel] = sectionBufferToContent(buffer);
      }

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
          plan.push({
            field: field,
            oldVal: oldValue,
            newVal: newValue
          });
        }
      } else {
        missed.push(field.label);
      }
    });

    var extra = Object.keys(map).filter(function (label) {
      return !enabledFields.some(function (field) {
        return field.label === label;
      });
    });

    return {
      plan: plan,
      missed: missed,
      extra: extra
    };
  }

  function executeApplyPlan(plan) {
    lastSnapshot = plan.map(function (item) {
      return {
        field: item.field,
        oldVal: item.oldVal
      };
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

  function injectStyleOnce() {
    if (document.getElementById('mufy-helper-style')) return;

    var style = document.createElement('style');

    style.id = 'mufy-helper-style';

    style.textContent = [
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
      '@media (max-width:560px){#mufy-helper-panel{left:10px;right:10px;top:56px;width:auto;max-height:82vh}#mufy-helper-toggle{right:16px;bottom:16px}}'
    ].join('');

    document.head.appendChild(style);
  }

  function renderList() {
    if (!listEl) return;

    listEl.innerHTML = '';

    fields.forEach(function (field) {
      var row = document.createElement('div');

      row.className = 'mufy-field-row' +
        (
          field.isUnrecognized || field.needsReview
            ? ' is-unconfirmed'
            : ''
        );

      var checkbox = document.createElement('input');

      checkbox.type = 'checkbox';
      checkbox.checked = field.enabled;

      checkbox.addEventListener('change', function () {
        field.enabled = checkbox.checked;
      });

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

        row.classList.remove('is-unconfirmed');

        badge.textContent = '已手动确认';
        badge.className = 'mufy-field-badge inferred';
      });

      var badge = document.createElement('span');
      var status = getFieldStatus(field);

      badge.textContent = status;
      badge.className = 'mufy-field-badge';

      if (status === '已分组') {
        badge.className += ' inferred';
      }

      if (status === '未识别' || status === '需确认') {
        badge.className += ' unconfirmed';
      }

      var length = document.createElement('span');

      length.className = 'len';
      length.textContent = getValue(field.el).length + ' 字';

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

          toast('“' + field.label + '”本次重绑成功');
        });
      });

      var meta = document.createElement('div');

      meta.className = 'mufy-field-meta';
      meta.textContent = getFieldMeta(field);
      meta.title = meta.textContent;

      row.appendChild(checkbox);
      row.appendChild(nameInput);
      row.appendChild(badge);
      row.appendChild(length);
      row.appendChild(rebindButton);
      row.appendChild(meta);

      listEl.appendChild(row);
    });
  }

  function buildPanel() {
    panelEl = document.createElement('div');

    panelEl.id = 'mufy-helper-panel';

    panelEl.innerHTML = [
      '<div id="mufy-helper-header">',
      '<span>🧩 Mufy 字段助手 V0.2.2</span>',
      '<span class="close">✕</span>',
      '</div>',
      '<div id="mufy-helper-toolbar">',
      '<button data-act="scan">扫描字段</button>',
      '<button data-act="copy">提取为 Markdown</button>',
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

      var pending = fields.filter(function (field) {
        return field.isUnrecognized || field.needsReview;
      }).length;

      var message = '扫描到 ' + fields.length + ' 个字段';

      if (pending) {
        message += '，其中 ' + pending + ' 个需确认且默认未勾选';
      }

      toast(message);
    });

    panelEl.querySelector('[data-act="copy"]').addEventListener('click', function () {
      if (!fields.length) {
        scanFields();
        renderList();
      }

      var selected = getEnabledFields();

      if (!selected.length) {
        toast('当前没有勾选字段，先选择本次要导出的内容');
        return;
      }

      var unsafe = getUnsafeEnabledFields();

      if (unsafe.length) {
        toast('有 ' + unsafe.length + ' 个未确认字段已勾选，请先改名、重绑或取消勾选');
        return;
      }

      var duplicateLabels = getDuplicateEnabledLabels();

      if (duplicateLabels.length) {
        toast('已选字段有重名标题：' + duplicateLabels.join('、') + '；请先改成不同标题');
        return;
      }

      copyText(buildMarkdown()).then(function (ok) {
        toast(
          ok
            ? '已复制已选字段，可直接粘贴给 LLM'
            : '复制失败，请手动选择文本复制'
        );
      });
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

      if (!text.trim()) {
        toast('粘贴框是空的');
        return;
      }

      var enabledFields = getEnabledFields();

      if (!enabledFields.length) {
        toast('当前没有勾选字段，先在字段列表里勾选要写入的内容');
        return;
      }

      var unsafe = getUnsafeEnabledFields();

      if (unsafe.length) {
        toast('有 ' + unsafe.length + ' 个未确认字段已勾选，请先改名、重绑或取消勾选');
        return;
      }

      var duplicateLabels = getDuplicateEnabledLabels();

      if (duplicateLabels.length) {
        toast('已选字段有重名标题：' + duplicateLabels.join('、') + '；请先改成不同标题');
        return;
      }

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

      var html =
        '共 <b>' + result.plan.length + '</b> 个字段将被修改：<br>' +
        lines.join('<br>');

      if (result.missed.length) {
        html +=
          '<br><br>勾选但未匹配到内容：' +
          escapeHtml(result.missed.join('、'));
      }

      if (result.extra.length) {
        html +=
          '<br>文本里有多余字段（已忽略）：' +
          escapeHtml(result.extra.join('、'));
      }

      previewBox.innerHTML = html;

      previewBox.classList.add('show');
      confirmRow.classList.add('show');
    });

    panelEl.querySelector('#mufy-helper-confirm').addEventListener('click', function () {
      if (!pendingPlan || !pendingPlan.length) {
        hidePreview();
        return;
      }

      var stale = pendingPlan.filter(function (item) {
        return !item.field.el || !item.field.el.isConnected;
      });

      if (stale.length) {
        hidePreview();

        toast(
          '有 ' + stale.length +
          ' 个字段已被页面重新渲染，请重新扫描后再预览写入'
        );

        return;
      }

      var count = pendingPlan.length;

      executeApplyPlan(pendingPlan);
      hidePreview();

      undoButton.classList.add('show');

      renderList();

      toast('已写入 ' + count + ' 个字段；需要时可点“撤销本次写入”');
    });

    panelEl.querySelector('#mufy-helper-cancel-preview').addEventListener('click', function () {
      hidePreview();
    });

    undoButton.addEventListener('click', function () {
      var count = undoLastApply();

      if (count > 0) {
        renderList();
        toast('已撤销 ' + count + ' 个字段的写入');
      }

      undoButton.classList.remove('show');
    });

    enableDrag(
      panelEl,
      panelEl.querySelector('#mufy-helper-header')
    );
  }

  function escapeHtml(value) {
    return asText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function enableDrag(panel, handle) {
    var dragging = false;
    var offsetX = 0;
    var offsetY = 0;

    handle.addEventListener('mousedown', function (event) {
      if (
        event.target &&
        event.target.classList.contains('close')
      ) {
        return;
      }

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

    document.addEventListener('mouseup', function () {
      dragging = false;
    });
  }

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

  function ensureUI() {
    var toggle = document.getElementById('mufy-helper-toggle');
    var panel = document.getElementById('mufy-helper-panel');

    if (toggle && panel) return;

    if (toggle) toggle.remove();
    if (panel) panel.remove();

    panelEl = null;
    listEl = null;

    buildPanel();
    buildToggleButton();

    if (fields.length && listEl) {
      renderList();
    }
  }

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

    observer.observe(document.body, {
      childList: true
    });
  }

  init();
})();