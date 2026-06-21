// ==UserScript==
// @name         白厨Mufy字段编辑器
// @namespace    mufy-card-helper
// @version      0.5.20
// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含物品聚合工作台、三态草稿层与安全单字段注入
// @match        https://chat.mufy.ai/create*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /*
    V0.5.15 专注编辑模式 + Mufy 手动回填复制流
    - 新增 wbFocusMode / wbClipboardTarget 全局状态。
    - 工作台顶栏新增"⛶ 专注编辑"按钮：隐藏左右栏，中区占满宽度（mufy-wb-focus class）。
    - Esc 键：专注模式内只退出专注，不关工作台，不丢草稿。
    - 返回按钮改为"← 收起并返回 Mufy"，tooltip 强调草稿保留。
    - 普通字段区底部新增 [复制当前字段] [复制并返回 Mufy]。
    - 交互表单：交互名称 / 提示词每行加 [复制] 按钮；每条文案加 [复制]；底部加 [复制当前交互回填包] [复制当前焦点内容并返回 Mufy]。
    - 物品上下文区新增 [复制本物品草稿包]（包含基础字段 + 所有交互 draftData）。
    - 焦点追踪：每个可编辑控件 focus 时更新 wbClipboardTarget。
    - 新增 copyRawDraftText / serializeInteractionDraft / serializeItemDraftBundle / copyCurrentWorkbenchTarget。
    - 再次进入工作台时恢复 wbFocusMode 状态。
    - 更新交互草稿边界提示文案。

    V0.5.18 双工作流收口与模块复制语义统一
    - interactionSnapshotsByItemKey 快照升级为三态模型：entryData / syncedData / draftData + syncStatus。
    - 新增 wbCurrentInteraction：工作台当前选中的交互（{ itemKey, interactionKey }）。
    - 工作台左栏物品卡展开后显示"基础信息"和"已采集交互"两段，交互条目可点击选中。

    V0.5.20 写卡工作流收口
    - 移除"粘贴 AI 结果"、批量预览、批量确认写入与批量撤销链路。
    - 悬浮窗只负责扫描、选择导出范围与复制字段给 AI。
    - 工作台与导出勾选彻底解耦：进入工作台可浏览全部安全字段。
    - 工作台新增字段 / 物品 / 交互搜索。
    - 普通字段操作统一为"回填到 Mufy 编辑页""撤回编辑页回填""复制正文"。
    - AI 返回文本由用户自行判断，并直接粘贴到工作台对应字段。

    V0.5.19 白厨Mufy字段编辑器品牌化、帮助中心与可调整编辑环境
    - 品牌统一：工具名称改为"白厨Mufy字段编辑器"。
    - 帮助中心模态框：面板顶栏与工作台顶栏各新增 [?] 按钮，含"使用说明"和"作者的话"两个 Tab。
    - 悬浮按钮重写：Pointer Events 拖拽（6px 阈值 + 视口边界约束 + 12px 边距），位置持久化。
    - 浮动面板拖拽重写：Pointer Events（替代旧 mousedown 方案），位置持久化。
    - UI 偏好持久化（localStorage whitechef-mufy-editor:ui-layout:v1）。
    - 工作台左/右栏可调宽度：6px 拖拽手柄，左 180-440px，右 190-380px，CSS 变量驱动。
    - 宽度 <960px 时隐藏手柄；专注模式隐藏手柄。
    - 修复左栏/中区同步 bug：进入工作台时始终 selectWbField(0)。
    - 字体大小设置（Aa 按钮 → 弹出层，13-22px，默认 15px），仅影响主编辑器。
    - Markdown 安全预览：普通字段和交互编辑器各新增 [编辑]/[预览] 切换；全 DOM API，无 innerHTML。
    - 工作台中间区：选中交互时展示结构化表单（交互名称 / 提示词 / 使用后文案数组 / 使用后操作）。
    - "写入当前字段"在交互模式下禁用并显示说明；"还原"还原 draftData → syncedData。
    - "复制给 LLM"追加交互 draftData 导出块，parseMarkdownToMap 遇此块立即停止解析。
    - 再次从 Mufy dialog 读取：clean → 同步更新 draftData；dirty/sourceChanged → 仅更新 syncedData。
    - 采集后若工作台已打开，自动刷新左栏和当前表单状态。

    V0.5.13 交互采集稳定性修复（持久会话模型）
    - 用 interactionCaptureSession（持久会话对象）替换 interactionCaptureArm（一次性 arm）。
    - 新增 scheduleStableInteractionRead()：弹窗出现后 180ms 初读，React 未灌入值时每 120ms 最多重试 8 次。
    - 新增 handleNewInteractionDialog()：绑定保存按钮事件委托（capture 阶段）+ input/change + 子树 MO 实时同步。
    - 新增 endInteractionCaptureSession()："结束采集"按钮 / HUD 一键结束；清理所有监听和计时器。
    - 新增 clearItemInteractionSnapshots()：确认后清空单物品的全部交互快照。
    - 新增 getOrCreateInteractionHud() + updateInteractionHud()：右下角固定 HUD 实时显示采集状态。
    - renderInteractionSection() 改为会话感知：当前物品激活会话时显示"结束采集"；有快照时显示"清空交互"。
    - scanFields() 过滤器新增 !el.closest('[role="dialog"]')，防止交互弹窗输入框污染 fields 数组。
    - readInteractionFromDialog() 使用后文案容器判断改为 !parent.contains(nameEl) && !parent.contains(promptEl)。
    - MutationObserver 守卫条件改为 !interactionCaptureSession。

    V0.5.12 物品交互弹窗采集（只读快照 + 导出）
    - 新增"采集交互"按钮于物品卡；点击后 arm interactionCaptureArm，收起面板。
    - 新增 findOpenInteractionDialog()：识别 [role="dialog"][data-state="open"] + h2"交互编辑" + #interaction-name + #use-copywriting。
    - 新增 readInteractionFromDialog()：读取交互名称、提示词、使用后文案（支持多条）、使用后操作 checkbox。
    - 新增 MutationObserver（subtree）：只有 arm/activeDialog 非空时才实际执行，避免空转。
    - 弹窗打开后立刻读取 observed 快照；用户点保存后更新为 saved 快照；关闭后保留 observed 原样。
    - interactionSnapshotsByItemKey 独立存储，不混入 fields 数组，不参与工作台写入。
    - buildMarkdown() 追加只读交互块；parseMarkdownToMap() 遇 H1 只读标记立即停止解析。
    - 同 roleId 保留快照；跨 roleId 时 clearInteractionSnapshots()；scanFields 后 prune 孤立快照。

    V0.5.11 全选安全修复
    - 全选只操作 getSelectableFields()（排除 isUnrecognized/needsReview）。
    - 强制保持未确认字段 enabled=false；有待确认字段时 toast 提示数量。
    - renderNormalFieldRow checkbox change 无论 compact 与否均调用 renderList()。

    V0.5.10 工作台暂存返回
    - "退出工作台"改为"← 返回 Mufy 页面"，关闭时只隐藏工作台，不清空任何草稿。
    - openWorkbench() 检测同角色 wbSessionRoleId：相同则直接恢复会话（不重新扫描、不覆盖 draftContent）。
    - 跨 roleId 切换时若有未写入草稿，弹确认对话框，取消则放弃进入新工作台。
    - clearWorkbenchSession() 只在跨角色确认放弃或页面刷新后调用，不再于收起时调用。
    - 恢复后显示 toast "已恢复本次工作台草稿"；wbLastWriteUndo / wbItemExpanded 全部保留。

    V0.5.9 物品聚合工作台
    - 左侧字段列表识别并聚合"物品｜名称 / 描述"字段，显示为可折叠物品卡片。
    - 工作台右侧新增 item-context-tabs，同一物品的字段可快速切换。
    - buildItemEntities / buildWorkbenchItemEntities / buildScannedItemEntities 统一聚合逻辑。
    - isItemField / itemNameFromGroup / assignUniqueItemGroups 处理物品组名与唯一性。
    - 三态草稿层（entryContent / syncedContent / draftContent）完整集成写入与撤回流程。
    - wbSessionRoleId 记录工作台会话归属 roleId，为 V0.5.10 恢复机制做铺垫。

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
    - 返回页面前曾检测未写入 Mufy 的草稿，避免误操作丢失内容。
    - Token 面板改为 300ms 防抖更新，降低超长字段编辑卡顿。

    V0.4.0 新增：草稿层 + Token 计数（步骤 2）
    - wbSnapshot 条目增加 draftContent，切换字段时自动保存草稿。
    - 恢复初始版本：draft → original（不触碰 Mufy DOM）。
    - 右侧信息区全面换成 Token 估算（本地近似：CJK≈1token，非CJK≈1/4token）。
    - 关键字段 Token 合计：角色设定、开场设计、输出设定、情节设定、样例对话、文风。
    - 上限 20900 Token，超出变红；固定提示资料库额外占 ~5000 Token。

    V0.3.0 工作台外壳沿用，V0.2.2 写入逻辑完全未改动。
  */

  /* ─── Mufy 核心字段（Token 合计只统计这五项） ─── */
  var TRACKED_FIELD_LABELS = ['人设', '开场设计', '输出设定', '情节设定', '样例对话&文风'];
  var TOKEN_LIMIT = 20900;

  /* ─── 全局状态 ─── */

  var fields = [];
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
  var wbSessionRoleId = '';
  var itemListExpanded = {};
  var wbItemExpanded = {};
  var wbCurrentInteraction = null;  // { itemKey, interactionKey } | null
  var wbFocusMode = false;
  var wbSearchText = '';            // 左栏搜索框当前文字
  var wbCurrentInteractionEditorTarget = null;  // { kind: 'prompt' | 'afterCopywriting', copywritingIndex: number | null }

  // UI 偏好（持久化至 localStorage）
  var UI_PREFS_KEY = 'whitechef-mufy-editor:ui-layout:v1';
  var uiPrefs = {
    launcherPosition: null,   // { x, y } — bottom-right origin  (null = default)
    panelPosition: null,      // { left, top } — absolute px (null = default)
    workbenchLeftWidth: 250,  // px
    workbenchRightWidth: 230, // px
    editorFontSize: 15        // px
  };

  function loadUiPrefs() {
    try {
      var raw = localStorage.getItem(UI_PREFS_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.launcherPosition) uiPrefs.launcherPosition = parsed.launcherPosition;
        if (parsed.panelPosition) uiPrefs.panelPosition = parsed.panelPosition;
        if (typeof parsed.workbenchLeftWidth === 'number') uiPrefs.workbenchLeftWidth = parsed.workbenchLeftWidth;
        if (typeof parsed.workbenchRightWidth === 'number') uiPrefs.workbenchRightWidth = parsed.workbenchRightWidth;
        if (typeof parsed.editorFontSize === 'number') uiPrefs.editorFontSize = parsed.editorFontSize;
      }
    } catch (e) { /* ignore */ }
  }

  function saveUiPrefs() {
    try {
      localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs));
    } catch (e) { /* ignore */ }
  }

  function applyWbColumnWidths() {
    if (!wbEl) return;
    wbEl.style.setProperty('--wb-left-width', uiPrefs.workbenchLeftWidth + 'px');
    wbEl.style.setProperty('--wb-right-width', uiPrefs.workbenchRightWidth + 'px');
  }

  function applyEditorFontSize() {
    if (wbEl) {
      wbEl.style.setProperty('--wb-editor-font-size', uiPrefs.editorFontSize + 'px');
    }
  }

  // 交互采集状态
  var interactionSnapshotsByItemKey = {};      // { itemKey: { interactionKey: snapshot } }
  var interactionCaptureSession = null;        // { itemKey, itemName, roleId, startedAt, capturedCount }
  var activeInteractionDialog = null;          // 当前监听的弹窗 Element | null
  var activeInteractionDialogObserver = null;  // 弹窗内部 MutationObserver
  var interactionCaptureRoleId = '';           // 采集会话归属 roleId
  var interactionObserverQueued = false;
  var interactionDebounceTimer = null;         // 稳定读取防抖计时器
  var interactionHudEl = null;                 // 固定采集状态 HUD

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

  /* ─── 草稿复制辅助 ─── */

  function copyRawDraftText(text, successMessage) {
    copyText(text).then(function (ok) {
      toast(ok ? successMessage : '复制失败，请手动选择文本');
    });
  }

  function serializeInteractionDraft(snap) {
    var dd = snap.draftData;
    var parts = [];
    parts.push('【交互名称】\n' + (dd.interactionName || ''));
    parts.push('【提示词】\n' + (dd.prompt || ''));
    (dd.afterCopywriting || []).forEach(function (text, i) {
      parts.push('【使用后文案 ' + (i + 1) + '】\n' + (text || ''));
    });
    parts.push('【使用后操作】\n' + (dd.afterAction ? '关闭' : '不操作'));
    return parts.join('\n\n');
  }

  function serializeItemDraftBundle(itemGroup) {
    var parts = [];
    // 基础字段来自 wbSnapshot
    wbSnapshot.forEach(function (snap) {
      var field = findFieldById(snap.fieldId);
      if (!field || field.group !== itemGroup) return;
      var roleName = field.role || snap.label;
      parts.push('【物品' + roleName + '】\n' + snap.draftContent);
    });
    // 交互 draftData
    var ixnMap = interactionSnapshotsByItemKey[itemGroup] || {};
    Object.keys(ixnMap).forEach(function (ik) {
      var snap = ixnMap[ik];
      var dd = snap.draftData;
      parts.push('【交互｜' + (dd.interactionName || ik) + '】\n\n' + serializeInteractionDraft(snap));
    });
    return parts.join('\n\n');
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

  function getCurrentRoleId() {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get('roleId') || '';
    } catch (error) {
      return '';
    }
  }

  function hasActiveWorkbenchSession() {
    return wbSnapshot.length > 0 && wbSessionRoleId === getCurrentRoleId();
  }

  /* ─── 交互弹窗采集 ─── */

  /* ── 弹窗识别 ── */

  function findOpenInteractionDialog() {
    var dialogs = Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]'));
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      var h2 = d.querySelector('h2');
      if (!h2 || h2.textContent.trim() !== '交互编辑') continue;
      if (!d.querySelector('#interaction-name')) continue;
      if (!d.querySelector('#use-copywriting')) continue;
      return d;
    }
    return null;
  }

  /* ── 弹窗字段读取 ── */

  function readInteractionFromDialog(dialog) {
    var nameEl = dialog.querySelector('#interaction-name');
    var promptEl = dialog.querySelector('#use-copywriting');
    var interactionName = nameEl ? nameEl.value.trim() : '';
    var prompt = promptEl ? promptEl.value : '';

    // 使用后文案：找到"使用后文案"标签，向上找最小容器：
    //   - 含至少一个文本 input；
    //   - 不含 #interaction-name 和 #use-copywriting。
    var afterCopywriting = [];
    var allNodes = Array.from(dialog.querySelectorAll('*'));
    var copywritingSection = null;

    for (var i = 0; i < allNodes.length; i++) {
      var node = allNodes[i];
      if (!node.children.length && node.textContent.trim() === '使用后文案') {
        var parent = node.parentElement;
        for (var depth = 0; depth < 8 && parent; depth++) {
          var textInputs = parent.querySelectorAll('input[type="text"], input:not([type])');
          if (textInputs.length > 0 && !parent.contains(nameEl) && !parent.contains(promptEl)) {
            copywritingSection = parent;
            break;
          }
          parent = parent.parentElement;
        }
        break;
      }
    }

    if (copywritingSection) {
      Array.from(copywritingSection.querySelectorAll('input[type="text"], input:not([type])')).forEach(function (inp) {
        afterCopywriting.push(inp.value);
      });
    }

    // 使用后操作
    var afterAction = false;
    for (var j = 0; j < allNodes.length; j++) {
      var el = allNodes[j];
      if (!el.children.length && el.textContent.trim() === '使用后操作') {
        var container = el.parentElement;
        for (var d2 = 0; d2 < 8 && container; d2++) {
          var cb = container.querySelector('input[type="checkbox"]');
          if (cb) { afterAction = cb.checked; break; }
          container = container.parentElement;
        }
        break;
      }
    }

    return { interactionName: interactionName, prompt: prompt, afterCopywriting: afterCopywriting, afterAction: afterAction };
  }

  /* ── 快照存储 ── */

  function cloneIxnData(data) {
    return {
      interactionName: data.interactionName,
      prompt: data.prompt,
      afterCopywriting: (data.afterCopywriting || []).slice(),
      afterAction: !!data.afterAction
    };
  }

  function storeInteractionSnapshot(itemKey, itemName, data, state) {
    var key = data.interactionName;
    if (!key) return null;
    if (!interactionSnapshotsByItemKey[itemKey]) interactionSnapshotsByItemKey[itemKey] = {};
    var existing = interactionSnapshotsByItemKey[itemKey][key];
    var captureState = state || (existing ? existing.captureState : 'observed');

    if (!existing) {
      var entry = cloneIxnData(data);
      interactionSnapshotsByItemKey[itemKey][key] = {
        itemKey: itemKey,
        itemName: itemName,
        interactionKey: key,
        entryData: entry,
        syncedData: cloneIxnData(data),
        draftData: cloneIxnData(data),
        captureState: captureState,
        syncStatus: 'clean',
        exportEnabled: false,
        capturedAt: Date.now()
      };
    } else {
      existing.syncedData = cloneIxnData(data);
      existing.captureState = captureState;
      existing.capturedAt = Date.now();
      if (existing.syncStatus === 'clean') {
        existing.draftData = cloneIxnData(data);
      } else {
        existing.syncStatus = 'sourceChanged';
      }
    }
    return interactionSnapshotsByItemKey[itemKey][key];
  }

  /* ── 稳定读取（等待 React 灌入 value） ── */

  function attemptInteractionRead(dialog, attempt) {
    if (!dialog.isConnected || dialog.getAttribute('data-state') !== 'open') return;
    if (!interactionCaptureSession) return;

    var nameEl = dialog.querySelector('#interaction-name');
    var name = nameEl ? nameEl.value.trim() : '';

    if (!name) {
      if (attempt < 8) {
        interactionDebounceTimer = window.setTimeout(function () {
          interactionDebounceTimer = null;
          attemptInteractionRead(dialog, attempt + 1);
        }, 120);
      } else {
        updateInteractionHud('交互内容尚未加载完成，请稍候或重新打开该交互。');
      }
      return;
    }

    var session = interactionCaptureSession;
    var data = readInteractionFromDialog(dialog);
    var snap = storeInteractionSnapshot(session.itemKey, session.itemName, data, 'observed');
    if (snap) {
      session.capturedCount = Object.keys(interactionSnapshotsByItemKey[session.itemKey] || {}).length;
      updateInteractionHud();
      renderList();
      if (wbEl && wbEl.classList.contains('open')) {
        renderWbFieldList();
        if (wbCurrentInteraction &&
            wbCurrentInteraction.itemKey === snap.itemKey &&
            wbCurrentInteraction.interactionKey === snap.interactionKey) {
          var statusEl = wbEl.querySelector('#mufy-ixn-sync-status');
          if (statusEl) statusEl.textContent = ixnSyncStatusText(snap.syncStatus);
        }
      }
    }
  }

  function scheduleStableInteractionRead(dialog, reason) {
    if (interactionDebounceTimer) {
      window.clearTimeout(interactionDebounceTimer);
      interactionDebounceTimer = null;
    }
    var delay = reason === 'new-dialog' ? 180 : 180;
    interactionDebounceTimer = window.setTimeout(function () {
      interactionDebounceTimer = null;
      attemptInteractionRead(dialog, 0);
    }, delay);
  }

  /* ── 新弹窗接管（事件委托 + 实时更新） ── */

  function handleNewInteractionDialog(dialog) {
    activeInteractionDialog = dialog;

    // 初始稳定读取
    scheduleStableInteractionRead(dialog, 'new-dialog');

    // 保存按钮：事件委托（capture 阶段，React 替换节点也能捕获）
    dialog.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button') : null;
      if (!btn || btn.textContent.trim() !== '保存') return;
      if (!interactionCaptureSession) return;
      window.setTimeout(function () {
        if (!dialog.isConnected) return;
        var data = readInteractionFromDialog(dialog);
        if (!data.interactionName) return;
        var session = interactionCaptureSession;
        var saved = storeInteractionSnapshot(session.itemKey, session.itemName, data, 'saved');
        session.capturedCount = Object.keys(interactionSnapshotsByItemKey[session.itemKey] || {}).length;
        updateInteractionHud();
        renderList();
        if (saved && wbEl && wbEl.classList.contains('open')) {
          renderWbFieldList();
          if (wbCurrentInteraction &&
              wbCurrentInteraction.itemKey === saved.itemKey &&
              wbCurrentInteraction.interactionKey === saved.interactionKey) {
            var statusEl = wbEl.querySelector('#mufy-ixn-sync-status');
            if (statusEl) statusEl.textContent = ixnSyncStatusText(saved.syncStatus);
          }
        }
        toast('已保存"' + data.interactionName + '"交互快照');
      }, 30);
    }, true);

    // 实时更新（input / change / 增加文案后 childList 变化）
    function scheduleLiveUpdate() {
      scheduleStableInteractionRead(dialog, 'live-update');
    }
    dialog.addEventListener('input', scheduleLiveUpdate);
    dialog.addEventListener('change', scheduleLiveUpdate);

    var dialogMutObs = new MutationObserver(scheduleLiveUpdate);
    dialogMutObs.observe(dialog, { childList: true, subtree: true });
    activeInteractionDialogObserver = dialogMutObs;
  }

  /* ── dialog 状态轮询 ── */

  function checkForInteractionDialog() {
    if (activeInteractionDialog) {
      var stillOpen = activeInteractionDialog.isConnected &&
        activeInteractionDialog.getAttribute('data-state') === 'open';
      if (!stillOpen) {
        if (activeInteractionDialogObserver) {
          activeInteractionDialogObserver.disconnect();
          activeInteractionDialogObserver = null;
        }
        if (interactionDebounceTimer) {
          window.clearTimeout(interactionDebounceTimer);
          interactionDebounceTimer = null;
        }
        activeInteractionDialog = null;
        if (interactionCaptureSession) updateInteractionHud();
      }
      return;
    }
    if (!interactionCaptureSession) return;
    var dialog = findOpenInteractionDialog();
    if (dialog) handleNewInteractionDialog(dialog);
  }

  /* ── 采集会话管理 ── */

  function startInteractionCaptureSession(entity) {
    var currentRoleId = getCurrentRoleId();
    if (interactionCaptureRoleId && interactionCaptureRoleId !== currentRoleId) {
      interactionSnapshotsByItemKey = {};
    }
    interactionCaptureRoleId = currentRoleId;

    if (interactionCaptureSession) endInteractionCaptureSession();

    var existingCount = Object.keys(interactionSnapshotsByItemKey[entity.itemKey] || {}).length;
    interactionCaptureSession = {
      itemKey: entity.itemKey,
      itemName: entity.itemName,
      roleId: currentRoleId,
      startedAt: Date.now(),
      capturedCount: existingCount
    };
    activeInteractionDialog = null;
    if (panelEl) panelEl.classList.remove('open');
    updateInteractionHud();
    renderList();
    toast('已开始采集"' + entity.itemName + '"的交互，请点击 Mufy 中的交互按钮打开"交互编辑"窗口。');
  }

  function endInteractionCaptureSession() {
    if (activeInteractionDialogObserver) {
      activeInteractionDialogObserver.disconnect();
      activeInteractionDialogObserver = null;
    }
    if (interactionDebounceTimer) {
      window.clearTimeout(interactionDebounceTimer);
      interactionDebounceTimer = null;
    }
    interactionCaptureSession = null;
    activeInteractionDialog = null;
    if (interactionHudEl) interactionHudEl.style.display = 'none';
    renderList();
    toast('已结束交互采集');
  }

  function clearItemInteractionSnapshots(entity) {
    var confirmed = window.confirm('确定清空"' + entity.itemName + '"已采集的全部交互快照吗？');
    if (!confirmed) return;
    delete interactionSnapshotsByItemKey[entity.itemKey];
    if (interactionCaptureSession && interactionCaptureSession.itemKey === entity.itemKey) {
      interactionCaptureSession.capturedCount = 0;
    }
    if (wbCurrentInteraction && wbCurrentInteraction.itemKey === entity.itemKey) {
      wbCurrentInteraction = null;
      if (wbEl && wbEl.classList.contains('open')) {
        showNormalEditor();
        updateWbWriteControls();
      }
    }
    updateInteractionHud();
    renderList();
    if (wbEl && wbEl.classList.contains('open')) renderWbFieldList();
  }

  /* ── HUD ── */

  function getOrCreateInteractionHud() {
    if (interactionHudEl && interactionHudEl.isConnected) return interactionHudEl;
    interactionHudEl = document.createElement('div');
    interactionHudEl.id = 'mufy-interaction-hud';
    interactionHudEl.innerHTML =
      '<div class="mufy-hud-title">正在采集：<span id="mufy-hud-item-name"></span></div>' +
      '<div class="mufy-hud-status"><span id="mufy-hud-status-text"></span></div>' +
      '<button id="mufy-hud-end-btn" type="button">结束采集</button>';
    interactionHudEl.querySelector('#mufy-hud-end-btn').addEventListener('click', endInteractionCaptureSession);
    document.body.appendChild(interactionHudEl);
    return interactionHudEl;
  }

  function updateInteractionHud(warningText) {
    if (!interactionCaptureSession) {
      if (interactionHudEl) interactionHudEl.style.display = 'none';
      return;
    }
    var hud = getOrCreateInteractionHud();
    hud.style.display = 'block';
    hud.querySelector('#mufy-hud-item-name').textContent = interactionCaptureSession.itemName;
    hud.querySelector('#mufy-hud-status-text').textContent = warningText ||
      ('已读取：' + (interactionCaptureSession.capturedCount || 0) + ' 项');
  }

  /* ── 快照维护 ── */

  function pruneInteractionSnapshots() {
    var validKeys = {};
    fields.forEach(function (f) { if (f.group) validKeys[f.group] = true; });
    Object.keys(interactionSnapshotsByItemKey).forEach(function (k) {
      if (!validKeys[k]) delete interactionSnapshotsByItemKey[k];
    });
  }

  function clearInteractionSnapshots() {
    interactionSnapshotsByItemKey = {};
    wbCurrentInteraction = null;
    interactionCaptureSession = null;
    activeInteractionDialog = null;
    if (activeInteractionDialogObserver) {
      activeInteractionDialogObserver.disconnect();
      activeInteractionDialogObserver = null;
    }
    if (interactionDebounceTimer) {
      window.clearTimeout(interactionDebounceTimer);
      interactionDebounceTimer = null;
    }
    interactionCaptureRoleId = '';
    if (interactionHudEl) interactionHudEl.style.display = 'none';
  }

  function getEnabledInteractions() {
    var selected = [];
    Object.keys(interactionSnapshotsByItemKey).forEach(function (itemKey) {
      var interactions = interactionSnapshotsByItemKey[itemKey];
      Object.keys(interactions).forEach(function (interactionKey) {
        var snap = interactions[interactionKey];
        if (snap && snap.exportEnabled === true) selected.push(snap);
      });
    });
    return selected;
  }

  function buildInteractionMarkdown(selectedInteractions) {
    if (!selectedInteractions || !selectedInteractions.length) return '';

    var lines = [
      '',
      '---',
      '',
      '# 已选物品交互（手动回填模块）',
      '',
      '以下交互为本次主动勾选的模块。',
      '可以用于参考或协助修改。',
      '',
      '插件不会自动回填交互弹窗。',
      '如需使用 AI 改写后的内容，请在工作台中手动粘贴，',
      '再复制到 Mufy 对应交互窗并点击保存。',
      ''
    ];

    var byItem = {};
    selectedInteractions.forEach(function (snap) {
      var itemKey = snap.itemKey || '未命名物品';
      if (!byItem[itemKey]) byItem[itemKey] = [];
      byItem[itemKey].push(snap);
    });

    Object.keys(byItem).forEach(function (itemKey) {
      lines.push('## ' + itemKey);
      lines.push('');
      byItem[itemKey].forEach(function (snap) {
        var sd = snap.syncedData || snap.draftData || {};
        var ik = snap.interactionKey || sd.interactionName || '未命名交互';
        lines.push('### 交互｜' + (sd.interactionName || ik));
        lines.push('');
        lines.push('#### 提示词');
        lines.push('');
        lines.push(sd.prompt || '（空）');
        lines.push('');
        if (sd.afterCopywriting && sd.afterCopywriting.length) {
          sd.afterCopywriting.forEach(function (text, idx) {
            lines.push('#### 使用后文案 ' + (idx + 1));
            lines.push('');
            lines.push(text || '（空）');
            lines.push('');
          });
        }
        lines.push('#### 使用后操作');
        lines.push('');
        lines.push(sd.afterAction ? '关闭' : '不操作');
        lines.push('');
      });
    });

    return lines.join('\n');
  }

  function clearWorkbenchSession() {
    clearWbTokenTimer();
    wbLastWriteUndo = null;
    wbWritePending = false;
    wbCurrentIndex = -1;
    wbSnapshot = [];
    wbSessionRoleId = '';
    wbItemExpanded = {};
    clearInteractionSnapshots();
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
        !el.closest('#mufy-workbench') &&
        !el.closest('[role="dialog"]');
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
    pruneInteractionSnapshots();
    return fields;
  }

  function getEnabledFields() {
    return fields.filter(function (f) { return f.enabled; });
  }

  // 导出范围：当前勾选普通字段与交互，仅影响"复制已选内容给 AI"
  function getExportFields() {
    return getEnabledFields();
  }

  // 工作台字段目录：所有已识别、可安全编辑的字段，与勾选状态无关
  function getWorkbenchFields() {
    return fields.filter(function (f) {
      return !f.isUnrecognized && !f.needsReview;
    });
  }

  function getUnsafeEnabledFields() {
    return fields.filter(function (f) {
      return f.enabled && (f.isUnrecognized || f.needsReview);
    });
  }

  function getSelectableFields() {
    return fields.filter(function (f) {
      return !f.isUnrecognized && !f.needsReview;
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

  /* ─── Markdown 构建（导出给 AI） ─── */

  function buildMarkdown() {
    var selected = getExportFields();
    var selectedInteractions = getEnabledInteractions();
    var header = selected.length ? '以下是本次已选中的角色卡字段（格式：## 字段名）。\n\n' : '';
    var body = selected.map(function (field) {
      return '## ' + field.label + '\n\n' + getValue(field.el) + '\n';
    }).join('\n');
    return header + body + buildInteractionMarkdown(selectedInteractions);
  }

  /* ─── 全屏工作台 ─── */

  function buildWorkbench() {
    wbEl = document.createElement('div');
    wbEl.id = 'mufy-workbench';

    wbEl.innerHTML = [
      '<div id="mufy-wb-topbar">',
      '  <button id="mufy-wb-return" title="暂时隐藏工作台并回到当前 Mufy 编辑页；本页未刷新前草稿会保留。">← 收起工作台</button>',
      '  <button id="mufy-wb-restore" class="secondary" title="放弃当前字段或交互草稿的编辑，恢复到最近一次同步版本。">还原当前字段草稿</button>',
      '  <button id="mufy-wb-focus" class="secondary" title="隐藏左右栏，专注编辑当前内容。">⛶ 专注编辑</button>',
      '  <span id="mufy-wb-title" class="wb-title">工作台</span>',
      '  <button id="mufy-wb-aa" class="secondary wb-icon-btn" title="显示设置：字体大小与布局">Aa</button>',
      '  <button id="mufy-wb-help" class="secondary wb-icon-btn" title="帮助">?</button>',
      '  <div id="mufy-wb-aa-popover" class="wb-aa-popover" style="display:none"></div>',
      '</div>',
      '<div id="mufy-wb-body">',
      '  <div id="mufy-wb-left">',
      '    <input id="mufy-wb-search" class="mufy-wb-search" placeholder="搜索字段、物品或交互…" autocomplete="off">',
      '    <div id="mufy-wb-field-list"></div>',
      '  </div>',
      '  <div id="mufy-wb-left-handle" class="wb-col-handle" title="拖拽调整左栏宽度"></div>',
      '  <div id="mufy-wb-center">',
      '    <div id="mufy-item-context"></div>',
      '    <div id="mufy-wb-editor-bar" class="wb-editor-mode-bar">',
      '      <button id="mufy-wb-mode-edit" class="wb-mode-btn active">编辑</button>',
      '      <button id="mufy-wb-mode-preview" class="wb-mode-btn">预览</button>',
      '    </div>',
      '    <textarea id="mufy-wb-editor" placeholder="从左侧选择一个字段…"></textarea>',
      '    <div id="mufy-wb-preview" class="wb-preview-pane" style="display:none"></div>',
      '    <div id="mufy-wb-action-bar">',
      '      <button id="mufy-wb-write-btn">回填到 Mufy 编辑页</button>',
      '      <button id="mufy-wb-undo-write-btn" class="secondary" style="display:none">撤回编辑页写入</button>',
      '      <span id="mufy-wb-write-status"></span>',
      '      <button id="mufy-wb-copy-field" class="secondary">复制正文</button>',
      '    </div>',
      '    <div id="mufy-wb-interaction-form">',
      '      <div class="mufy-ixn-name-row">',
      '        <label class="mufy-ixn-label">交互名称</label>',
      '        <input id="mufy-ixn-name" type="text" class="mufy-ixn-input" placeholder="交互名称">',
      '        <button type="button" id="mufy-ixn-copy-name" class="mufy-ixn-copy-btn">复制名称</button>',
      '      </div>',
      '      <div id="mufy-ixn-tab-bar"></div>',
      '      <div id="mufy-ixn-editor-bar" class="wb-editor-mode-bar">',
      '        <button id="mufy-ixn-mode-edit" class="wb-mode-btn active">编辑</button>',
      '        <button id="mufy-ixn-mode-preview" class="wb-mode-btn">预览</button>',
      '      </div>',
      '      <textarea id="mufy-ixn-main-editor" class="mufy-ixn-main-textarea" placeholder="选择上方 tab 开始编辑…"></textarea>',
      '      <div id="mufy-ixn-preview" class="wb-preview-pane" style="display:none"></div>',
      '      <div class="mufy-ixn-field-group mufy-ixn-action-row">',
      '        <label class="mufy-ixn-label">使用后操作</label>',
      '        <label class="mufy-ixn-checkbox-label">',
      '          <input type="checkbox" id="mufy-ixn-after-action">',
      '          <span>关闭</span>',
      '        </label>',
      '      </div>',
      '      <div class="mufy-ixn-status-row">',
      '        <span id="mufy-ixn-sync-status" class="mufy-ixn-sync-text"></span>',
      '      </div>',
      '      <div class="mufy-ixn-write-note">',
      '        交互草稿已暂存在本地工作台。<br>请复制对应字段后，手动打开 Mufy 的交互编辑窗粘贴并保存。',
      '      </div>',
      '      <div class="mufy-ixn-footer">',
      '        <button type="button" id="mufy-ixn-copy-current" class="secondary">复制正文</button>',
      '        <button type="button" id="mufy-ixn-copy-bundle">复制整个交互模块</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div id="mufy-wb-right-handle" class="wb-col-handle" title="拖拽调整右栏宽度"></div>',
      '  <div id="mufy-wb-right">',
      '    <div id="mufy-wb-right-normal">',
      '      <div class="wb-section-title">当前字段</div>',
      '      <div class="wb-info-row">',
      '        <span class="wb-info-key">Mufy 当前</span>',
      '        <span id="mufy-wb-orig-token" class="wb-info-val">—</span>',
      '      </div>',
      '      <div class="wb-info-row">',
      '        <span class="wb-info-key">草稿</span>',
      '        <span id="mufy-wb-draft-token" class="wb-info-val">—</span>',
      '      </div>',
      '      <div class="wb-info-row">',
      '        <span class="wb-info-key">变化</span>',
      '        <span id="mufy-wb-token-delta" class="wb-info-val">—</span>',
      '      </div>',
      '      <div class="wb-divider"></div>',
      '      <div class="wb-section-title">Mufy 原生 Token（5项）</div>',
      '      <div id="mufy-wb-tracked-list"></div>',
      '      <div class="wb-divider"></div>',
      '      <div class="wb-info-row wb-total-row">',
      '        <span class="wb-info-key">合计</span>',
      '        <span id="mufy-wb-total-token" class="wb-info-val">—</span>',
      '      </div>',
      '      <div id="mufy-wb-bar-wrap"><div id="mufy-wb-bar"></div></div>',
      '      <div id="mufy-wb-limit-label">/ ' + TOKEN_LIMIT + ' Token</div>',
      '      <div class="wb-divider"></div>',
      '      <div class="wb-library-note">⚠️ 若此卡包含资料库，请手动额外预留约 5000 Token；本计数不自动加入。</div>',
      '    </div>',
      '    <div id="mufy-wb-right-ixn" style="display:none">',
      '      <div class="wb-section-title">当前模块</div>',
      '      <div class="wb-info-row"><span class="wb-info-key">物品</span><span id="mufy-wb-ixn-item" class="wb-info-val wb-ixn-val-wrap">—</span></div>',
      '      <div class="wb-info-row"><span class="wb-info-key">交互</span><span id="mufy-wb-ixn-interaction" class="wb-info-val wb-ixn-val-wrap">—</span></div>',
      '      <div class="wb-divider"></div>',
      '      <div class="wb-section-title">本地草稿状态</div>',
      '      <div class="wb-info-row"><span id="mufy-wb-ixn-draft-status" class="wb-info-val">—</span></div>',
      '      <div class="wb-divider"></div>',
      '      <div class="wb-section-title">回填方式</div>',
      '      <div class="wb-ixn-guide">复制对应内容<br>→ 手动打开 Mufy 原生交互编辑窗<br>→ 粘贴并点击保存</div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(wbEl);

    /* 收起工作台（只隐藏，不清空草稿，不跳转路由） */
    wbEl.querySelector('#mufy-wb-return').addEventListener('click', function () {
      closeWorkbench();
    });

    /* 还原草稿至当前同步版本：draft → syncedContent 或 syncedData，不修改 Mufy 页面 */
    wbEl.querySelector('#mufy-wb-restore').addEventListener('click', function () {
      if (wbCurrentInteraction) {
        var ixnSnap = getCurrentIxnSnap();
        if (!ixnSnap) return;
        ixnSnap.draftData = cloneIxnData(ixnSnap.syncedData);
        ixnSnap.syncStatus = 'clean';
        showInteractionEditor();
        renderWbFieldList();
        toast('已将"' + (ixnSnap.syncedData.interactionName || ixnSnap.interactionKey) + '"还原至最近一次 Mufy 读取版本');
        return;
      }
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

    /* 回填到 Mufy 编辑页 */
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

    /* 交互表单事件 */
    wbEl.querySelector('#mufy-ixn-name').addEventListener('input', function () {
      var snap = getCurrentIxnSnap();
      if (!snap) return;
      snap.draftData.interactionName = this.value;
      markIxnDirty(snap);
    });

    wbEl.querySelector('#mufy-ixn-after-action').addEventListener('change', function () {
      var snap = getCurrentIxnSnap();
      if (!snap) return;
      snap.draftData.afterAction = this.checked;
      markIxnDirty(snap);
    });

    /* 大编辑器实时保存到 draftData */
    wbEl.querySelector('#mufy-ixn-main-editor').addEventListener('input', function () {
      var snap = getCurrentIxnSnap();
      if (!snap || !wbCurrentInteractionEditorTarget) return;
      var t = wbCurrentInteractionEditorTarget;
      if (t.kind === 'prompt') {
        snap.draftData.prompt = this.value;
      } else if (t.kind === 'afterCopywriting' && t.copywritingIndex != null) {
        snap.draftData.afterCopywriting[t.copywritingIndex] = this.value;
      }
      markIxnDirty(snap);
    });

    /* Tab 栏（事件代理）：切换 / 删除 / 新增文案 */
    wbEl.querySelector('#mufy-ixn-tab-bar').addEventListener('click', function (e) {
      var snap = getCurrentIxnSnap();
      if (!snap) return;

      /* 删除文案 */
      var delSpan = e.target.closest('.mufy-ixn-tab-del');
      if (delSpan) {
        var delIdx = parseInt(delSpan.dataset.delIndex, 10);
        snap.draftData.afterCopywriting.splice(delIdx, 1);
        markIxnDirty(snap);
        /* 决定切换到哪个 tab */
        var cur = wbCurrentInteractionEditorTarget;
        if (cur && cur.kind === 'afterCopywriting' && cur.copywritingIndex >= delIdx) {
          var next = cur.copywritingIndex - 1;
          if (snap.draftData.afterCopywriting.length === 0 || next < 0) {
            wbCurrentInteractionEditorTarget = { kind: 'prompt', copywritingIndex: null };
          } else {
            wbCurrentInteractionEditorTarget = { kind: 'afterCopywriting', copywritingIndex: Math.min(next, snap.draftData.afterCopywriting.length - 1) };
          }
        }
        renderIxnTabBar(snap);
        loadIxnMainEditor(snap);
        return;
      }

      /* 新增文案 */
      if (e.target.closest('.mufy-ixn-tab-add')) {
        flushIxnEditorToDraft(snap);
        snap.draftData.afterCopywriting.push('');
        markIxnDirty(snap);
        var newIdx = snap.draftData.afterCopywriting.length - 1;
        wbCurrentInteractionEditorTarget = { kind: 'afterCopywriting', copywritingIndex: newIdx };
        renderIxnTabBar(snap);
        loadIxnMainEditor(snap);
        wbEl.querySelector('#mufy-ixn-main-editor').focus();
        return;
      }

      /* 切换 tab */
      var tab = e.target.closest('.mufy-ixn-tab');
      if (tab) {
        flushIxnEditorToDraft(snap);
        var kind = tab.dataset.kind;
        var idx = kind === 'afterCopywriting' ? parseInt(tab.dataset.index, 10) : null;
        wbCurrentInteractionEditorTarget = { kind: kind, copywritingIndex: idx };
        renderIxnTabBar(snap);
        loadIxnMainEditor(snap);
        wbEl.querySelector('#mufy-ixn-main-editor').focus();
      }
    });

    /* 交互名称复制 */
    wbEl.querySelector('#mufy-ixn-copy-name').addEventListener('click', function () {
      var snap = getCurrentIxnSnap();
      if (!snap) return;
      copyRawDraftText(snap.draftData.interactionName || '', '已复制交互名称。');
    });

    /* 复制正文（按当前 tab） */
    wbEl.querySelector('#mufy-ixn-copy-current').addEventListener('click', function () {
      var snap = getCurrentIxnSnap();
      if (!snap) return;
      var text = getCurrentIxnEditorText(snap);
      var label = getCurrentIxnEditorLabel();
      copyRawDraftText(text, '已复制' + label + '，可粘贴到 Mufy 交互编辑窗对应输入框。');
    });

    /* 复制整个交互模块 */
    wbEl.querySelector('#mufy-ixn-copy-bundle').addEventListener('click', function () {
      var snap = getCurrentIxnSnap();
      if (!snap) return;
      var name = snap.draftData.interactionName || snap.interactionKey;
      copyRawDraftText(
        serializeInteractionDraft(snap),
        '已复制"' + name + '"整个交互模块，包含名称、提示词、文案与使用后操作。'
      );
    });

    /* 普通字段复制 */
    wbEl.querySelector('#mufy-wb-copy-field').addEventListener('click', function () {
      var snap = getCurrentWbSnap();
      if (!snap) { toast('请先选择一个字段'); return; }
      copyRawDraftText(snap.draftContent, '已复制"' + snap.label + '"的草稿。');
    });


    /* 专注编辑 */
    wbEl.querySelector('#mufy-wb-focus').addEventListener('click', function () {
      wbFocusMode = !wbFocusMode;
      wbEl.classList.toggle('mufy-wb-focus', wbFocusMode);
      this.textContent = wbFocusMode ? '↙ 退出专注编辑' : '⛶ 专注编辑';
    });

    /* 左栏搜索 */
    wbEl.querySelector('#mufy-wb-search').addEventListener('input', function () {
      wbSearchText = this.value;
      renderWbFieldList();
    });

    /* 帮助按钮 */
    wbEl.querySelector('#mufy-wb-help').addEventListener('click', function () {
      openGuideModal();
    });

    /* Aa 字体大小设置 */
    wbEl.querySelector('#mufy-wb-aa').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleAaPopover();
    });

    /* 普通字段编辑/预览切换 */
    wbEl.querySelector('#mufy-wb-mode-edit').addEventListener('click', function () {
      setNormalEditorMode('edit');
    });
    wbEl.querySelector('#mufy-wb-mode-preview').addEventListener('click', function () {
      setNormalEditorMode('preview');
    });

    /* 交互编辑/预览切换 */
    wbEl.querySelector('#mufy-ixn-mode-edit').addEventListener('click', function () {
      setIxnEditorMode('edit');
    });
    wbEl.querySelector('#mufy-ixn-mode-preview').addEventListener('click', function () {
      setIxnEditorMode('preview');
    });

    /* 左栏拖拽手柄 */
    (function () {
      var handle = wbEl.querySelector('#mufy-wb-left-handle');
      var startX = 0;
      var startW = 0;
      handle.addEventListener('pointerdown', function (e) {
        if (window.innerWidth < 960) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        startX = e.clientX;
        startW = uiPrefs.workbenchLeftWidth;
      });
      handle.addEventListener('pointermove', function (e) {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        var delta = e.clientX - startX;
        var newW = Math.min(440, Math.max(180, startW + delta));
        uiPrefs.workbenchLeftWidth = newW;
        applyWbColumnWidths();
      });
      handle.addEventListener('pointerup', function (e) {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        handle.releasePointerCapture(e.pointerId);
        saveUiPrefs();
      });
    })();

    /* 右栏拖拽手柄 */
    (function () {
      var handle = wbEl.querySelector('#mufy-wb-right-handle');
      var startX = 0;
      var startW = 0;
      handle.addEventListener('pointerdown', function (e) {
        if (window.innerWidth < 960) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        startX = e.clientX;
        startW = uiPrefs.workbenchRightWidth;
      });
      handle.addEventListener('pointermove', function (e) {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        var delta = startX - e.clientX;
        var newW = Math.min(380, Math.max(190, startW + delta));
        uiPrefs.workbenchRightWidth = newW;
        applyWbColumnWidths();
      });
      handle.addEventListener('pointerup', function (e) {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        handle.releasePointerCapture(e.pointerId);
        saveUiPrefs();
      });
    })();

    /* Esc：优先关闭帮助弹窗，其次退出专注模式，不关工作台 */
    wbEl.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (document.getElementById('mufy-guide-modal')) {
        event.stopPropagation();
        closeGuideModal();
        return;
      }
      if (wbFocusMode) {
        event.stopPropagation();
        wbFocusMode = false;
        wbEl.classList.remove('mufy-wb-focus');
        var btn = wbEl.querySelector('#mufy-wb-focus');
        if (btn) btn.textContent = '⛶ 专注编辑';
      }
    });
  }

  function openWorkbench() {
    var currentRoleId = getCurrentRoleId();

    if (wbSnapshot.length > 0) {
      if (hasActiveWorkbenchSession()) {
        wbEl.classList.add('open');
        wbEl.classList.toggle('mufy-wb-focus', wbFocusMode);
        var focusBtn = wbEl.querySelector('#mufy-wb-focus');
        if (focusBtn) focusBtn.textContent = wbFocusMode ? '↙ 退出专注编辑' : '⛶ 专注编辑';
        renderWbFieldList();
        applyWbColumnWidths();
        applyEditorFontSize();
        if (wbCurrentInteraction) {
          showInteractionEditor();
          updateWbWriteControls();
        } else {
          selectWbField(wbCurrentIndex >= 0 ? wbCurrentIndex : 0);
          updateWbWriteControls();
        }
        toast('已恢复本次工作台草稿');
        return;
      }

      if (hasDirtyWbDrafts()) {
        var confirmed = window.confirm('你正在切换到另一张角色卡。\n当前工作台存在未回填或与 Mufy 来源不一致的草稿，继续将丢弃这些内容。是否继续？');
        if (!confirmed) return;
      }

      clearWorkbenchSession();
      scanFields();
      renderList();
    }

    var enabled = getWorkbenchFields();
    if (!enabled.length) {
      toast('暂未扫描到可安全编辑的字段，请先扫描或完成字段重绑。');
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
    wbSessionRoleId = currentRoleId;
    wbCurrentIndex = -1;
    wbLastWriteUndo = null;
    wbWritePending = false;
    wbSearchText = '';
    var searchEl = wbEl.querySelector('#mufy-wb-search');
    if (searchEl) searchEl.value = '';
    renderWbFieldList();
    wbEl.classList.add('open');
    applyWbColumnWidths();
    applyEditorFontSize();
    selectWbField(0);
  }

  function hasDirtyWbDrafts() {
    if (wbSnapshot.some(function (snap) { return snap.draftContent !== snap.syncedContent; })) return true;
    return Object.keys(interactionSnapshotsByItemKey).some(function (ik) {
      var byItem = interactionSnapshotsByItemKey[ik];
      return Object.keys(byItem).some(function (k) {
        var s = byItem[k].syncStatus;
        return s === 'dirty' || s === 'sourceChanged';
      });
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

    var writeButton = wbEl.querySelector('#mufy-wb-write-btn');
    var undoButton = wbEl.querySelector('#mufy-wb-undo-write-btn');

    if (wbCurrentInteraction) {
      if (writeButton) { writeButton.disabled = true; writeButton.textContent = '回填到 Mufy 编辑页'; }
      if (undoButton) undoButton.disabled = true;
      return;
    }

    var snap = getCurrentWbSnap();

    if (writeButton) {
      writeButton.disabled = wbWritePending || !snap;
      writeButton.textContent = wbWritePending ? '正在回填…' : '回填到 Mufy 编辑页';
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
      undoButton.style.display = canUndo ? '' : 'none';
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
    setWbWriteStatus('warn', '正在回填到 Mufy 编辑页…');
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
        setWbWriteStatus('ok', '已回填到 Mufy 编辑页 · 请在 Mufy 点击”更新角色”保存');
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
    var editor = wbEl && wbEl.querySelector('#mufy-wb-editor');
    if (editor && !wbCurrentInteraction && wbCurrentIndex >= 0 && wbCurrentIndex < wbSnapshot.length) {
      wbSnapshot[wbCurrentIndex].draftContent = editor.value;
    }
    if (wbCurrentInteraction) flushInteractionFormToDraft();
    clearWbTokenTimer();
    wbEl.classList.remove('open');
  }

  /* ─── 安全 Markdown 渲染（纯 DOM，无 innerHTML，无外部资源） ─── */

  function renderSafeMarkdown(text, container) {
    container.textContent = '';
    var lines = asText(text).replace(/\r/g, '').split('\n');
    var i = 0;

    function appendEl(tag, text, parent) {
      var el = document.createElement(tag);
      if (text !== undefined) el.textContent = text;
      (parent || container).appendChild(el);
      return el;
    }

    function parseInline(raw, parent) {
      // bold, italic, strikethrough, inline code — use regex splits
      var re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g;
      var last = 0;
      var m;
      while ((m = re.exec(raw)) !== null) {
        if (m.index > last) {
          parent.appendChild(document.createTextNode(raw.slice(last, m.index)));
        }
        var tok = m[0];
        if (tok.startsWith('`') && tok.endsWith('`')) {
          var code = document.createElement('code');
          code.textContent = tok.slice(1, -1);
          parent.appendChild(code);
        } else if (tok.startsWith('**')) {
          var b = document.createElement('strong');
          b.textContent = tok.slice(2, -2);
          parent.appendChild(b);
        } else if (tok.startsWith('*')) {
          var em = document.createElement('em');
          em.textContent = tok.slice(1, -1);
          parent.appendChild(em);
        } else if (tok.startsWith('~~')) {
          var s = document.createElement('s');
          s.textContent = tok.slice(2, -2);
          parent.appendChild(s);
        }
        last = m.index + tok.length;
      }
      if (last < raw.length) parent.appendChild(document.createTextNode(raw.slice(last)));
    }

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code block
      if (line.startsWith('```')) {
        var pre = document.createElement('pre');
        var codeEl = document.createElement('code');
        pre.appendChild(codeEl);
        container.appendChild(pre);
        i += 1;
        var codeLines = [];
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i += 1;
        }
        codeEl.textContent = codeLines.join('\n');
        i += 1;
        continue;
      }

      // Heading
      var hMatch = line.match(/^(#{1,6})\s+(.*)/);
      if (hMatch) {
        var level = Math.min(hMatch[1].length, 6);
        var hEl = appendEl('h' + level);
        parseInline(hMatch[2], hEl);
        i += 1;
        continue;
      }

      // HR
      if (/^[-*_]{3,}\s*$/.test(line)) {
        appendEl('hr');
        i += 1;
        continue;
      }

      // Blockquote
      if (line.startsWith('> ') || line === '>') {
        var bq = document.createElement('blockquote');
        container.appendChild(bq);
        while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
          var bqP = document.createElement('p');
          parseInline(lines[i].replace(/^>\s?/, ''), bqP);
          bq.appendChild(bqP);
          i += 1;
        }
        continue;
      }

      // Unordered list
      if (/^[-*+]\s/.test(line)) {
        var ul = document.createElement('ul');
        container.appendChild(ul);
        while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
          var li = document.createElement('li');
          parseInline(lines[i].replace(/^[-*+]\s/, ''), li);
          ul.appendChild(li);
          i += 1;
        }
        continue;
      }

      // Ordered list
      if (/^\d+\.\s/.test(line)) {
        var ol = document.createElement('ol');
        container.appendChild(ol);
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          var oli = document.createElement('li');
          parseInline(lines[i].replace(/^\d+\.\s/, ''), oli);
          ol.appendChild(oli);
          i += 1;
        }
        continue;
      }

      // Empty line — paragraph break (skip)
      if (line.trim() === '') {
        i += 1;
        continue;
      }

      // Paragraph
      var p = document.createElement('p');
      parseInline(line, p);
      container.appendChild(p);
      i += 1;
    }
  }

  /* ─── 普通字段 编辑/预览 切换 ─── */

  function setNormalEditorMode(mode) {
    if (!wbEl) return;
    var editorEl = wbEl.querySelector('#mufy-wb-editor');
    var previewEl = wbEl.querySelector('#mufy-wb-preview');
    var editBtn = wbEl.querySelector('#mufy-wb-mode-edit');
    var prevBtn = wbEl.querySelector('#mufy-wb-mode-preview');
    if (!editorEl || !previewEl) return;
    if (mode === 'preview') {
      var snap = (wbCurrentIndex >= 0 && wbCurrentIndex < wbSnapshot.length) ? wbSnapshot[wbCurrentIndex] : null;
      renderSafeMarkdown(snap ? snap.draftContent : editorEl.value, previewEl);
      editorEl.style.display = 'none';
      previewEl.style.display = '';
      if (editBtn) editBtn.classList.remove('active');
      if (prevBtn) prevBtn.classList.add('active');
    } else {
      editorEl.style.display = '';
      previewEl.style.display = 'none';
      if (editBtn) editBtn.classList.add('active');
      if (prevBtn) prevBtn.classList.remove('active');
    }
  }

  /* ─── 交互编辑器 编辑/预览 切换 ─── */

  function setIxnEditorMode(mode) {
    if (!wbEl) return;
    var editorEl = wbEl.querySelector('#mufy-ixn-main-editor');
    var previewEl = wbEl.querySelector('#mufy-ixn-preview');
    var editBtn = wbEl.querySelector('#mufy-ixn-mode-edit');
    var prevBtn = wbEl.querySelector('#mufy-ixn-mode-preview');
    if (!editorEl || !previewEl) return;
    if (mode === 'preview') {
      renderSafeMarkdown(editorEl.value, previewEl);
      editorEl.style.display = 'none';
      previewEl.style.display = '';
      if (editBtn) editBtn.classList.remove('active');
      if (prevBtn) prevBtn.classList.add('active');
    } else {
      editorEl.style.display = '';
      previewEl.style.display = 'none';
      if (editBtn) editBtn.classList.add('active');
      if (prevBtn) prevBtn.classList.remove('active');
    }
  }

  /* ─── Aa 显示设置弹出层 ─── */

  function toggleAaPopover() {
    var pop = wbEl && wbEl.querySelector('#mufy-wb-aa-popover');
    if (!pop) return;
    if (pop.style.display !== 'none') {
      pop.style.display = 'none';
      return;
    }
    buildAaPopover(pop);
    pop.style.display = 'block';

    function outsideClick(e) {
      if (!pop.contains(e.target) && e.target.id !== 'mufy-wb-aa') {
        pop.style.display = 'none';
        document.removeEventListener('pointerdown', outsideClick, true);
      }
    }
    document.addEventListener('pointerdown', outsideClick, true);
  }

  function buildAaPopover(pop) {
    pop.textContent = '';

    var title = document.createElement('div');
    title.className = 'wb-aa-title';
    title.textContent = '显示设置';
    pop.appendChild(title);

    // Font size control
    var row = document.createElement('div');
    row.className = 'wb-aa-row';

    var label = document.createElement('span');
    label.className = 'wb-aa-label';
    label.textContent = '字体大小';
    row.appendChild(label);

    var dec = document.createElement('button');
    dec.className = 'wb-aa-btn';
    dec.textContent = '−';
    row.appendChild(dec);

    var sizeDisplay = document.createElement('span');
    sizeDisplay.className = 'wb-aa-size';
    sizeDisplay.textContent = uiPrefs.editorFontSize + 'px';
    row.appendChild(sizeDisplay);

    var inc = document.createElement('button');
    inc.className = 'wb-aa-btn';
    inc.textContent = '+';
    row.appendChild(inc);

    pop.appendChild(row);

    dec.addEventListener('click', function () {
      if (uiPrefs.editorFontSize <= 13) return;
      uiPrefs.editorFontSize -= 1;
      sizeDisplay.textContent = uiPrefs.editorFontSize + 'px';
      applyEditorFontSize();
      saveUiPrefs();
    });
    inc.addEventListener('click', function () {
      if (uiPrefs.editorFontSize >= 22) return;
      uiPrefs.editorFontSize += 1;
      sizeDisplay.textContent = uiPrefs.editorFontSize + 'px';
      applyEditorFontSize();
      saveUiPrefs();
    });

    var divider = document.createElement('div');
    divider.className = 'wb-aa-divider';
    pop.appendChild(divider);

    var resetLayout = document.createElement('button');
    resetLayout.className = 'wb-aa-reset';
    resetLayout.textContent = '重置栏宽';
    resetLayout.addEventListener('click', function () {
      uiPrefs.workbenchLeftWidth = 250;
      uiPrefs.workbenchRightWidth = 230;
      applyWbColumnWidths();
      saveUiPrefs();
      toast('栏宽已重置');
    });
    pop.appendChild(resetLayout);

    var resetPos = document.createElement('button');
    resetPos.className = 'wb-aa-reset';
    resetPos.textContent = '重置位置';
    resetPos.addEventListener('click', function () {
      uiPrefs.launcherPosition = null;
      uiPrefs.panelPosition = null;
      var toggle = document.getElementById('mufy-helper-toggle');
      if (toggle) { toggle.style.bottom = '24px'; toggle.style.right = '24px'; toggle.style.top = ''; toggle.style.left = ''; }
      if (panelEl) { panelEl.style.top = '80px'; panelEl.style.right = '24px'; panelEl.style.left = ''; }
      saveUiPrefs();
      toast('按钮和面板位置已重置');
    });
    pop.appendChild(resetPos);
  }

  /* ─── 帮助中心弹窗 ─── */

  function openGuideModal() {
    if (document.getElementById('mufy-guide-modal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'mufy-guide-modal';
    overlay.className = 'mufy-guide-overlay';

    var box = document.createElement('div');
    box.className = 'mufy-guide-box';

    var header = document.createElement('div');
    header.className = 'mufy-guide-header';
    var titleEl = document.createElement('span');
    titleEl.className = 'mufy-guide-title';
    titleEl.textContent = '白厨Mufy字段编辑器 — 帮助中心';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'mufy-guide-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeGuideModal);
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    box.appendChild(header);

    var tabBar = document.createElement('div');
    tabBar.className = 'mufy-guide-tab-bar';
    var tabs = [
      { id: 'usage', label: '使用说明' },
      { id: 'author', label: '作者的话' }
    ];
    var tabBtns = {};
    tabs.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.className = 'mufy-guide-tab';
      btn.textContent = tab.label;
      btn.addEventListener('click', function () { showGuideTab(tab.id); });
      tabBtns[tab.id] = btn;
      tabBar.appendChild(btn);
    });
    box.appendChild(tabBar);

    var content = document.createElement('div');
    content.className = 'mufy-guide-content';
    box.appendChild(content);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('pointerdown', function (e) {
      if (e.target === overlay) closeGuideModal();
    });
    document.addEventListener('keydown', function escGuide(e) {
      if (e.key === 'Escape') { closeGuideModal(); document.removeEventListener('keydown', escGuide, true); }
    }, true);

    function showGuideTab(id) {
      Object.keys(tabBtns).forEach(function (k) {
        tabBtns[k].classList.toggle('active', k === id);
      });
      content.textContent = '';
      if (id === 'usage') {
        renderSafeMarkdown([
          '## 快速开始',
          '',
          '1. 点击右下角悬浮按钮打开面板',
          '2. 点击**扫描 / 刷新**读取当前 Mufy 编辑页的所有字段',
          '3. 勾选要发给 AI 的普通字段或交互，点击**复制已选内容给 AI**，将内容发送给 AI 修改',
          '4. 把 AI 返回的文本自行复制，进入工作台，选择对应字段，直接粘贴到编辑区后检查、修改',
          '5. 点击**回填到 Mufy 编辑页**，再在 Mufy 点击"更新角色"保存',
          '',
          '插件不会自动判断或批量写入 AI 返回内容，最终内容始终由你确认。',
          '',
          '## 工作台功能',
          '',
          '- **左栏**：字段列表（含搜索），点击切换，拖拽分隔线调整宽度',
          '- **中区**：主编辑器，支持 [编辑] / [预览] 切换（安全 Markdown 预览）',
          '- **右栏**：Token 统计与草稿状态信息',
          '- **Aa**：调整字体大小（13–22px），重置栏宽与位置',
          '- **⛶ 专注编辑**：隐藏左右栏，聚焦中区',
          '- **Esc**：依次关闭：帮助弹窗 → 退出专注模式',
          '',
          '普通字段核心流程：编辑草稿 → **回填到 Mufy 编辑页** → 手动点击"更新角色"保存。',
          '',
          '## 物品与交互',
          '',
          '由于猫的代码设计，无法一键读取物品栏交互按钮提示词。物品栏的窗口和交互需要你手动用悬浮面板绑定。',
          '- 在mufy界面点开物品栏交互后，在悬浮窗对应物品名称下点集采集交互，即可自动录入数据进工作区进行编辑。',
          '- 交互草稿仅存储于本地工作台，需手动打开 Mufy 原生交互弹窗粘贴保存',
          '',
          '## 安全说明',
          '',
          '- 工具**不会**自动写回 Mufy 云端或触发"更新角色"',
          '- Markdown 预览不执行任何脚本，不加载外部资源',
          '- 草稿不跨页面刷新持久化'
        ].join('\n'), content);
      } else {
        renderSafeMarkdown([
          '## 作者的话',
          '',
          '本油猴插件为方便白u写卡而制作',
          '严禁二传二改，尊重个人劳动。',
          '',
          '希望大家都来爱白~',
          '',
          '— 一个不知名的白厨'
        ].join('\n'), content);
      }
    }

    showGuideTab('usage');
  }

  function closeGuideModal() {
    var modal = document.getElementById('mufy-guide-modal');
    if (modal) modal.remove();
  }

  function showNormalEditor() {
    if (!wbEl) return;
    // Reset to edit mode before showing
    var editorEl = wbEl.querySelector('#mufy-wb-editor');
    var previewEl = wbEl.querySelector('#mufy-wb-preview');
    var editorBar = wbEl.querySelector('#mufy-wb-editor-bar');
    if (editorEl) editorEl.style.display = '';
    if (previewEl) previewEl.style.display = 'none';
    if (editorBar) editorBar.style.display = '';
    var editBtn = wbEl.querySelector('#mufy-wb-mode-edit');
    var prevBtn = wbEl.querySelector('#mufy-wb-mode-preview');
    if (editBtn) editBtn.classList.add('active');
    if (prevBtn) prevBtn.classList.remove('active');

    wbEl.querySelector('#mufy-wb-action-bar').style.display = '';
    wbEl.querySelector('#mufy-wb-interaction-form').style.display = 'none';
    var rNormal = wbEl.querySelector('#mufy-wb-right-normal');
    var rIxn = wbEl.querySelector('#mufy-wb-right-ixn');
    if (rNormal) rNormal.style.display = '';
    if (rIxn) rIxn.style.display = 'none';
    var restoreBtn = wbEl.querySelector('#mufy-wb-restore');
    if (restoreBtn) restoreBtn.textContent = '还原当前字段草稿';
  }

  /* ─── 交互大编辑器辅助 ─── */

  function renderIxnTabBar(snap) {
    var bar = wbEl && wbEl.querySelector('#mufy-ixn-tab-bar');
    if (!bar) return;
    bar.innerHTML = '';
    var cur = wbCurrentInteractionEditorTarget;

    /* 提示词 tab */
    var pt = document.createElement('button');
    pt.type = 'button';
    pt.className = 'mufy-ixn-tab' + (cur && cur.kind === 'prompt' ? ' active' : '');
    pt.dataset.kind = 'prompt';
    pt.textContent = '提示词';
    bar.appendChild(pt);

    /* 文案 tabs */
    (snap.draftData.afterCopywriting || []).forEach(function (text, i) {
      var tb = document.createElement('button');
      tb.type = 'button';
      tb.className = 'mufy-ixn-tab' + (cur && cur.kind === 'afterCopywriting' && cur.copywritingIndex === i ? ' active' : '');
      tb.dataset.kind = 'afterCopywriting';
      tb.dataset.index = String(i);

      var lbl = document.createTextNode('文案 ' + (i + 1) + ' ');
      tb.appendChild(lbl);

      var x = document.createElement('span');
      x.className = 'mufy-ixn-tab-del';
      x.dataset.delIndex = String(i);
      x.textContent = '×';
      tb.appendChild(x);

      bar.appendChild(tb);
    });

    /* 新增文案按钮 */
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'mufy-ixn-tab-add';
    addBtn.textContent = '+ 增加文案';
    bar.appendChild(addBtn);
  }

  function loadIxnMainEditor(snap) {
    var editor = wbEl && wbEl.querySelector('#mufy-ixn-main-editor');
    if (!editor) return;
    var t = wbCurrentInteractionEditorTarget;
    if (!t) return;
    if (t.kind === 'prompt') {
      editor.value = snap.draftData.prompt || '';
      editor.placeholder = '提示词内容…';
    } else if (t.kind === 'afterCopywriting' && t.copywritingIndex != null) {
      editor.value = (snap.draftData.afterCopywriting || [])[t.copywritingIndex] || '';
      editor.placeholder = '文案 ' + (t.copywritingIndex + 1) + ' 内容…';
    }
  }

  function getCurrentIxnEditorText(snap) {
    var t = wbCurrentInteractionEditorTarget;
    if (!t) return snap.draftData.prompt || '';
    if (t.kind === 'prompt') return snap.draftData.prompt || '';
    if (t.kind === 'afterCopywriting' && t.copywritingIndex != null) {
      return (snap.draftData.afterCopywriting || [])[t.copywritingIndex] || '';
    }
    return '';
  }

  function getCurrentIxnEditorLabel() {
    var t = wbCurrentInteractionEditorTarget;
    if (!t || t.kind === 'prompt') return '"提示词"';
    if (t.kind === 'afterCopywriting' && t.copywritingIndex != null) {
      return '"文案 ' + (t.copywritingIndex + 1) + '"';
    }
    return '"提示词"';
  }

  function renderIxnCwList(arr, focusIndex) {
    if (!wbEl) return;
    var list = wbEl.querySelector('#mufy-ixn-cw-list');
    if (!list) return;
    list.innerHTML = '';
    arr.forEach(function (text, i) {
      var hdr = document.createElement('div');
      hdr.className = 'mufy-ixn-label-row';

      var lbl = document.createElement('span');
      lbl.className = 'mufy-ixn-label';
      lbl.textContent = '使用后文案 ' + (i + 1);

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'mufy-ixn-copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', function () {
        var snap = getCurrentIxnSnap();
        if (!snap) return;
        copyRawDraftText(snap.draftData.afterCopywriting[i] || '', '已复制使用后文案 ' + (i + 1) + '。');
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'mufy-ixn-cw-del';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        var snap = getCurrentIxnSnap();
        if (!snap) return;
        snap.draftData.afterCopywriting.splice(i, 1);
        markIxnDirty(snap);
        renderIxnCwList(snap.draftData.afterCopywriting);
      });

      hdr.appendChild(lbl);
      hdr.appendChild(copyBtn);
      hdr.appendChild(del);

      var row = document.createElement('div');
      row.className = 'mufy-ixn-cw-row';

      var ta = document.createElement('textarea');
      ta.className = 'mufy-ixn-cw-textarea';
      ta.value = text;
      ta.placeholder = '文案 ' + (i + 1);
      ta.addEventListener('input', function () {
        var snap = getCurrentIxnSnap();
        if (!snap) return;
        snap.draftData.afterCopywriting[i] = ta.value;
        markIxnDirty(snap);
      });
      row.appendChild(ta);
      list.appendChild(hdr);
      list.appendChild(row);

      if (focusIndex === i) ta.focus();
    });
  }

  function flushIxnEditorToDraft(snap) {
    if (!wbEl || !snap || !wbCurrentInteractionEditorTarget) return;
    var mainEditor = wbEl.querySelector('#mufy-ixn-main-editor');
    if (!mainEditor) return;
    var t = wbCurrentInteractionEditorTarget;
    if (t.kind === 'prompt') {
      snap.draftData.prompt = mainEditor.value;
    } else if (t.kind === 'afterCopywriting' && t.copywritingIndex != null) {
      snap.draftData.afterCopywriting[t.copywritingIndex] = mainEditor.value;
    }
  }

  function flushInteractionFormToDraft() {
    if (!wbEl || !wbCurrentInteraction) return;
    var snap = getCurrentIxnSnap();
    if (!snap) return;
    var nameEl = wbEl.querySelector('#mufy-ixn-name');
    var actionEl = wbEl.querySelector('#mufy-ixn-after-action');
    if (nameEl) snap.draftData.interactionName = nameEl.value;
    if (actionEl) snap.draftData.afterAction = actionEl.checked;
    flushIxnEditorToDraft(snap);
    if (snap.syncStatus === 'clean') {
      var isDirty = snap.draftData.interactionName !== snap.syncedData.interactionName ||
        snap.draftData.prompt !== snap.syncedData.prompt ||
        snap.draftData.afterAction !== snap.syncedData.afterAction;
      if (isDirty) snap.syncStatus = 'dirty';
    }
  }

  function showInteractionEditor() {
    if (!wbEl || !wbCurrentInteraction) return;
    var snap = getCurrentIxnSnap();
    if (!snap) return;
    var dd = snap.draftData;

    var editorEl = wbEl.querySelector('#mufy-wb-editor');
    var previewEl = wbEl.querySelector('#mufy-wb-preview');
    var editorBar = wbEl.querySelector('#mufy-wb-editor-bar');
    if (editorEl) editorEl.style.display = 'none';
    if (previewEl) previewEl.style.display = 'none';
    if (editorBar) editorBar.style.display = 'none';
    wbEl.querySelector('#mufy-wb-action-bar').style.display = 'none';
    var form = wbEl.querySelector('#mufy-wb-interaction-form');
    form.style.display = 'flex';
    // Reset ixn editor mode to 'edit'
    var ixnEditorEl = form.querySelector('#mufy-ixn-main-editor');
    var ixnPreviewEl = form.querySelector('#mufy-ixn-preview');
    var ixnEditBtn = form.querySelector('#mufy-ixn-mode-edit');
    var ixnPrevBtn = form.querySelector('#mufy-ixn-mode-preview');
    if (ixnEditorEl) ixnEditorEl.style.display = '';
    if (ixnPreviewEl) ixnPreviewEl.style.display = 'none';
    if (ixnEditBtn) ixnEditBtn.classList.add('active');
    if (ixnPrevBtn) ixnPrevBtn.classList.remove('active');

    var rNormal = wbEl.querySelector('#mufy-wb-right-normal');
    var rIxn = wbEl.querySelector('#mufy-wb-right-ixn');
    if (rNormal) rNormal.style.display = 'none';
    if (rIxn) rIxn.style.display = '';
    updateIxnRightPanel(snap);

    var restoreBtn = wbEl.querySelector('#mufy-wb-restore');
    if (restoreBtn) restoreBtn.textContent = '还原当前交互草稿';

    form.querySelector('#mufy-ixn-name').value = dd.interactionName || '';
    form.querySelector('#mufy-ixn-after-action').checked = !!dd.afterAction;
    /* 默认进入提示词 tab */
    if (!wbCurrentInteractionEditorTarget) {
      wbCurrentInteractionEditorTarget = { kind: 'prompt', copywritingIndex: null };
    }
    renderIxnTabBar(snap);
    loadIxnMainEditor(snap);

    var statusEl = form.querySelector('#mufy-ixn-sync-status');
    if (statusEl) statusEl.textContent = ixnSyncStatusText(snap.syncStatus);

    var title = wbEl.querySelector('#mufy-wb-title');
    if (title) title.textContent = '工作台 · 物品｜' + snap.itemName + ' · 交互｜' + (dd.interactionName || snap.interactionKey);

    var ctx = wbEl.querySelector('#mufy-item-context');
    if (ctx) { ctx.classList.remove('show'); ctx.innerHTML = ''; }
  }

  function selectWbInteraction(itemKey, interactionKey) {
    if (!wbEl) return;
    // Flush current state before switching
    if (wbCurrentInteraction) {
      flushInteractionFormToDraft();
    } else if (wbCurrentIndex >= 0 && wbCurrentIndex < wbSnapshot.length) {
      var editor = wbEl.querySelector('#mufy-wb-editor');
      if (editor) wbSnapshot[wbCurrentIndex].draftContent = editor.value;
    }

    wbCurrentInteraction = { itemKey: itemKey, interactionKey: interactionKey };
    wbCurrentInteractionEditorTarget = null;  // 重置至默认 tab（提示词）
    wbItemExpanded[itemKey] = true;

    renderWbFieldList();
    showInteractionEditor();
    updateWbWriteControls();
  }

  var WB_DOT_COLOR = {
    clean:  '#4a4a62',
    dirty:  '#fbbf24',
    synced: '#4ade80',
    failed: '#f87171',
    stale:  '#f87171'
  };

  var IXN_DOT_COLOR = {
    clean:         '#4a4a62',
    dirty:         '#fbbf24',
    sourceChanged: '#f97316'
  };

  function ixnSyncStatusText(status) {
    if (status === 'dirty') return '有草稿';
    if (status === 'sourceChanged') return 'Mufy 已变化';
    return '未修改';
  }

  function getCurrentIxnSnap() {
    if (!wbCurrentInteraction) return null;
    var byItem = interactionSnapshotsByItemKey[wbCurrentInteraction.itemKey];
    if (!byItem) return null;
    return byItem[wbCurrentInteraction.interactionKey] || null;
  }

  function updateIxnRightPanel(snap) {
    if (!wbEl) return;
    snap = snap || getCurrentIxnSnap();
    if (!snap) return;
    var itemEl = wbEl.querySelector('#mufy-wb-ixn-item');
    var ixnEl = wbEl.querySelector('#mufy-wb-ixn-interaction');
    var statusEl2 = wbEl.querySelector('#mufy-wb-ixn-draft-status');
    if (itemEl) itemEl.textContent = snap.itemName || '—';
    if (ixnEl) ixnEl.textContent = snap.draftData.interactionName || snap.interactionKey;
    if (statusEl2) statusEl2.textContent = ixnSyncStatusText(snap.syncStatus);
  }

  function markIxnDirty(snap) {
    if (snap.syncStatus !== 'sourceChanged') snap.syncStatus = 'dirty';
    renderWbFieldList();
    var statusEl = wbEl && wbEl.querySelector('#mufy-ixn-sync-status');
    if (statusEl) statusEl.textContent = ixnSyncStatusText(snap.syncStatus);
    updateIxnRightPanel(snap);
  }

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

  function renderItemWorkbenchInteractionChild(snap) {
    var item = document.createElement('div');
    var isActive = !!(wbCurrentInteraction &&
      wbCurrentInteraction.itemKey === snap.itemKey &&
      wbCurrentInteraction.interactionKey === snap.interactionKey);
    item.className = 'mufy-item-wb-child mufy-item-wb-ixn-child' + (isActive ? ' active' : '');

    var dot = document.createElement('span');
    dot.className = 'mufy-wb-dot';
    dot.style.background = IXN_DOT_COLOR[snap.syncStatus] || '#4a4a62';

    var dd = snap.draftData || {};
    var label = document.createElement('span');
    label.textContent = dd.interactionName || snap.interactionKey || '（未命名）';
    label.title = snap.interactionKey;
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace = 'nowrap';
    label.style.flex = '1';

    var badge = document.createElement('span');
    badge.className = 'mufy-ixn-sync-badge mufy-ixn-sync-' + snap.syncStatus;
    badge.textContent = ixnSyncStatusText(snap.syncStatus);

    item.appendChild(dot);
    item.appendChild(label);
    if (snap.syncStatus !== 'clean') item.appendChild(badge);
    item.addEventListener('click', function () {
      selectWbInteraction(snap.itemKey, snap.interactionKey);
    });

    return item;
  }

  function renderItemWorkbenchCard(entity, forceExpand) {
    var card = document.createElement('div');
    card.className = 'mufy-item-wb-card';

    var ixnMap = interactionSnapshotsByItemKey[entity.itemKey] || {};
    var ixnList = Object.keys(ixnMap).map(function (k) { return ixnMap[k]; });
    var ixnCount = ixnList.length;

    var hasActiveIxn = !!(wbCurrentInteraction && wbCurrentInteraction.itemKey === entity.itemKey);
    var expanded = !!forceExpand || !!wbItemExpanded[entity.itemKey] ||
      entity.recordIndexes.indexOf(wbCurrentIndex) >= 0 ||
      hasActiveIxn;

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
    var summaryParts = [entity.records.length + ' 项'];
    if (ixnCount) summaryParts.push('交互 ' + ixnCount);
    summaryParts.push(itemStatusText(status));
    summary.textContent = summaryParts.join(' · ');

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

      if (ixnCount) {
        var basicHdr = document.createElement('div');
        basicHdr.className = 'mufy-item-wb-subheader';
        basicHdr.textContent = '基础信息';
        children.appendChild(basicHdr);
      }

      entity.records.forEach(function (snap, pos) {
        children.appendChild(renderItemWorkbenchChild(snap, entity.recordIndexes[pos]));
      });

      if (ixnCount) {
        var ixnHdr = document.createElement('div');
        ixnHdr.className = 'mufy-item-wb-subheader';
        ixnHdr.textContent = '已采集交互 · ' + ixnCount;
        children.appendChild(ixnHdr);

        ixnList.forEach(function (snap) {
          children.appendChild(renderItemWorkbenchInteractionChild(snap));
        });
      }

      card.appendChild(children);
    }

    return card;
  }

  function renderWbFieldList() {
    var fieldListEl = wbEl.querySelector('#mufy-wb-field-list');
    fieldListEl.innerHTML = '';

    var query = wbSearchText.trim().toLowerCase();

    var entities = buildWorkbenchItemEntities();
    var entityByStart = {};
    var skip = {};

    entities.forEach(function (entity) {
      entityByStart[entity.recordIndexes[0]] = entity;
      entity.recordIndexes.slice(1).forEach(function (index) { skip[index] = true; });
    });

    var itemSectionAdded = false;
    var anyResult = false;

    wbSnapshot.forEach(function (snap, index) {
      var field = findFieldById(snap.fieldId);

      if (!isItemField(field)) {
        if (query && snap.label.toLowerCase().indexOf(query) === -1) return;
        anyResult = true;
        fieldListEl.appendChild(renderWorkbenchNormalField(snap, index));
        return;
      }

      if (skip[index]) return;

      var entity = entityByStart[index];
      if (!entity) return;

      var forceExpand = false;
      if (query) {
        var entityMatches = entity.itemName.toLowerCase().indexOf(query) !== -1;
        if (entity.records.some(function (r) {
          return r.label.toLowerCase().indexOf(query) !== -1;
        })) { entityMatches = true; forceExpand = true; }
        var ixnMap = interactionSnapshotsByItemKey[entity.itemKey] || {};
        Object.keys(ixnMap).forEach(function (k) {
          var ixnName = (ixnMap[k].draftData && ixnMap[k].draftData.interactionName) || k;
          if (ixnName.toLowerCase().indexOf(query) !== -1) { entityMatches = true; forceExpand = true; }
        });
        if (!entityMatches) return;
      }

      anyResult = true;

      if (!itemSectionAdded) {
        var section = document.createElement('div');
        section.className = 'mufy-item-wb-section';
        section.textContent = '物品栏 · ' + entities.length + ' 件物品';
        fieldListEl.appendChild(section);
        itemSectionAdded = true;
      }

      fieldListEl.appendChild(renderItemWorkbenchCard(entity, forceExpand));
    });

    if (query && !anyResult) {
      var noResult = document.createElement('div');
      noResult.className = 'mufy-wb-no-result';
      noResult.textContent = '没有匹配的字段或模块';
      fieldListEl.appendChild(noResult);
    }
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

    var nameSpan = document.createElement('span');
    nameSpan.className = 'mufy-ctx-item-name';
    nameSpan.textContent = '物品｜' + itemNameFromGroup(field.group, field.label);
    nameSpan.title = field.group;

    var tabsDiv = document.createElement('div');
    tabsDiv.className = 'mufy-ctx-tabs';
    entries.forEach(function (entry) {
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mufy-item-context-tab' + (entry.index === wbCurrentIndex ? ' active' : '');
      tab.textContent = entry.field.role || entry.snap.label.replace(/^物品｜[^｜]+｜/, '字段');
      tab.title = entry.snap.label;
      tab.addEventListener('click', function () { selectWbField(entry.index); });
      tabsDiv.appendChild(tab);
    });

    var moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'mufy-ctx-more-btn';
    moreBtn.textContent = '···';
    moreBtn.title = '物品模块操作';
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var existingMenu = document.getElementById('mufy-ctx-dropdown');
      if (existingMenu) { existingMenu.remove(); return; }

      var rect = moreBtn.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.id = 'mufy-ctx-dropdown';
      menu.className = 'mufy-ctx-dropdown';
      menu.style.top = rect.bottom + 4 + 'px';
      menu.style.right = window.innerWidth - rect.right + 'px';

      var copyModuleItem = document.createElement('button');
      copyModuleItem.type = 'button';
      copyModuleItem.className = 'mufy-ctx-dropdown-item';
      copyModuleItem.textContent = '复制整个物品模块';
      copyModuleItem.addEventListener('click', function () {
        menu.remove();
        document.removeEventListener('click', outsideClose, true);
        document.removeEventListener('keydown', escClose);
        var text = serializeItemDraftBundle(field.group);
        if (!text) { toast('当前物品没有可复制的草稿'); return; }
        copyRawDraftText(text, '已复制"' + itemNameFromGroup(field.group, field.label) + '"整个物品模块。');
      });
      menu.appendChild(copyModuleItem);
      document.body.appendChild(menu);

      function outsideClose(ev) {
        if (!menu.contains(ev.target) && ev.target !== moreBtn) {
          menu.remove();
          document.removeEventListener('click', outsideClose, true);
          document.removeEventListener('keydown', escClose);
        }
      }
      function escClose(ev) {
        if (ev.key === 'Escape') {
          menu.remove();
          document.removeEventListener('click', outsideClose, true);
          document.removeEventListener('keydown', escClose);
        }
      }
      setTimeout(function () {
        document.addEventListener('click', outsideClose, true);
        document.addEventListener('keydown', escClose);
      }, 0);
    });

    context.innerHTML = '';
    context.appendChild(nameSpan);
    context.appendChild(tabsDiv);
    context.appendChild(moreBtn);
    context.classList.add('show');
  }

  function selectWbField(index) {
    if (index < 0 || index >= wbSnapshot.length) return;

    clearWbTokenTimer();
    var editor = wbEl.querySelector('#mufy-wb-editor');

    // 切换前保存当前状态
    if (wbCurrentInteraction) {
      flushInteractionFormToDraft();
      wbCurrentInteraction = null;
    } else if (wbCurrentIndex >= 0 && wbCurrentIndex < wbSnapshot.length) {
      wbSnapshot[wbCurrentIndex].draftContent = editor.value;
    }

    showNormalEditor();
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
      wbEl.querySelector('#mufy-wb-title').textContent = '工作台 · 物品｜' + itemName + ' · ' + role;
    } else {
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
      '#mufy-helper-toggle{position:fixed;bottom:24px;right:24px;width:48px;height:48px;border-radius:50%;background:#8b5cf6;color:#fff;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483000;box-shadow:0 4px 14px rgba(0,0,0,.4);user-select:none;pointer-events:auto}',
      '#mufy-helper-panel{position:fixed;top:80px;right:24px;width:430px;max-height:78vh;background:#1b1b22;border:1px solid #3a3a46;border-radius:12px;z-index:2147483000;display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6e6ef;font-size:13px;box-shadow:0 8px 28px rgba(0,0,0,.5);overflow:hidden;pointer-events:auto}',
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
      '.mufy-export-hint{padding:3px 10px 4px;font-size:11px;color:#4a4a62;line-height:1.5}',
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
      '#mufy-workbench{position:fixed;inset:0;background:#13131a;z-index:2147483100;display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6e6ef;font-size:13px;pointer-events:auto}',
      '#mufy-workbench.open{display:flex}',

      '#mufy-wb-topbar{position:relative;height:50px;min-height:50px;background:#1a1a28;border-bottom:1px solid #2a2a3e;display:flex;align-items:center;gap:8px;padding:0 16px;flex-shrink:0}',
      '#mufy-wb-topbar button{background:#8b5cf6;border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',
      '#mufy-wb-topbar button.secondary{background:#2e2e44}',
      '#mufy-wb-topbar button:hover{filter:brightness(1.15)}',
      '.wb-title{margin-left:auto;font-size:12px;color:#5a5a7a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}',

      '#mufy-wb-body{flex:1;display:flex;overflow:hidden}',

      '#mufy-wb-left{width:var(--wb-left-width,250px);min-width:var(--wb-left-width,250px);border-right:1px solid #222236;overflow-y:auto;background:#161622;flex-shrink:0;display:flex;flex-direction:column}',
      '#mufy-wb-search{width:100%;box-sizing:border-box;background:#1b1b28;color:#e6e6ef;border:none;border-bottom:1px solid #222236;padding:9px 12px;font-size:12px;font-family:inherit;outline:none;flex-shrink:0}',
      '#mufy-wb-search::placeholder{color:#4a4a62}',
      '#mufy-wb-field-list{flex:1;overflow-y:auto}',
      '.mufy-wb-no-result{padding:20px 12px;font-size:12px;color:#4a4a62;text-align:center}',
      '.mufy-wb-field-item{padding:9px 12px;cursor:pointer;border-bottom:1px solid #1c1c2e;font-size:13px;color:#b0b0cc;transition:background .12s;display:flex;align-items:center;gap:8px;overflow:hidden}',
      '.mufy-wb-field-item:hover{background:#1e1e32}',
      '.mufy-wb-field-item.active{background:#28194a;color:#c4b5fd;border-left:3px solid #8b5cf6;padding-left:9px}',
      '.mufy-wb-dot{width:7px;height:7px;min-width:7px;border-radius:50%;display:inline-block}',

      '#mufy-wb-center{flex:1;display:flex;flex-direction:column;padding:12px 16px 12px;gap:8px;overflow:hidden}',
      '#mufy-wb-editor{flex:1;width:100%;background:#1b1b28;color:#e6e6ef;border:1px solid #333350;border-radius:8px;padding:14px;font-size:var(--wb-editor-font-size,15px);line-height:1.85;resize:none;box-sizing:border-box;font-family:inherit;outline:none}',
      '#mufy-wb-editor:focus{border-color:#8b5cf6}',
      '#mufy-wb-action-bar{display:flex;align-items:center;gap:8px;flex-shrink:0}',
      '#mufy-wb-write-btn{background:#059669;border:none;color:#fff;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',
      '#mufy-wb-write-btn:hover{filter:brightness(1.12)}',
      '#mufy-wb-write-btn:disabled{cursor:not-allowed;opacity:.45;filter:none}',
      '#mufy-wb-undo-write-btn{background:#34344a;border:none;color:#e6e6ef;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}',
      '#mufy-wb-copy-field{margin-left:auto}',
      '#mufy-wb-write-status{font-size:12px;color:#9a9aae}',
      '#mufy-wb-write-status.ok{color:#4ade80}',
      '#mufy-wb-write-status.err{color:#f87171}',
      '#mufy-wb-write-status.warn{color:#fbbf24}',

      '#mufy-wb-right{width:var(--wb-right-width,230px);min-width:var(--wb-right-width,230px);border-left:1px solid #222236;padding:14px 12px;overflow-y:auto;background:#161622;flex-shrink:0;display:flex;flex-direction:column;gap:8px;font-size:12px}',
      '#mufy-wb-right-normal,#mufy-wb-right-ixn{display:flex;flex-direction:column;gap:8px}',
      '.wb-ixn-val-wrap{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wb-ixn-guide{font-size:11px;color:#7b769a;line-height:1.8}',
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
      '#mufy-item-context{display:none;align-items:center;gap:8px;height:40px;padding:0 10px;border-bottom:1px solid #222236;background:#181826;flex-shrink:0;overflow:hidden}',
      '#mufy-item-context.show{display:flex}',
      '.mufy-ctx-item-name{font-size:12px;color:#9e96d5;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;flex-shrink:0}',
      '.mufy-ctx-tabs{display:flex;gap:4px;flex-shrink:0}',
      '.mufy-ctx-more-btn{margin-left:auto;background:transparent;border:none;color:#5a5a7a;font-size:16px;cursor:pointer;padding:0 6px;letter-spacing:2px;line-height:1;flex-shrink:0}',
      '.mufy-ctx-more-btn:hover{color:#a78bfa}',
      '.mufy-ctx-dropdown{position:fixed;z-index:2147483200;background:#1e1c2e;border:1px solid #3a3a58;border-radius:6px;padding:4px;min-width:160px;box-shadow:0 4px 14px rgba(0,0,0,.6)}',
      '.mufy-ctx-dropdown-item{display:block;width:100%;background:transparent;border:none;color:#e6e6ef;padding:8px 12px;font-size:12px;cursor:pointer;text-align:left;border-radius:4px;white-space:nowrap}',
      '.mufy-ctx-dropdown-item:hover{background:#2d2b45;color:#d9d3ff}',
      '.mufy-item-context-tab{background:#272540!important;color:#bdb6df!important;border:none;border-radius:5px;padding:3px 9px!important;font-size:12px!important;cursor:pointer}',
      '.mufy-item-context-tab.active{background:#5a35ab!important;color:#fff!important}',
      '.mufy-item-interaction-section{border-top:1px solid #2d2a40;padding:6px 9px 4px}',
      '.mufy-item-interaction-header{display:flex;align-items:center;gap:7px;margin-bottom:4px}',
      '.mufy-item-interaction-label{flex:1;font-size:11px;color:#9e96d5}',
      '.mufy-item-interaction-row{padding:4px 0 2px;border-top:1px solid #26233a}',
      '.mufy-interaction-row-head{display:flex;align-items:center;gap:6px}',
      '.mufy-interaction-name{font-size:11px;color:#cbc6e7;margin-right:6px}',
      '.mufy-interaction-state-observed{font-size:10px;color:#fbbf24}',
      '.mufy-interaction-state-saved{font-size:10px;color:#4ade80}',
      '.mufy-interaction-detail{padding:3px 0 2px 10px}',
      '.mufy-interaction-field{font-size:10px;color:#8a85a4;line-height:1.6}',
      '.mufy-clear-interaction-btn{color:#f87171!important}',
      '#mufy-interaction-hud{position:fixed;bottom:72px;right:18px;z-index:9999;background:#1e1a2e;border:1px solid #6d4bc2;border-radius:8px;padding:10px 14px;min-width:200px;max-width:260px;box-shadow:0 4px 16px rgba(0,0,0,.55);font-size:12px;color:#cbc6e7;display:none;pointer-events:auto}',
      '.mufy-hud-title{font-weight:600;margin-bottom:4px;color:#a78bfa}',
      '.mufy-hud-status{color:#9e96d5;margin-bottom:8px;font-size:11px;min-height:14px}',
      '#mufy-hud-end-btn{width:100%;padding:4px 0;border-radius:5px;background:#6d4bc2;color:#fff;border:none;cursor:pointer;font-size:12px}',

      /* ── 工作台交互子项 ── */
      '.mufy-item-wb-subheader{padding:5px 12px 3px;font-size:10px;color:#6b6880;text-transform:uppercase;letter-spacing:.05em;background:#131320;border-top:1px solid #1e1c2e}',
      '.mufy-item-wb-ixn-child{padding-left:24px!important}',

      /* ── 交互同步状态 badge ── */
      '.mufy-ixn-sync-badge{font-size:9px;padding:1px 5px;border-radius:999px;white-space:nowrap;margin-left:auto;flex-shrink:0}',
      '.mufy-ixn-sync-dirty{background:#4a3a00;color:#fbbf24}',
      '.mufy-ixn-sync-sourceChanged{background:#4a2500;color:#f97316}',

      /* ── 交互编辑表单 ── */
      '#mufy-wb-interaction-form{display:none;flex-direction:column;gap:8px;flex:1;min-height:0;overflow:hidden;padding:12px 14px;background:#13131a}',
      '.mufy-ixn-name-row{display:flex;align-items:center;gap:8px;flex-shrink:0}',
      '.mufy-ixn-name-row .mufy-ixn-label{white-space:nowrap;flex-shrink:0}',
      '.mufy-ixn-name-row .mufy-ixn-input{flex:1;min-width:0}',
      '.mufy-ixn-field-group{display:flex;flex-direction:column;gap:4px;flex-shrink:0}',
      '.mufy-ixn-label{font-size:11px;color:#7b769a;font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
      '.mufy-ixn-input{background:#1b1b28;color:#e6e6ef;border:1px solid #333350;border-radius:6px;padding:7px 10px;font-size:13px;font-family:inherit;outline:none}',
      '.mufy-ixn-input:focus{border-color:#8b5cf6}',
      /* Tab 栏 */
      '#mufy-ixn-tab-bar{display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0;padding-bottom:2px}',
      '.mufy-ixn-tab{background:#272540;border:none;color:#9e96d5;border-radius:6px;padding:5px 11px;font-size:12px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:5px}',
      '.mufy-ixn-tab.active{background:#5a35ab;color:#fff}',
      '.mufy-ixn-tab:hover:not(.active){background:#333254;color:#d9d3ff}',
      '.mufy-ixn-tab-del{font-size:13px;line-height:1;opacity:.7;padding:0 1px}',
      '.mufy-ixn-tab-del:hover{opacity:1;color:#fca5a5}',
      '.mufy-ixn-tab-add{background:#1e1c2e;border:1px dashed #3d3a58;color:#7b769a;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.mufy-ixn-tab-add:hover{border-color:#8b5cf6;color:#c4b5fd}',
      /* 大主编辑器 */
      '#mufy-ixn-main-editor{flex:1;min-height:0;width:100%;box-sizing:border-box;background:#1b1b28;color:#e6e6ef;border:1px solid #333350;border-radius:6px;padding:10px 12px;font-size:var(--wb-editor-font-size,15px);line-height:1.75;resize:none;font-family:inherit;outline:none}',
      '#mufy-ixn-main-editor:focus{border-color:#8b5cf6}',
      '.mufy-ixn-action-row{flex-direction:row;align-items:center;gap:12px;flex-shrink:0}',
      '.mufy-ixn-checkbox-label{display:flex;align-items:center;gap:6px;cursor:pointer;color:#cbc6e7;font-size:13px}',
      '.mufy-ixn-status-row{display:flex;align-items:center;gap:8px;flex-shrink:0}',
      '.mufy-ixn-sync-text{font-size:11px;color:#8f8aac}',
      '.mufy-ixn-write-note{font-size:11px;color:#7c6a2e;background:#2a2010;border:1px solid #4a3a10;border-radius:6px;padding:7px 9px;line-height:1.5;flex-shrink:0}',

      /* ── 专注编辑模式 ── */
      '#mufy-workbench.mufy-wb-focus #mufy-wb-left{display:none!important}',
      '#mufy-workbench.mufy-wb-focus #mufy-wb-right{display:none!important}',
      '#mufy-workbench.mufy-wb-focus #mufy-wb-center{flex:1;max-width:100%;padding:0 24px}',


      /* ── 交互字段标签行（label + 复制按钮） ── */
      '.mufy-ixn-label-row{display:flex;align-items:center;justify-content:space-between;gap:6px}',
      '.mufy-ixn-copy-btn{background:#29263e!important;color:#9b96c8!important;border:none!important;border-radius:5px!important;padding:2px 8px!important;font-size:11px!important;cursor:pointer!important;white-space:nowrap;line-height:1.5}',
      '.mufy-ixn-copy-btn:hover{background:#353254!important;color:#d9d3ff!important}',

      /* ── 交互表单页脚 ── */
      '.mufy-ixn-footer{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap}',
      '.mufy-ixn-footer button{flex:1;min-width:120px}',

      /* ── 面板标题与帮助按钮 ── */
      '.mufy-panel-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mufy-panel-help-btn{background:transparent;border:1px solid #4a4a62;color:#9a9aae;border-radius:50%;width:20px;height:20px;font-size:12px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.mufy-panel-help-btn:hover{border-color:#8b5cf6;color:#c4b5fd}',

      /* ── 工作台顶栏图标按钮 ── */
      '.wb-icon-btn{padding:4px 10px!important;font-size:12px!important;font-weight:600}',

      /* ── 列调宽手柄 ── */
      '.wb-col-handle{width:6px;min-width:6px;cursor:col-resize;background:transparent;flex-shrink:0;transition:background .15s;z-index:1}',
      '.wb-col-handle:hover{background:#333350}',
      '#mufy-workbench.mufy-wb-focus .wb-col-handle{display:none!important}',
      '@media (max-width:959px){.wb-col-handle{display:none!important}}',

      /* ── 编辑/预览切换条 ── */
      '.wb-editor-mode-bar{display:flex;gap:4px;flex-shrink:0}',
      '.wb-mode-btn{background:#272540;border:none;color:#9e96d5;border-radius:5px;padding:4px 12px;font-size:12px;cursor:pointer}',
      '.wb-mode-btn.active{background:#5a35ab;color:#fff}',
      '.wb-mode-btn:hover:not(.active){background:#333254;color:#d9d3ff}',

      /* ── Markdown 预览面板 ── */
      '.wb-preview-pane{flex:1;min-height:0;overflow-y:auto;padding:14px;background:#1b1b28;border:1px solid #333350;border-radius:8px;box-sizing:border-box;color:#e6e6ef;font-size:var(--wb-editor-font-size,15px);line-height:1.85}',
      '.wb-preview-pane p{margin:0 0 8px}',
      '.wb-preview-pane h1,.wb-preview-pane h2,.wb-preview-pane h3,.wb-preview-pane h4{margin:10px 0 4px;color:#c4b5fd}',
      '.wb-preview-pane code{background:#252240;padding:1px 5px;border-radius:3px;font-size:.9em;color:#e9d5ff}',
      '.wb-preview-pane pre{background:#1a1a30;border-radius:6px;padding:10px 12px;overflow-x:auto;margin:6px 0}',
      '.wb-preview-pane pre code{background:none;padding:0}',
      '.wb-preview-pane blockquote{border-left:3px solid #5a35ab;margin:6px 0;padding:4px 12px;color:#9e96d5}',
      '.wb-preview-pane ul,.wb-preview-pane ol{margin:4px 0 8px 18px;padding:0}',
      '.wb-preview-pane hr{border:none;border-top:1px solid #333350;margin:10px 0}',
      '.wb-preview-pane s{color:#6b6b8a}',
      '.wb-preview-pane strong{color:#e0d7ff}',

      /* ── Aa 弹出层 ── */
      '.wb-aa-popover{position:absolute;top:calc(100% + 6px);right:0;background:#1e1c2e;border:1px solid #3a3a58;border-radius:8px;padding:10px 12px;min-width:200px;box-shadow:0 4px 16px rgba(0,0,0,.6);z-index:2147483200}',
      '.wb-aa-title{font-size:11px;color:#7b769a;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
      '.wb-aa-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.wb-aa-label{flex:1;font-size:12px;color:#cbc6e7}',
      '.wb-aa-btn{background:#34344a;border:none;color:#e6e6ef;border-radius:4px;width:24px;height:24px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center}',
      '.wb-aa-btn:hover{background:#4a4a6a}',
      '.wb-aa-size{font-size:13px;color:#c4b5fd;min-width:38px;text-align:center}',
      '.wb-aa-divider{height:1px;background:#2e2c40;margin:8px 0}',
      '.wb-aa-reset{width:100%;background:#29263e;border:none;color:#9b96c8;border-radius:5px;padding:6px 0;font-size:12px;cursor:pointer;margin-bottom:4px;text-align:center}',
      '.wb-aa-reset:hover{background:#353254;color:#d9d3ff}',

      /* ── 帮助中心弹窗 ── */
      '.mufy-guide-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483500;display:flex;align-items:center;justify-content:center;pointer-events:auto}',
      '.mufy-guide-box{background:#1b1b28;border:1px solid #3a3a58;border-radius:12px;width:640px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.7)}',
      '.mufy-guide-header{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#26263a;border-bottom:1px solid #333350;flex-shrink:0}',
      '.mufy-guide-title{flex:1;font-weight:600;font-size:14px;color:#e6e6ef;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mufy-guide-close{background:transparent;border:none;color:#9a9aae;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:4px}',
      '.mufy-guide-close:hover{color:#e6e6ef;background:#333350}',
      '.mufy-guide-tab-bar{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid #222236;flex-shrink:0}',
      '.mufy-guide-tab{background:#272540;border:none;color:#9e96d5;border-radius:6px;padding:5px 14px;font-size:13px;cursor:pointer}',
      '.mufy-guide-tab.active{background:#5a35ab;color:#fff}',
      '.mufy-guide-tab:hover:not(.active){background:#333254;color:#d9d3ff}',
      '.mufy-guide-content{flex:1;overflow-y:auto;padding:16px 20px;font-size:13px;line-height:1.9;color:#cbc6e7}',
      '.mufy-guide-content p{margin:0 0 8px}',
      '.mufy-guide-content h2{font-size:14px;color:#c4b5fd;margin:12px 0 6px}',
      '.mufy-guide-content h3{font-size:13px;color:#c4b5fd;margin:10px 0 4px}',
      '.mufy-guide-content strong{color:#e0d7ff}',
      '.mufy-guide-content code{background:#252240;padding:1px 5px;border-radius:3px;font-size:.9em;color:#e9d5ff}',
      '.mufy-guide-content ul,.mufy-guide-content ol{margin:4px 0 8px 18px}',
      '.mufy-guide-content hr{border:none;border-top:1px solid #333350;margin:10px 0}'
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
      renderList();
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

  function getItemInteractionExportSelection(snapList) {
    var enabled = snapList.filter(function (snap) {
      return snap.exportEnabled === true;
    }).length;

    return {
      all: snapList.length > 0 && enabled === snapList.length,
      mixed: enabled > 0 && enabled < snapList.length
    };
  }

  function renderInteractionSection(entity) {
    var snaps = interactionSnapshotsByItemKey[entity.itemKey] || {};
    var snapList = Object.keys(snaps).map(function (k) { return snaps[k]; });
    var count = snapList.length;
    var exportSelection = getItemInteractionExportSelection(snapList);

    var section = document.createElement('div');
    section.className = 'mufy-item-interaction-section';

    var header = document.createElement('div');
    header.className = 'mufy-item-interaction-header';

    var exportToggle = document.createElement('input');
    exportToggle.type = 'checkbox';
    exportToggle.checked = exportSelection.all;
    exportToggle.indeterminate = exportSelection.mixed;
    exportToggle.disabled = count === 0;
    exportToggle.title = '勾选或取消勾选该物品下全部已采集交互的导出状态';
    exportToggle.addEventListener('change', function () {
      snapList.forEach(function (snap) {
        snap.exportEnabled = exportToggle.checked;
      });
      renderList();
    });

    var label = document.createElement('span');
    label.className = 'mufy-item-interaction-label';
    label.textContent = '交互导出 · 已采集 ' + count + ' 项';

    var isActiveSession = interactionCaptureSession &&
      interactionCaptureSession.itemKey === entity.itemKey;

    var captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'mufy-item-card-toggle';
    if (isActiveSession) {
      captureBtn.textContent = '结束采集';
      captureBtn.title = '结束当前采集会话';
      captureBtn.addEventListener('click', endInteractionCaptureSession);
    } else {
      captureBtn.textContent = '采集交互';
      captureBtn.title = '先点此按钮，再在 Mufy 中打开该物品的交互编辑窗';
      captureBtn.addEventListener('click', function () {
        startInteractionCaptureSession(entity);
      });
    }

    header.appendChild(exportToggle);
    header.appendChild(label);
    header.appendChild(captureBtn);

    if (count > 0) {
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'mufy-item-card-toggle mufy-clear-interaction-btn';
      clearBtn.textContent = '清空交互';
      clearBtn.title = '清空"' + entity.itemName + '"已采集的全部交互快照';
      clearBtn.addEventListener('click', function () {
        clearItemInteractionSnapshots(entity);
      });
      header.appendChild(clearBtn);
    }

    section.appendChild(header);

    snapList.forEach(function (snap) {
      var row = document.createElement('div');
      row.className = 'mufy-item-interaction-row';

      var sd = snap.syncedData || {};
      var stateText = snap.captureState === 'saved' ? '已保存' : '已读取';
      var stateClass = snap.captureState === 'saved' ? 'mufy-interaction-state-saved' : 'mufy-interaction-state-observed';

      var rowHead = document.createElement('div');
      rowHead.className = 'mufy-interaction-row-head';

      var rowCheckbox = document.createElement('input');
      rowCheckbox.type = 'checkbox';
      rowCheckbox.checked = snap.exportEnabled === true;
      rowCheckbox.title = '是否将该交互复制给 AI';
      rowCheckbox.addEventListener('click', function (event) {
        event.stopPropagation();
      });
      rowCheckbox.addEventListener('change', function () {
        snap.exportEnabled = rowCheckbox.checked;
        renderList();
      });

      var name = document.createElement('span');
      name.className = 'mufy-interaction-name';
      name.textContent = '▾ ' + (sd.interactionName || snap.interactionKey || '（未命名）');

      var state = document.createElement('span');
      state.className = stateClass;
      state.textContent = stateText;

      rowHead.appendChild(rowCheckbox);
      rowHead.appendChild(name);
      rowHead.appendChild(state);
      row.appendChild(rowHead);

      var detail = document.createElement('div');
      detail.className = 'mufy-interaction-detail';

      var promptLine = document.createElement('div');
      promptLine.className = 'mufy-interaction-field';
      promptLine.textContent = '提示词：' + (sd.prompt ? '已采集' : '（空）');
      detail.appendChild(promptLine);

      var cwLine = document.createElement('div');
      cwLine.className = 'mufy-interaction-field';
      cwLine.textContent = '使用后文案：' + (sd.afterCopywriting ? sd.afterCopywriting.length : 0) + ' 条';
      detail.appendChild(cwLine);

      var actLine = document.createElement('div');
      actLine.className = 'mufy-interaction-field';
      actLine.textContent = '使用后操作：' + (sd.afterAction ? '关闭' : '不操作');
      detail.appendChild(actLine);

      row.appendChild(detail);
      section.appendChild(row);
    });

    return section;
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
    summary.textContent = '导出基础字段 · ' + entity.fields.length + ' 项';

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

    card.appendChild(renderInteractionSection(entity));

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
    if (title) title.textContent = '🧩 白厨Mufy字段编辑器 V0.5.20';

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

    var selectAllBtn = panelEl && panelEl.querySelector('#mufy-helper-select-all');
    if (selectAllBtn) {
      var selectable = getSelectableFields();
      var allSelectableOn = selectable.length > 0 && selectable.every(function (f) { return f.enabled; });
      selectAllBtn.textContent = allSelectableOn ? '取消全选' : '全选导出字段';
    }
  }

  /* ─── 面板构建 ─── */

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'mufy-helper-panel';
    panelEl.innerHTML = [
      '<div id="mufy-helper-header">',
      '<span class="mufy-panel-title">白厨Mufy字段编辑器 V0.5.20</span>',
      '<button class="mufy-panel-help-btn" id="mufy-panel-help" title="帮助">?</button>',
      '<span class="close">✕</span>',
      '</div>',
      '<div id="mufy-helper-toolbar">',
      '<button data-act="scan">扫描 / 刷新</button>',
      '<button data-act="copy">复制已选内容给 AI</button>',
      '<button data-act="workbench">进入工作台</button>',
      '<button class="secondary" id="mufy-helper-select-all">全选导出字段</button>',
      '</div>',
      '<div class="mufy-export-hint">导出范围：勾选决定复制给 AI 的普通字段与交互模块，不影响工作台。</div>',
      '<div id="mufy-helper-list"></div>'
    ].join('');

    document.body.appendChild(panelEl);
    listEl = panelEl.querySelector('#mufy-helper-list');

    panelEl.querySelector('.close').addEventListener('click', function () {
      panelEl.classList.remove('open');
    });

    panelEl.querySelector('#mufy-panel-help').addEventListener('click', function (e) {
      e.stopPropagation();
      openGuideModal();
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
      var selected = getExportFields();
      var selectedInteractions = getEnabledInteractions();
      if (!selected.length && !selectedInteractions.length) { toast('当前没有勾选内容，先勾选要导出给 AI 的普通字段或交互'); return; }
      var unsafe = getUnsafeEnabledFields();
      if (unsafe.length) { toast('有 ' + unsafe.length + ' 个未确认字段已勾选，请先改名、重绑或取消勾选'); return; }
      var duplicateLabels = getDuplicateEnabledLabels();
      if (duplicateLabels.length) { toast('已选字段有重名标题：' + duplicateLabels.join('、') + '；请先改成不同标题'); return; }
      copyText(buildMarkdown()).then(function (ok) {
        toast(ok
          ? '已复制选中内容，可直接发送给 AI。\nAI 返回后，请在工作台中手动粘贴到对应字段或交互。'
          : '复制失败，请手动选择文本复制');
      });
    });

    panelEl.querySelector('[data-act="workbench"]').addEventListener('click', function () {
      if (!fields.length) { scanFields(); renderList(); }
      panelEl.classList.remove('open');
      openWorkbench();
    });

    var selectAllBtn = panelEl.querySelector('#mufy-helper-select-all');
    selectAllBtn.addEventListener('click', function () {
      if (!fields.length) { toast('请先扫描字段'); return; }
      var selectable = getSelectableFields();
      var unsafe = fields.filter(function (f) { return f.isUnrecognized || f.needsReview; });
      var allSelectableOn = selectable.length > 0 && selectable.every(function (f) { return f.enabled; });
      selectable.forEach(function (f) { f.enabled = !allSelectableOn; });
      unsafe.forEach(function (f) { f.enabled = false; });
      renderList();
      if (!allSelectableOn && unsafe.length) {
        toast('已选中 ' + selectable.length + ' 个可用字段；' + unsafe.length + ' 个待确认字段保持未选');
      }
    });

    enableDrag(panelEl, panelEl.querySelector('#mufy-helper-header'));
  }

  /* ─── 拖拽（Pointer Events） ─── */

  function clampToViewport(x, y, w, h, margin) {
    margin = margin || 12;
    x = Math.max(margin, Math.min(window.innerWidth - w - margin, x));
    y = Math.max(margin, Math.min(window.innerHeight - h - margin, y));
    return { x: x, y: y };
  }

  function enableDrag(panel, handle) {
    var pointerId = null;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;

    handle.addEventListener('pointerdown', function (event) {
      if (event.target && (event.target.classList.contains('close') ||
          event.target.id === 'mufy-panel-help')) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      var rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
    });

    handle.addEventListener('pointermove', function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      var newLeft = startLeft + dx;
      var newTop = startTop + dy;
      var rect = panel.getBoundingClientRect();
      var clamped = clampToViewport(newLeft, newTop, rect.width, rect.height, 12);
      panel.style.left = clamped.x + 'px';
      panel.style.top = clamped.y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    handle.addEventListener('pointerup', function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return;
      handle.releasePointerCapture(pointerId);
      pointerId = null;
      uiPrefs.panelPosition = { left: parseInt(panel.style.left, 10), top: parseInt(panel.style.top, 10) };
      saveUiPrefs();
    });
  }

  /* ─── 悬浮按钮（Pointer Events + 拖拽阈值 + 视口约束） ─── */

  function buildToggleButton() {
    var button = document.createElement('div');
    button.id = 'mufy-helper-toggle';
    button.textContent = '🧩';
    button.title = '白厨Mufy字段编辑器';

    // Apply saved position
    if (uiPrefs.launcherPosition) {
      button.style.bottom = 'auto';
      button.style.right = 'auto';
      button.style.left = uiPrefs.launcherPosition.x + 'px';
      button.style.top = uiPrefs.launcherPosition.y + 'px';
    }

    var pointerId = null;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;
    var dragged = false;
    var DRAG_THRESHOLD = 6;

    button.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      dragged = false;
      startX = event.clientX;
      startY = event.clientY;
      var rect = button.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
    });

    button.addEventListener('pointermove', function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!dragged && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      dragged = true;
      var newLeft = startLeft + dx;
      var newTop = startTop + dy;
      var size = button.offsetWidth || 48;
      var clamped = clampToViewport(newLeft, newTop, size, size, 12);
      button.style.left = clamped.x + 'px';
      button.style.top = clamped.y + 'px';
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    });

    button.addEventListener('pointerup', function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return;
      button.releasePointerCapture(pointerId);
      pointerId = null;
      if (dragged) {
        uiPrefs.launcherPosition = { x: parseInt(button.style.left, 10), y: parseInt(button.style.top, 10) };
        saveUiPrefs();
        return;
      }
      // Click (no drag)
      panelEl.classList.toggle('open');
      if (panelEl.classList.contains('open')) {
        if (!fields.length) { scanFields(); renderList(); }
        // Apply saved panel position
        if (uiPrefs.panelPosition) {
          panelEl.style.left = uiPrefs.panelPosition.left + 'px';
          panelEl.style.top = uiPrefs.panelPosition.top + 'px';
          panelEl.style.right = 'auto';
        }
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
    loadUiPrefs();
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

    // 交互弹窗检测：subtree，仅 arm/activeDialog 非空时实际执行
    var interactionObserver = new MutationObserver(function () {
      if (!interactionCaptureSession && !activeInteractionDialog) return;
      if (interactionObserverQueued) return;
      interactionObserverQueued = true;
      requestAnimationFrame(function () {
        interactionObserverQueued = false;
        checkForInteractionDialog();
      });
    });
    interactionObserver.observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
