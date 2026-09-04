/**
 * git-sequence-editor.mjs —— 交互式变基（rebase -i）todo 文件的程序化「编辑器」shim（零依赖，仅 node 内置模块）。
 *
 * 机制：git 以 GIT_SEQUENCE_EDITOR 指定的命令启动 todo 编辑器。git 内部（editor.c
 * launch_specified_editor + run-command.c prepare_shell_cmd）实际执行：
 *     sh -c '<编辑器命令> "$@"' <编辑器命令> <todo路径>
 * 即 sh 把 git 生成的 todo 路径作为最后一个参数追加到编辑器命令之后（"$@" 展开）。
 * 本 shim 读取 process.argv 末参（该 todo 路径），把 process.env.REBASED_TODO_FILE 指向的
 * 「服务端已备好」的 todo 内容覆盖写入——todo 文件的编辑由此完全程序化，整个过程无需交互。
 *
 * 调用方（rebase.ts）职责：对 node 可执行路径与本文件路径做 sh 双引号包裹（路径可能含空格等
 * 特殊字符；bash 双引号内仅 $ ` " \ 四类字符需转义，见 rebase.ts 的 quoteForSh），
 * 并通过环境变量注入 GIT_SEQUENCE_EDITOR=<两条已引用路径> 与 REBASED_TODO_FILE=<临时todo文件>。
 *
 * 失败语义：REBASED_TODO_FILE 未设置或读写失败时以非零退出——git 将中止变基且不留下
 * rebase 状态，上层按 GitExitError 原样透出（api 层预检已保证参数合法，此处属于防御）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const todoPath = process.argv[process.argv.length - 1];
const preparedPath = process.env.REBASED_TODO_FILE;

if (preparedPath === undefined || preparedPath === '') {
  throw new Error('REBASED_TODO_FILE 未设置，无法获取已备好的 todo 内容');
}
if (todoPath === undefined) {
  throw new Error('todo 路径未作为末参传入');
}

writeFileSync(todoPath, readFileSync(preparedPath, 'utf8'));
