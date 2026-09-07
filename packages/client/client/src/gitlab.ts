/** GitLab MR hooks：状态/MR 列表/详情/时间线/文件 SWR 查询 + 创建/评论/review/合并/检出 mutation（响应显式回写 mrs/timeline/detail/mrs+detail/status+branches 缓存键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type {
  GitLabCommentBody,
  GitLabDiscussionBody,
  GitLabDiscussions,
  GitLabMrCheckoutResult,
  GitLabMrCreateBody,
  GitLabMrDetail,
  GitLabMrFiles,
  GitLabMrList,
  GitLabMrMergeResult,
  GitLabMergeBody,
  GitLabMrQuery,
  GitLabReviewBody,
  GitLabStatus,
  GitLabTimeline,
} from '@rebased/contracts';
import { getJson, postJson } from './http';

/** MR 列表全部合法 state（服务端 GET /api/repos/:repoId/gitlab/mrs?state=… 校验维度；merge 回写需覆盖全部键） */
const GITLAB_MR_STATES: GitLabMrQuery['state'][] = ['opened', 'closed', 'merged', 'locked', 'all'];
/** 新创建 MR 恒为 opened——仅前置插入 opened/all 两个 list 键，不进 closed/merged/locked 列表 */
const GITLAB_MR_CREATE_STATES: GitLabMrQuery['state'][] = ['opened', 'all'];

/** GitLab 域可用性：GET /api/repos/:repoId/gitlab/status */
export function useGitlabStatus(repoId: string): SWRResponse<GitLabStatus> {
  return useSWR<GitLabStatus>(`/api/repos/${repoId}/gitlab/status`, getJson);
}

/** MR 列表：GET /api/repos/:repoId/gitlab/mrs?state=…（state 必填，键恒带查询串；服务端缺省 opened） */
export function useGitlabMrs(repoId: string, state: GitLabMrQuery['state']): SWRResponse<GitLabMrList> {
  return useSWR<GitLabMrList>(`/api/repos/${repoId}/gitlab/mrs?state=${state}`, getJson);
}

/** MR 详情：GET /api/repos/:repoId/gitlab/mrs/:iid；iid 为 null 时挂 null key 不发请求（条件拉取，页面可无条件挂载） */
export function useGitlabMrDetail(repoId: string, iid: number | null): SWRResponse<GitLabMrDetail | null> {
  return useSWR<GitLabMrDetail | null>(
    iid === null ? null : `/api/repos/${repoId}/gitlab/mrs/${iid}`,
    getJson,
  );
}

/** MR 时间线：GET …/gitlab/mrs/:iid/timeline；iid 为 null 时挂 null key 不发请求 */
export function useGitlabTimeline(repoId: string, iid: number | null): SWRResponse<GitLabTimeline | null> {
  return useSWR<GitLabTimeline | null>(
    iid === null ? null : `/api/repos/${repoId}/gitlab/mrs/${iid}/timeline`,
    getJson,
  );
}

/** MR 文件变更：GET …/gitlab/mrs/:iid/files；iid 为 null 时挂 null key 不发请求 */
export function useGitlabMrFiles(repoId: string, iid: number | null): SWRResponse<GitLabMrFiles | null> {
  return useSWR<GitLabMrFiles | null>(
    iid === null ? null : `/api/repos/${repoId}/gitlab/mrs/${iid}/files`,
    getJson,
  );
}

/** 行级讨论注记：GET …/gitlab/mrs/:iid/discussions；iid 为 null 时挂 null key 不发请求 */
export function useGitlabDiscussions(repoId: string, iid: number | null): SWRResponse<GitLabDiscussions | null> {
  return useSWR<GitLabDiscussions | null>(
    iid === null ? null : `/api/repos/${repoId}/gitlab/mrs/${iid}/discussions`,
    getJson,
  );
}

