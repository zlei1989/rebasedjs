// 文档截图账目核对：§5.27 ① 的表行数 / 配对图数 / 重复 SHA / 缺图 / 孤儿图
// 用法：node scripts/check-docs-shots.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs', 'e2e-verification.md');
const SHOTS = join(ROOT, 'docs', 'shots');

const lines = readFileSync(DOC, 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.includes('① 本轮已完成'));
const end = lines.findIndex((l) => l.includes('② 待补矩阵'));
if (start < 0 || end < 0) throw new Error(`§5.27 段标记未找到: start=${start} end=${end}`);

const rows = [];
const pairImgs = [];
for (let i = start; i < end; i += 1) {
  const line = lines[i];
  if (!line.startsWith('|')) continue;
  if (/^\|\s*-+/.test(line)) continue; // 分隔行
  if (/^\|\s*(表面|分组)\s*\|/.test(line)) continue; // 表头行
  const cols = line.split('|');
  if (cols.length < 7) continue;
  rows.push(line);
  for (const c of [cols[4], cols[5]]) {
    for (const m of c.matchAll(/`([^`]+\.png)`/g)) pairImgs.push(m[1]);
  }
}
const uniqPair = [...new Set(pairImgs)];
console.log(`§5.27 ① 表面行数 = ${rows.length}；配对列引用 ${pairImgs.length} 次 / 去重 ${uniqPair.length} 张`);

// 全仓 md 引用到的 png 名（排除被 - 或 * 前缀截断的匹配片段）
const mdFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (extname(e.name) === '.md') mdFiles.push(p);
  }
})(ROOT);
const refs = new Set();
for (const f of mdFiles) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/(?<![-*\w])([A-Za-z0-9_][A-Za-z0-9_-]*\.png)/g)) refs.add(m[1]);
}

const disk = readdirSync(SHOTS).filter((n) => n.toLowerCase().endsWith('.png'));
const diskSet = new Set(disk);

const missingPair = uniqPair.filter((n) => !diskSet.has(n));
console.log(`配对列缺失文件 = ${missingPair.length ? missingPair.join(', ') : 0}`);
const missingAll = [...refs].filter((n) => !n.includes('/') && !diskSet.has(n));
console.log(`全仓 md 引用缺失 = ${missingAll.length ? missingAll.join(', ') : 0}`);
const orphans = disk.filter((n) => !refs.has(n));
console.log(`孤儿图 = ${orphans.length} 张${orphans.length ? '：' + orphans.join(', ') : ''}`);

const byHash = new Map();
let bytes = 0;
for (const n of disk) {
  bytes += statSync(join(SHOTS, n)).size;
  const h = createHash('sha256').update(readFileSync(join(SHOTS, n))).digest('hex');
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push(n);
}
const dup = [...byHash.entries()].filter(([, v]) => v.length > 1);
console.log(`盘上共 ${disk.length} 张（${(bytes / 1048576).toFixed(1)} MiB）；重复 SHA 组 = ${dup.length}`);
for (const [h, v] of dup) console.log(`  ${h.slice(0, 12)} => ${v.join(', ')}`);
console.log(`扫描 md 文件 = ${mdFiles.length} 个（含 ${relative(ROOT, DOC)}、docs/manual.md 等）`);
