/**
 * ref 名归一化（图着色与 chips 共用的唯一入口）。
 *
 * 为什么需要：后端 log 接口的 `refs` 是 **git decorate 原始串**（如 `HEAD -> rebase-topic`、
 * `tag: v1.0`），而「分支/标签名」是去掉这些展示前缀之后的名字。两处消费方必须用**同一个名字**：
 *   - 图列着色（build-layout：主线染 head 首个 ref 名哈希色）；
 *   - 行内 chips（domain/refs：`HEAD -> x` 显示为 `x`，`tag: t` 显示为标签）。
 * 若各剥各的，同一条分支在图上与 chip 上会算出两个哈希 → 两个颜色，直接违反
 * commit-graph.tsx 里写明的口径「同一分支在图中与 chip 上恒定同色」
 * （实测：主线 `colorForRef('HEAD -> rebase-topic')` = #7863a6，而 chips 的
 *  `colorForRef('rebase-topic')` = #63a67e；且 #7863a6 与 lane 1 的 #7663a6 只差 2/255，肉眼同色）。
 *
 * 口径：只剥 **git decorate 的展示前缀**（`HEAD -> `），不解析 `tag: ` 之外的任何语义；
 * `tag: ` 前缀的去留由调用方决定（chips 需要区分标签，着色只需要名字）。
 */

/** git decorate 的 HEAD 箭头前缀（`git log --decorate` 的固定写法） */
const HEAD_PREFIX = 'HEAD -> ';

/** 把 decorate 原始串归一化为 ref 名（剥掉 `HEAD -> ` 前缀；其余原样返回） */
export function refNameOf(raw: string): string {
  return raw.startsWith(HEAD_PREFIX) ? raw.slice(HEAD_PREFIX.length) : raw;
}