/** 添加行级讨论（mutation）：POST …/discussions，响应（刷新列表）显式回写 discussions 缓存键 */
export function useAddGitlabDiscussion(repoId: string, iid: number): { trigger: (body: GitLabDiscussionBody) => Promise<GitLabDiscussions>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/gitlab/mrs/${iid}/discussions`,
    (key: string, { arg }: { arg: GitLabDiscussionBody }) => postJson<GitLabDiscussions>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const discussions = await trigger(body);
      await mutate(`/api/repos/${repoId}/gitlab/mrs/${iid}/discussions`, discussions, { revalidate: false });
      return discussions;
    },
    isMutating,
  };
}

/** 创建 MR（mutation）：POST …/gitlab/mrs，响应（重查详情）前置插入 opened/all 两 list 键（detail 继承 summary，直接入列） */
export function useCreateGitlabMr(repoId: string): { trigger: (body: GitLabMrCreateBody) => Promise<GitLabMrDetail>; isMutating: boolean } {
  // mutation 端点与 list 查询键不同键，无法用 populateCache；改用上下文 mutate 跨键回写
  // revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训，mutation 键不触发竞态 GET），
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/gitlab/mrs`,
    (key: string, { arg }: { arg: GitLabMrCreateBody }) => postJson<GitLabMrDetail>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const detail = await trigger(body);
      // 仅前置插入（已含该 iid 的键不动，避免重复）；hook 不知调用方当前筛选 state，两键都写
      const prepend = (list?: GitLabMrList): GitLabMrList | undefined =>
        list === undefined || list.mrs.some((m) => m.iid === detail.iid)
          ? list
          : { mrs: [detail, ...list.mrs] };
      for (const state of GITLAB_MR_CREATE_STATES) {
        await mutate(`/api/repos/${repoId}/gitlab/mrs?state=${state}`, prepend, { revalidate: false });
      }
      return detail;
    },
    isMutating,
  };
}

/** 添加评论（mutation）：POST …/gitlab/mrs/:iid/comments，响应（刷新时间线）显式回写 timeline 缓存键 */
export function useAddGitlabComment(repoId: string, iid: number): { trigger: (body: GitLabCommentBody) => Promise<GitLabTimeline>; isMutating: boolean } {
  // mutation 端点与 timeline 查询键不同键，无法用 populateCache；改用上下文 mutate 跨键回写
  // revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训，mutation 键不触发竞态 GET），
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/gitlab/mrs/${iid}/comments`,
    (key: string, { arg }: { arg: GitLabCommentBody }) => postJson<GitLabTimeline>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const timeline = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/gitlab/mrs/${iid}/timeline`, timeline, { revalidate: false });
      return timeline;
    },
    isMutating,
  };
}

/** 提交 review（mutation）：POST …/gitlab/mrs/:iid/review，响应（刷新详情，reviewState 变化）显式回写 detail 缓存键 */
export function useSubmitGitlabReview(repoId: string, iid: number): { trigger: (body: GitLabReviewBody) => Promise<GitLabMrDetail>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/gitlab/mrs/${iid}/review`,
    (key: string, { arg }: { arg: GitLabReviewBody }) => postJson<GitLabMrDetail>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const detail = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/gitlab/mrs/${iid}`, detail, { revalidate: false });
      return detail;
    },
    isMutating,
  };
}

/** 合并 MR（mutation）：POST …/gitlab/mrs/:iid/merge，merged=true 时列表项与详情显式回写 state=merged（GitLab 合并后 state 迁移 merged，即「已合并」标识） */
export function useMergeGitlabMr(repoId: string, iid: number): { trigger: (body: GitLabMergeBody) => Promise<GitLabMrMergeResult>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/gitlab/mrs/${iid}/merge`,
    (key: string, { arg }: { arg: GitLabMergeBody }) => postJson<GitLabMrMergeResult>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const result = await trigger(body);
      // 仅成功合并才回写：hook 不知调用方当前筛选 state，全部列表键都按 iid 更新对应条目
      if (result.merged) {
        const markMerged = (list?: GitLabMrList): GitLabMrList | undefined =>
          list === undefined
            ? list
            : { mrs: list.mrs.map((m) => (m.iid === iid ? { ...m, state: 'merged' as const } : m)) };
        for (const state of GITLAB_MR_STATES) {
          await mutate(`/api/repos/${repoId}/gitlab/mrs?state=${state}`, markMerged, { revalidate: false });
        }
        await mutate(`/api/repos/${repoId}/gitlab/mrs/${iid}`, (detail?: GitLabMrDetail): GitLabMrDetail | undefined =>
          detail === undefined ? detail : { ...detail, state: 'merged' as const }, { revalidate: false });
      }
      return result;
    },
    isMutating,
  };
}

/** 检出 MR 分支（mutation）：POST …/gitlab/mrs/:iid/checkout（无请求体）；检出切换本地分支，跨键补刷 status（repo 域）与 branches 键（P3-D restore 先例） */
export function useCheckoutGitlabMr(repoId: string, iid: number): { trigger: () => Promise<GitLabMrCheckoutResult>; isMutating: boolean } {
  // 端点与 status/branches 查询键不同键：成功后经全局 mutate 重取两键（响应仅有 branchName，无可写数据）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/gitlab/mrs/${iid}/checkout`,
    (key: string) => postJson<GitLabMrCheckoutResult>(key, {}),
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
