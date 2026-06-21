import fs from 'node:fs';

const file = 'plugintempermonkey.js';
let s = fs.readFileSync(file, 'utf8');
const changes = [
  ['// @version      0.5.2', '// @version      0.5.3'],
  ['三态草稿层与单字段手动注入', '三态草稿层与安全单字段注入'],
  ['<span>🧩 Mufy 字段助手 V0.5.0</span>', '<span>🧩 Mufy 字段助手 V0.5.3</span>'],
  ["helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.1';", "helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.3';"],
  ["'      <span class=\"wb-info-key\">原文</span>',", "'      <span class=\"wb-info-key\">Mufy 当前</span>',"],
  ["toast('已恢复\"' + snap.label + '\"的初始内容');", "toast('已将\"' + snap.label + '\"还原至当前同步版本');"],
  ["toast('已放弃\"' + snap.label + '\"的草稿，恢复原始内容');", "toast('已放弃\"' + snap.label + '\"的草稿，恢复至当前同步版本');"],
  ["undoButton.textContent = '撤销本次写入';", "undoButton.textContent = '撤回编辑页写入';"],
  ["setWbWriteStatus('ok', '已同步到 Mufy ✓');", "setWbWriteStatus('ok', '已填入 Mufy 编辑器 ✓ 请手动点击“更新角色”保存');"]
];
for (const [from, to] of changes) {
  if (!s.includes(from)) throw new Error('missing patch target: ' + from);
  s = s.replace(from, to);
}
s = s.replace('/* ─── V0.5.1｜单字段注入安全补丁 ─── */', '/* ─── V0.5.3｜单字段注入安全层 ─── */');
fs.writeFileSync(file, s, 'utf8');
