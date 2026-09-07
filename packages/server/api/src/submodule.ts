/**
 * submodule 功能：core 原语 → contracts 形状。
 * getSubmodules 直映射；core 把损坏 .gitmodules 折成 Error（消息以「子模块配置解析失败」开头，
 * T2 实测/裁定）→ ServiceError('GIT_ERROR', 同消息)；其余 GitExitError → gitFailure 惯例。
 * updateSubmodules：core update（{name?, recursive?} 透传）→ 重查返回刷新列表。
 */
import { GitExitError, listSubmodules, updateSubmodules as coreUpdateSubmodules } from '@rebased/core';
import { ServiceError, type SubmoduleList, type SubmoduleUpdateBody } from '@rebased/contracts';

/** GitExitError → GIT_ERROR（中文前缀 + stderr 首行；其余错误类型取 message 兜底）——沿 gitlab 惯例 */
function gitFailure(prefix: string, error: unknown): ServiceError {
  const detail =
    error instanceof GitExitError
      ? (error.stderr.trim().split('\n')[0] ?? '')
      : error instanceof Error
        ? error.message
        : String(error);
  return new ServiceError('GIT_ERROR', `${prefix}：${detail}`, { cause: error });
}

/** 列表：core listSubmodules 直映射；损坏 .gitmodules 的解析失败 Error → GIT_ERROR（同消息，不静默空列表） */
export async function getSubmodules(repoPath: string): Promise<SubmoduleList> {
  try {
    return { submodules: await listSubmodules(repoPath) };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.message.startsWith('子模块配置解析失败')) {
      throw new ServiceError('GIT_ERROR', error.message, { cause: error });
    }
    throw gitFailure('获取子模块列表失败', error);
  }
}

/** 更新：core update（name/recursive 透传）→ 重查；失败 → gitFailure 惯例 */
export async function updateSubmodules(repoPath: string, body: SubmoduleUpdateBody): Promise<SubmoduleList> {
  try {
    await coreUpdateSubmodules(repoPath, { name: body.name, recursive: body.recursive });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw gitFailure('更新子模块失败', error);
  }
  return getSubmodules(repoPath);
}
