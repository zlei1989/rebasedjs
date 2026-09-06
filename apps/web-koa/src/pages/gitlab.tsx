/**
 * GitLab 面板页容器：useGitlabStatus（驱动面板提示卡：未检测远程/未配置令牌）+ useGitlabMrs（opened/merged
 * Tab，缺省 opened；裁定不做 all）+ 选中 MR 后的 detail/timeline/files 条件 hooks（iid 为 null 挂 null key
 * 不发请求）+ 五个 mutation 注入 ui GitLabPanel（与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate）。
 * 顶部返回按钮回日志页；「刷新」按钮重取 mrs/detail/timeline/files 四键（照 P3-D console 页做法，
 * null key 的 mutate 为空转）；acting 并合五个 mutation 的 isMutating。
 * 新建 MR：Modal「确认即关+复位」（T5 裁定）——容器 onCreateMr 只 trigger + toast + 回写（hook 内已跨键
 * 前置插入 opened/all 列表），不要尝试关 Modal。
 * 错误处理：页面级查询错误按裁定分派——mrs AUTH_FAILED →「GitLab 认证失败」提示卡 + 去设置链接；
 * RATE_LIMITED → 限流提示；其余（含 detail/timeline/files 查询失败与 mutation 失败）toast。
 * checkout 跨键回写（status/branches）已内置于 hook：本容器挂 useRepoStatus/useBranches 订阅承接重取。
 */
import {
  useAddGitlabComment,
  useBranches,
  useCheckoutGitlabMr,
  useCreateGitlabMr,
  useGitlabMrDetail,
  useGitlabMrFiles,
  useGitlabMrs,
  useGitlabStatus,
  useGitlabTimeline,
  useMergeGitlabMr,
  useRepoStatus,
  useSubmitGitlabReview,
} from '@rebased/client';
import { ServiceError } from '@rebased/contracts';
import { GitLabPanel } from '@rebased/ui';
import { Alert, Button, Flex, Tabs, message } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/** 页面级查询错误分类（ServiceError 由客户端 http 层解析生成） */
const isAuthFailed = (err: unknown): boolean => err instanceof ServiceError && err.code === 'AUTH_FAILED';
const isRateLimited = (err: unknown): boolean => err instanceof ServiceError && err.code === 'RATE_LIMITED';

export function RepoGitlabPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: status, error: statusError } = useGitlabStatus(repoId);
  // opened/merged 两个 Tab（裁定：不做 all Tab，GitLab 完结态为 merged）；缺省 opened
  const [state, setState] = useState<'opened' | 'merged'>('opened');
  // 选中 MR iid；null 表示未选中（detail/timeline/files 挂 null key 不发请求）
  const [iid, setIid] = useState<number | null>(null);
  const { data: mrs, error: mrsError, isLoading: mrsLoading, mutate: mutateMrs } = useGitlabMrs(repoId, state);
  const { data: detail, error: detailError, mutate: mutateDetail } = useGitlabMrDetail(repoId, iid);
  const { data: timeline, error: timelineError, mutate: mutateTimeline } = useGitlabTimeline(repoId, iid);
  const { data: files, error: filesError, mutate: mutateFiles } = useGitlabMrFiles(repoId, iid);
  // mutation 需要非空 iid：仅在选中 MR（iid !== null，详情操作区已渲染）时才可能被触发，0 仅为挂载占位
  const { trigger: createMr, isMutating: creating } = useCreateGitlabMr(repoId);
  const { trigger: addComment, isMutating: commenting } = useAddGitlabComment(repoId, iid ?? 0);
  const { trigger: submitReview, isMutating: reviewing } = useSubmitGitlabReview(repoId, iid ?? 0);
  const { trigger: mergeMr, isMutating: merging } = useMergeGitlabMr(repoId, iid ?? 0);
  const { trigger: checkoutMr, isMutating: checkingOut } = useCheckoutGitlabMr(repoId, iid ?? 0);
  // branches 供新建 MR Modal 源/目标分支选择；checkout 跨键回写（status/branches）的订阅承接：本页挂载两键使重取生效
  const { data: branches } = useBranches(repoId);
  useRepoStatus(repoId);
  const acting = creating || commenting || reviewing || merging || checkingOut;
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection（既有容器做法）
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // SPA 同路由切换仓库（repoId 变化，组件实例复用）→ 复位 Tab 与选中 MR
  useEffect(() => {
    setState('opened');
    setIid(null);
  }, [repoId]);
  // 页面级查询错误一次性呈现：mrs AUTH_FAILED 由提示卡呈现（不 toast）；RATE_LIMITED 固定限流文案；其余 toast
  useEffect(() => {
    if (mrsError === undefined) return;
    if (isRateLimited(mrsError)) void message.error('GitLab API 限流，请稍后重试');
    else if (!isAuthFailed(mrsError)) void message.error(mrsError instanceof Error ? mrsError.message : String(mrsError));
  }, [mrsError]);
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
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {isAuthFailed(mrsError) ? (
        /* mrs 加载失败 AUTH_FAILED：提示卡 + 去设置链接（替代面板，避免无数据渲染） */
        <Alert
          type="error"
          showIcon
          data-testid="gitlab-auth-failed"
          message="GitLab 认证失败"
          description="令牌无效或已过期，请到设置中重新配置。"
          action={
            <Button size="small" onClick={() => navigate(`/repos/${repoId}/settings`)}>
              去设置
            </Button>
          }
        />
      ) : (
        <>
          {/* state Tab：opened/merged 两态切换（裁定不做 all） */}
          <Tabs
            activeKey={state}
            onChange={(key) => setState(key as 'opened' | 'merged')}
            items={[
              { key: 'opened', label: '打开' },
              { key: 'merged', label: '已合并' },
            ]}
          />
          <GitLabPanel
            status={status}
            mrs={mrs ?? { mrs: [] }}
            iid={iid}
            // SWR data 未加载时为 undefined：面板以 null 表示「加载中/暂无」（detail null → Spin，timeline/files null → 空态）
            detail={detail ?? null}
            timeline={timeline ?? null}
            files={files ?? null}
            branches={branches?.branches ?? []}
            loading={mrsLoading}
            acting={acting}
            onSelectMr={setIid}
            onRefresh={() => {
              void mutateMrs();
              void mutateDetail();
              void mutateTimeline();
              void mutateFiles();
            }}
            onCreateMr={(body) => {
              // T5 裁定：Modal 确认即关+复位——容器只 trigger + toast + 回写（hook 已跨键前置插入列表）
              createMr(body)
                .then((d) => void message.success(`已创建 MR #${d.iid}`))
                .catch(onError);
            }}
            onComment={(body) => {
              addComment({ body }).catch(onError);
            }}
            onReview={(event, body) => {
              // body 为空不带（照 gitlabReviewBodySchema 可选）
              submitReview({ event, ...(body !== undefined ? { body } : {}) }).catch(onError);
            }}
            onMerge={(squash) => {
              mergeMr({ squash })
                .then((r) => {
                  if (r.merged) void message.success(`MR #${iid} 已合并`);
                  else void message.warning(r.message);
                })
                .catch(onError);
            }}
            onCheckout={() => {
              checkoutMr()
                .then((r) => void message.success(`已检出 ${r.branchName}`))
                .catch(onError);
            }}
          />
        </>
      )}
    </Flex>
  );
}
