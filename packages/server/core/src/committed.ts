/**
 * committed 原语：git log --name-status 提交浏览分页（历史提交及其变更文件）。
 *
 * 输出布局（实测 git 2.47）：`--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%P` 每提交一节——
 * 格式行（含 NUL）在前，其后若干 name-status 文件行（`status\tpath` 或 `R100\told\tnew`），
 * 节间以空行分隔。文件行不含 NUL，故按行切分后「含 NUL = 提交头行、不含 = 文件行」可唯一区分
 * （subject 由 %s 保证无换行/NUL；%P 父哈希空格分隔，根提交为空串）。
 *
 * 路径引号（本文件关键点）：非 -z 布局下，git 对需引号路径整字段包裹 C 引号（`"..."`）——
 * 含非 ASCII 字节（LC_ALL=C 下按字节八进制转义，如 `"\346\226\207…"`）、控制字符、
 * 反斜杠/双引号；空格等可打印符号不引号。解析必须先切字段再逐字段还原引号（见 unquotePath）。
 * 不用 -z：name-status 的 -z 布局为 `status\0path\0`（不引号但换行/字段切分不同），
 * 与 -z 无法统一解析，本原语依计划采用非 -z + 引号还原。
 */
import { runGit } from './exec';

/** 提交条目：逐字段对应 contracts 的 CommittedEntry（core 层持 Core 前缀镜像，api 层映射）。
 *  status 用 string 而非契约枚举：git name-status 除 A/M/D/R/C 还可输出 T（类型变更）等，
 *  core 层忠于 git 输出不做窄化（窄化是契约层/映射层的职责，见 Task 4 映射）。
 *  parents：%P 空格分隔的父哈希；根提交为空数组（容器打开根提交 diff 时据此降级——from=<hash>~1 对
 *  根提交无父版本，会以 128 抛错，见终审 Must-fix 2）。 */
export interface CoreCommittedEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  dateIso: string;
  parents: string[];
  files: { path: string; status: string; renameFrom?: string }[];
}

/** %H%x00%h%x00%s%x00%an%x00%aI%x00%P —— 格式行 6 字段、字段间 NUL（%P 父哈希，根提交为空字段） */
const COMMITTED_FORMAT = '%H%x00%h%x00%s%x00%an%x00%aI%x00%P';

/**
 * 还原 git 的 C 引号路径字面量。
 * git 要求引号时把整个字段包成 `"..."`，内转义为 `\a\b\f\n\r\t\v\\\"` 与 3 位八进制 `\NNN`
 * （非 ASCII 字节逐字节八进制，LC_ALL=C 下必走此路）；未转义字符原样。
 * 扫描规则：未转义的 `"` 即字段结束；`\NNN` 还原为字节，收集字节后统一按 UTF-8 解码
 * （git 内部以 UTF-8 存路径，逐字节还原后必须再解码，否则中文路径会退化为拉丁字符）。
 * 技巧：引号内的控制字符一律转义成 2 字符序列，故行（\n）与字段（\t）切分前不出现裸控制字节，
 * 非 -z 的按行/按 tab 切分是安全的。
 */
function unquotePath(field: string): string {
  let raw = field;
  if (field.startsWith('"')) {
    const bytes: number[] = [];
    let i = 1;
    for (; i < field.length; i++) {
      const c = field[i];
      if (c === '"') break;
      if (c !== '\\') {
        bytes.push(c.charCodeAt(0));
        continue;
      }
      const e = field[++i];
      const simple: Record<string, number> = { a: 0x07, b: 0x08, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09, v: 0x0b, '\\': 0x5c, '"': 0x22 };
      if (e !== undefined && e in simple) {
        bytes.push(simple[e]);
        continue;
      }
      // 八进制 \NNN：三位八进制数还原为一个字节
      const octal = field.slice(i, i + 3);
      if (/^[0-7]{3}$/.test(octal)) {
        bytes.push(parseInt(octal, 8));
        i += 2;
        continue;
      }
      // 非常规转义（理论上 git 不产出）：原样保留反斜杠
      bytes.push(0x5c);
    }
    raw = Buffer.from(bytes).toString('utf8');
  }
  return raw;
}

/**
 * 解析 --name-status 全文为提交条目数组。
 * 单遍按行：空行跳过（节间分隔）；含 NUL 的行为提交头行（6 字段 NUL 切分，末尾字段剥 \r）；
 * 其余为文件行——按首个 \t 切状态与路径段，R/C 带得分前缀（如 R100 → 'R'）且有两段路径，
 * 第一段为 renameFrom、第二段为 path；段内统一引号还原。
 */
function parseCommitted(stdout: string): CoreCommittedEntry[] {
  const entries: CoreCommittedEntry[] = [];
  let current: CoreCommittedEntry | undefined;
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    if (line.includes('\0')) {
      const [hash, shortHash, subject, author, dateIso, parentsField = ''] = line.split('\0');
      // 字段数防御（与 history 的 parseHistoryRecords 同款）：格式行约定 6 字段，缺字段整行丢弃
      if (hash === undefined || shortHash === undefined || subject === undefined || author === undefined || dateIso === undefined) continue;
      current = {
        hash,
        shortHash,
        subject,
        author,
        dateIso: dateIso.replace(/\r$/, ''),
        parents: parentsField.replace(/\r$/, '').split(' ').filter((p) => p !== ''),
        files: [],
      };
      entries.push(current);
      continue;
    }
    if (current === undefined) continue; // 防御：格式行之前不应出现文件行
    const tab = line.indexOf('\t');
    if (tab < 0) continue; // 防御：非文件行（git 版本差异）
    const rawStatus = line.slice(0, tab);
    const status = rawStatus[0]; // 'R100' → 'R'（映射到契约枚举语义）
    const fields = line.slice(tab + 1).split('\t').map(unquotePath);
    if ((status === 'R' || status === 'C') && fields.length >= 2) {
      current.files.push({ path: fields[1], status, renameFrom: fields[0] });
    } else {
      current.files.push({ path: fields[0], status });
    }
  }
  return entries;
}

/**
 * 提交浏览分页（git log --name-status；limit/skip 均为逐提交粒度，文件行随提交节聚合）。
 * hasMore 试探法：一次取 limit+1 条——超过 limit 即有后续页，返回前 limit 条。
 * --skip/--max-count 是 git 内置逐提交游标，越界时自然返回空无异常。
 */
export async function committedPage(
  cwd: string,
  opts: { limit: number; skip: number },
): Promise<{ entries: CoreCommittedEntry[]; hasMore: boolean }> {
  const { stdout } = await runGit(
    ['log', '--name-status', `--format=${COMMITTED_FORMAT}`, `--skip=${opts.skip}`, `--max-count=${opts.limit + 1}`],
    { cwd },
  );
  const all = parseCommitted(stdout);
  return { entries: all.slice(0, opts.limit), hasMore: all.length > opts.limit };
}
