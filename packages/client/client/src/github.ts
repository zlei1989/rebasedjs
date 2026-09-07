/** GitHub PR hooks：状态/PR 列表/详情/时间线/文件 SWR 查询 + 评论/review/合并/检出 mutation（响应显式回写 timeline/detail/prs+detail/status+branches 缓存键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type {
  GitHubCommentBody,
  GitHubMergeBody,
  GitHubPrCheckoutResult,
  GitHubPrDetail,
  GitHubPrFiles,
  GitHubPrList,
  GitHubPrMergeResult,
  GitHubReviewBody,
  GitHubReviewCommentBody,
  GitHubReviewComments,
  GitHubStatus,
  GitHubTimeline,
} from '@rebased/contracts';
import { getJson, postJson } from './http';

const GITHUB_PR_STATES = ['open', 'closed', 'all'] as const;
type GithubPrState = (typeof GITHUB_PR_STATES)[number];

/** GitHub 域可用性：GET /api/repos/:repoId/github/status */
export function useGithubStatus(repoId: string): SWRResponse<GitHubStatus> {
  return useSWR<GitHubStatus>(`/api/repos/${repoId}/github/status`, getJson);
}

/** PR 列表：GET /api/repos/:repoId/github/prs?state=…（state 必填，键恒带查询串；服务端缺省 open） */
export function useGithubPrs(repoId: string, state: GithubPrState): SWRResponse<GitHubPrList> {
  return useSWR<GitHubPrList>(`/api/repos/${repoId}/github/prs?state=${state}`, getJson);
}

/** PR 详情：GET /api/repos/:repoId/github/prs/:number；number 为 null 时挂 null key 不发请求（条件拉取，页面可无条件挂载） */
export function useGithubPrDetail(repoId: string, number: number | null): SWRResponse<GitHubPrDetail | null> {
  return useSWR<GitHubPrDetail | null>(
    number === null ? null : `/api/repos/${repoId}/github/prs/${number}`,
    getJson,
  );
}

/** PR 时间线：GET …/github/prs/:number/timeline；number 为 null 时挂 null key 不发请求 */
export function useGithubTimeline(repoId: string, number: number | null): SWRResponse<GitHubTimeline | null> {
  return useSWR<GitHubTimeline | null>(
    number === null ? null : `/api/repos/${repoId}/github/prs/${number}/timeline`,
    getJson,
  );
}

/** PR 文件变更：GET …/github/prs/:number/files；number 为 null 时挂 null key 不发请求 */
export function useGithubPrFiles(repoId: string, number: number | null): SWRResponse<GitHubPrFiles | null> {
  return useSWR<GitHubPrFiles | null>(
    number === null ? null : `/api/repos/${repoId}/github/prs/${number}/files`,
    getJson,
  );
}

/** 行级评审评论：GET …/github/prs/:number/review-comments；number 为 null 时挂 null key 不发请求 */
export function useGithubPrReviewComments(repoId: string, number: number | null): SWRResponse<GitHubReviewComments | null> {
  return useSWR<GitHubReviewComments | null>(
    number === null ? null : `/api/repos/${repoId}/github/prs/${number}/review-comments`,
    getJson,
  );
}

/** 添加行级评审评论（mutation）：POST …/review-comments，响应（刷新列表）显式回写 review-comments 缓存键 */
export function useAddGithubPrReviewComment(repoId: string, number: number): { trigger: (body: GitHubReviewCommentBody) => Promise<GitHubReviewComments>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/github/prs/${number}/review-comments`,
    (key: string, { arg }: { arg: GitHubReviewCommentBody }) => postJson<GitHubReviewComments>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const comments = await trigger(body);
      await mutate(`/api/repos/${repoId}/github/prs/${number}/review-comments`, comments, { revalidate: false });
      return comments;
    },
    isMutating,
  };
}

/** 添加评论（mutation）：POST …/github/prs/:number/comments，响应（刷新时间线）显式回写 timeline 缓存键 */
export function useAddGithubComment(repoId: string, number: number): { trigger: (body: GitHubCommentBody) => Promise<GitHubTimeline>; isMutating: boolean } {
  // mutation 端点与 timeline 查询键不同键，无法用 populateCache；改用上下文 mutate 跨键回写
  // revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训，mutation 键不触发竞态 GET），
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/github/prs/${number}/comments`,
    (key: string, { arg }: { arg: GitHubCommentBody }) => postJson<GitHubTimeline>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const timeline = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/github/prs/${number}/timeline`, timeline, { revalidate: false });
      return timeline;
    },
    isMutating,
  };
}

/** 提交 review（mutation）：POST …/github/prs/:number/review，响应（刷新详情，reviewDecision 变化）显式回写 detail 缓存键 */
export function useSubmitGithubReview(repoId: string, number: number): { trigger: (body: GitHubReviewBody) => Promise<GitHubPrDetail>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/github/prs/${number}/review`,
    (key: string, { arg }: { arg: GitHubReviewBody }) => postJson<GitHubPrDetail>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const detail = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/github/prs/${number}`, detail, { revalidate: false });
      return detail;
    },
    isMutating,
  };
}

/** 合并 PR（mutation）：POST …/github/prs/:number/merge，merged=true 时列表项与详情显式回写 merged:true（GitHub 合并后 state 仍为 open，merged 单独标识） */
export function useMergeGithubPr(repoId: string, number: number): { trigger: (body: GitHubMergeBody) => Promise<GitHubPrMergeResult>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/github/prs/${number}/merge`,
    (key: string, { arg }: { arg: GitHubMergeBody }) => postJson<GitHubPrMergeResult>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const result = await trigger(body);
      // 仅成功合并才回写：hook 不知调用方当前筛选 state，三个列表键都按 number 更新对应条目
      if (result.merged) {
        const markMerged = (list?: GitHubPrList): GitHubPrList | undefined =>
          list === undefined
            ? list
            : { prs: list.prs.map((p) => (p.number === number ? { ...p, merged: true } : p)) };
        for (const state of GITHUB_PR_STATES) {
          await mutate(`/api/repos/${repoId}/github/prs?state=${state}`, markMerged, { revalidate: false });
        }
        await mutate(`/api/repos/${repoId}/github/prs/${number}`, (detail?: GitHubPrDetail): GitHubPrDetail | undefined =>
          detail === undefined ? detail : { ...detail, merged: true }, { revalidate: false });
      }
      return result;
    },
    isMutating,
  };
}

/** 检出 PR 分支（mutation）：POST …/github/prs/:number/checkout（无请求体）；检出切换本地分支，跨键补刷 status（repo 域）与 branches 键（P3-D restore 先例） */
export function useCheckoutGithubPr(repoId: string, number: number): { trigger: () => Promise<GitHubPrCheckoutResult>; isMutating: boolean } {
  // 端点与 status/branches 查询键不同键：成功后经全局 mutate 重取两键（响应仅有 branchName，无可写数据）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/github/prs/${number}/checkout`,
    (key: string) => postJson<GitHubPrCheckoutResult>(key, {}),
    { revalidate: false },
  );
  return {
    trigger: async () => {
      const result = await trigger();
      await mutate(`/api/repos/${repoId}/status`);
      await mutate(`/api/repos/${repoId}/branches`);
      return result;
    },
    isMutating,
  };
}
