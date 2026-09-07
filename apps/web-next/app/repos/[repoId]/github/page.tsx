'use client';

/**
 * GitHub 面板页容器：useGithubStatus（驱动面板提示卡：未检测远程/未配置令牌）+ useGithubPrs（open/closed
 * Tab，缺省 open）+ 选中 PR 后的 detail/timeline/files/review-comments 条件 hooks（number 为 null 挂 null key 不发请求）
 * + 五个 mutation 注入 ui GitHubPanel（与 web-koa 容器同构）。
 * 顶部返回按钮回日志页；「刷新」按钮重取 prs/detail/timeline/files/review-comments 五键（照 P3-D console 页做法，
 * null key 的 mutate 为空转）；acting 并合五个 mutation 的 isMutating。
 * 错误处理：页面级查询错误按裁定分派——prs AUTH_FAILED →「GitHub 认证失败」提示卡 + 去设置链接；
 * RATE_LIMITED → 限流提示；其余（含 detail/timeline/files 查询失败与 mutation 失败）toast。
 * checkout 跨键回写（status/branches）已内置于 hook：本容器挂 useRepoStatus/useBranches 订阅承接重取。
 */
import {
  useAddGithubComment,
  useAddGithubPrReviewComment,
  useBranches,
  useCheckoutGithubPr,
  useGithubPrDetail,
  useGithubPrFiles,
  useGithubPrReviewComments,
  useGithubPrs,
  useGithubStatus,
  useGithubTimeline,
  useMergeGithubPr,
  useRepoStatus,
  useSubmitGithubReview,
} from '@rebased/client';
import { ServiceError } from '@rebased/contracts';
import { GitHubPanel } from '@rebased/ui';
import { Alert, Button, Flex, Tabs, message } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState, use } from 'react';

