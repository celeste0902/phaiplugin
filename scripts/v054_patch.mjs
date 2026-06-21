import fs from 'node:fs';

const file = 'plugintempermonkey.js';
let s = fs.readFileSync(file, 'utf8');

const replacements = [
  ['// @version      0.5.3', '// @version      0.5.4'],
  ['<span>🧩 Mufy 字段助手 V0.5.3</span>', '<span>🧩 Mufy 字段助手 V0.5.4</span>'],
  ["helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.3';", "helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.4';"],
  ["'  <button id=\"mufy-wb-restore\" class=\"secondary\">还原草稿至同步版本</button>',", "'  <button id=\"mufy-wb-restore\" class=\"secondary\" title=\"放弃当前字段尚未写入 Mufy 的编辑，恢复到最近一次成功同步的版本。\">还原当前字段草稿</button>',"],
  ["['#mufy-wb-restore', '#mufy-wb-discard'].forEach(function (selector) {", "['#mufy-wb-restore'].forEach(function (selector) {"]
];

for (const [from, to] of replacements) {
  if (!s.includes(from)) throw new Error('missing expected source fragment');
  s = s.replace(from, to);
}

const discardBlock = `    /* 放弃草稿：draft → syncedContent（V0.6.2 引入 LLM 回填后两者语义会分化） */
    wbEl.querySelector('#mufy-wb-discard').addEventListener('click', function () {
      if (wbCurrentIndex < 0 || wbCurrentIndex >= wbSnapshot.length) return;
      var snap = wbSnapshot[wbCurrentIndex];
      snap.draftContent = snap.syncedContent;
      snap.syncStatus = 'clean';
      wbEl.querySelector('#mufy-wb-editor').value = snap.syncedContent;
      setWbWriteStatus('', '');
      renderWbFieldList();
      updateWbRightPanel();
      toast('已放弃"' + snap.label + '"的草稿，恢复至当前同步版本');
    });

`;

if (!s.includes(discardBlock)) throw new Error('discard block not found');
s = s.replace(discardBlock, '');
s = s.replace('/* ─── V0.5.3｜单字段注入安全层 ─── */', '/* ─── V0.5.4｜单字段注入安全层 ─── */');
fs.writeFileSync(file, s, 'utf8');
