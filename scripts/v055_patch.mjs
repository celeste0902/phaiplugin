import fs from 'node:fs';

const file = 'plugintempermonkey.js';
let s = fs.readFileSync(file, 'utf8');

const replacements = [
  ['// @version      0.5.4', '// @version      0.5.5'],
  ['<span>🧩 Mufy 字段助手 V0.5.4</span>', '<span>🧩 Mufy 字段助手 V0.5.5</span>'],
  ["helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.4';", "helperTitle.textContent = '🧩 Mufy 字段助手 V0.5.5';"],
  ["'  <button id=\"mufy-wb-discard\" class=\"secondary\">放弃草稿</button>',\n", ''],
  ['// Draft reverted back to match original', '// Draft reverted back to match synced version'],
  ['/* ─── V0.5.4｜单字段注入安全层 ─── */', '/* ─── V0.5.5｜单字段注入安全层 ─── */']
];

for (const [from, to] of replacements) {
  if (!s.includes(from)) throw new Error('missing expected source fragment');
  s = s.replace(from, to);
}

if (s.includes('mufy-wb-discard')) throw new Error('discard control still present');
fs.writeFileSync(file, s, 'utf8');
