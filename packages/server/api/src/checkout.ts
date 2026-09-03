/** 检出功能：action 分派 core 检出原语；存在性预检给出 INVALID_REF/INVALID_QUERY；返回刷新后的 RepoStatus。 */
import { checkoutBranch, checkoutDetached, checkoutNewBranch, listBranches } from '@rebased/core';
import { ServiceError, type CheckoutAction, type RepoStatus } from '@rebased/contracts';
import { getRepoStatus } from './status';

/** 本地分支短名集合（远程跟踪分支不参与 branch/newBranch 的存在性判定） */
async function localBranchNames(repoPath: string): Promise<Set<string>> {
  const branches = await listBranches(repoPath);
  return new Set(branches.filter((b) => !b.remote).map((b) => b.name));
}

/** 检出分派：branch → checkoutBranch；newBranch → checkoutNewBranch；detach → checkoutDetached（ref 无效由 git 以 GitExitError 透出，框架层折为 GIT_ERROR）；返回刷新后的 RepoStatus */
export async function applyCheckout(repoPath: string, action: CheckoutAction): Promise<RepoStatus> {
  switch (action.action) {
    case 'branch': {
      const names = await localBranchNames(repoPath);
      if (!names.has(action.name)) throw new ServiceError('INVALID_REF', `分支不存在：${action.name}`);
      await checkoutBranch(repoPath, action.name);
      break;
    }
    case 'newBranch': {
      const names = await localBranchNames(repoPath);
      if (names.has(action.name)) throw new ServiceError('INVALID_QUERY', `分支已存在：${action.name}`);
      await checkoutNewBranch(repoPath, action.name, action.startPoint);
      break;
    }
    case 'detach':
      await checkoutDetached(repoPath, action.ref);
      break;
  }
  return getRepoStatus(repoPath);
}