/** 页面级查询错误分类（ServiceError 由客户端 http 层解析生成） */
const isAuthFailed = (err: unknown): boolean => err instanceof ServiceError && err.code === 'AUTH_FAILED';
const isRateLimited = (err: unknown): boolean => err instanceof ServiceError && err.code === 'RATE_LIMITED';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: status, error: statusError } = useGithubStatus(repoId);
  // open/closed 两个 Tab（裁定：不做 all Tab）；缺省 open
  const [state, setState] = useState<'open' | 'closed'>('open');
  // 选中 PR 编号；null 表示未选中（detail/timeline/files 挂 null key 不发请求）
  const [number, setNumber] = useState<number | null>(null);
  const { data: prs, error: prsError, isLoading: prsLoading, mutate: mutatePrs } = useGithubPrs(repoId, state);
  const { data: detail, error: detailError, mutate: mutateDetail } = useGithubPrDetail(repoId, number);
  const { data: timeline, error: timelineError, mutate: mutateTimeline } = useGithubTimeline(repoId, number);
  const { data: files, error: filesError, mutate: mutateFiles } = useGithubPrFiles(repoId, number);
  // 行级评审评论：选中 PR 后条件拉取（number 为 null 挂 null key 不发请求）；添加后列表由 hook 显式回写
  const { data: reviewComments, mutate: mutateReviewComments } = useGithubPrReviewComments(repoId, number);
  // mutation 需要非空 number：仅在选中 PR（number !== null，详情操作区已渲染）时才可能被触发，0 仅为挂载占位
  const { trigger: addComment, isMutating: commenting } = useAddGithubComment(repoId, number ?? 0);
  const { trigger: submitReview, isMutating: reviewing } = useSubmitGithubReview(repoId, number ?? 0);
  const { trigger: mergePr, isMutating: merging } = useMergeGithubPr(repoId, number ?? 0);
  const { trigger: checkoutPr, isMutating: checkingOut } = useCheckoutGithubPr(repoId, number ?? 0);
  const { trigger: addReviewComment, isMutating: commentActing } = useAddGithubPrReviewComment(repoId, number ?? 0);
  // checkout 跨键回写（status/branches）的订阅承接：本页挂载两键使重取生效（数据不以本页展示为主）
  useRepoStatus(repoId);
  useBranches(repoId);
  const acting = commenting || reviewing || merging || checkingOut;
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection（既有容器做法）
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // SPA 同路由切换仓库（repoId 变化，组件实例复用）→ 复位 Tab 与选中 PR
  useEffect(() => {
    setState('open');
    setNumber(null);
  }, [repoId]);
  // 页面级查询错误一次性呈现：prs AUTH_FAILED 由提示卡呈现（不 toast）；RATE_LIMITED 固定限流文案；其余 toast
  useEffect(() => {
    if (prsError === undefined) return;
    if (isRateLimited(prsError)) void message.error('GitHub API 限流，请稍后重试');
    else if (!isAuthFailed(prsError)) void message.error(prsError instanceof Error ? prsError.message : String(prsError));
  }, [prsError]);
  useEffect(() => {
    if (detailError !== undefined) void message.error(detailError instanceof Error ? detailError.message : String(detailError));
  }, [detailError]);
  useEffect(() => {
    if (timelineError !== undefined) void message.error(timelineError instanceof Error ? timelineError.message : String(timelineError));
  }, [timelineError]);
  useEffect(() => {
    if (filesError !== undefined) void message.error(filesError instanceof Error ? filesError.message : String(filesError));
  }, [filesError]);
  useEffect(() => {
    if (statusError !== undefined) void message.error(statusError instanceof Error ? statusError.message : String(statusError));
  }, [statusError]);
  // 状态未就绪前不渲染主体（加载态壳层后续任务再补；失败已 toast，面板不可用时静默）
  if (status === undefined) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {isAuthFailed(prsError) ? (
        /* prs 加载失败 AUTH_FAILED：提示卡 + 去设置链接（替代面板，避免无数据渲染） */
        <Alert
          type="error"
          showIcon
          data-testid="github-auth-failed"
          message="GitHub 认证失败"
          description="令牌无效或已过期，请到设置中重新配置。"
          action={
            <Button size="small" onClick={() => router.push(`/repos/${repoId}/settings`)}>
              去设置
            </Button>
          }
        />
      ) : (
        <>
          {/* state Tab：open/closed 两态切换（裁定不做 all） */}
          <Tabs
            activeKey={state}
            onChange={(key) => setState(key as 'open' | 'closed')}
            items={[
              { key: 'open', label: '打开' },
              { key: 'closed', label: '已关闭' },
            ]}
          />
          <GitHubPanel
            status={status}
            prs={prs ?? { prs: [] }}
            number={number}
            // SWR data 未加载时为 undefined：面板以 null 表示「加载中/暂无」（detail null → Spin，timeline/files null → 空态）
            detail={detail ?? null}
            timeline={timeline ?? null}
            files={files ?? null}
            reviewComments={reviewComments ?? null}
            commentActing={commentActing}
            loading={prsLoading}
            acting={acting}
            onSelectPr={setNumber}
            onRefresh={() => {
              void mutatePrs();
              void mutateDetail();
              void mutateTimeline();
              void mutateFiles();
              void mutateReviewComments();
            }}
            onComment={(body) => {
              addComment({ body }).catch(onError);
            }}
            onAddReviewComment={(body) => {
              addReviewComment(body).catch(onError);
            }}
            onReview={(event, body) => {
              // body 为空不带（照 githubReviewBodySchema 可选）
              submitReview({ event, ...(body !== undefined ? { body } : {}) }).catch(onError);
            }}
            onMerge={(method) => {
              mergePr({ method })
                .then((r) => {
                  if (r.merged) void message.success(`PR #${number} 已合并`);
                  else void message.warning(r.message);
                })
                .catch(onError);
            }}
            onCheckout={() => {
              checkoutPr()
                .then((r) => void message.success(`已检出 ${r.branchName}`))
                .catch(onError);
            }}
          />
        </>
      )}
    </Flex>
  );
}
