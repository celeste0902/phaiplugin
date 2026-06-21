import fs from 'node:fs';

const file = 'plugintempermonkey.js';
let source = fs.readFileSync(file, 'utf8');

source = source.replace('// @version      0.5.6', '// @version      0.5.5');
source = source.replace(
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含物品聚合扫描、全屏工作台、三态草稿层与安全单字段注入',
  '// @description  扫描、分组、导出、预览并安全写回 Mufy 角色卡编辑字段；含全屏工作台、三态草稿层与安全单字段注入'
);

fs.writeFileSync(file, source, 'utf8');
await import('./v057_item_groups.mjs');
