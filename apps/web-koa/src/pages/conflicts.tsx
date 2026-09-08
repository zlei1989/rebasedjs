/**
 * 冲突页容器：useConflicts + useResolveConflict + useContinueOperation + useOperation 注入 ui ConflictsPanel
 * （与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。
 * 「手动合并」开全屏 Modal 包 MergeView（选中 path → useConflictContents 拉三版本内容 → onSave 走 manual 解决 → 关 Modal）；
 * 「继续」→ useContinueOperation（按 operation.kind 分派 merge/rebase/cherry-pick/revert，success 返回日志页；
 * 按钮文案由 operationKind 透传 ConflictsPanel 泛化——merge→完成合并/其他→继续xx）；操作失败统一 message.error。
 * 本页自订阅 events（仓库作用域页面一致性约定）：外部 CLI git add 解决冲突时重验证冲突列表；
 * 中止操作不在本页做——由日志页 OperationStatus 操作条承接（P2-A），故 operation 仅用于展示进行中提示与 continue 分派。
 */
import {
  useConflictContents,
  useConflicts,
  useContinueOperation,
  useOperation,
  useRepoEvents,
  useResolveConflict,
  useSkipOperation,
} from '@rebased/client';
import { ConflictsPanel, MergeView, continueKindLabel } from '@rebased/ui';
import { Button, Flex, message, Modal, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoConflictsPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: conflictList, mutate: mutateConflicts } = useConflicts(repoId);
  const { data: operation } = useOperation(repoId);
  const { trigger: resolveConflict, isMutating: resolving } = useResolveConflict(repoId);
  const { trigger: continueOperation, isMutating: continuing } = useContinueOperation(repoId);
  const { trigger: skipOperation, isMutating: skipping } = useSkipOperation(repoId);
  // 手动合并目标路径；'' 表示 Modal 关闭（useConflictContents 空串挂 null key 不发请求，可无条件挂载）
  const [mergePath, setMergePath] = useState('');
  const { data: contents } = useConflictContents(repoId, mergePath);
  // 外部 CLI git add 标记已解决 → 冲突列表需重验证（watcher 对 index 变化产 repo.state-changed）
  useRepoEvents(repoId, { onStatus: () => void mutateConflicts() });
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // react-router v7 navigate 可能返回 Promise：包函数体固定 void 返回
  const back = (): void => {
    void navigate(`/repos/${repoId}`);
  };
  // MergeView 保存：manual 策略提交合并结果全文（响应已回写 conflicts 缓存），成功关 Modal
  const onSaveMerge = (path: string, content: string): void => {
    resolveConflict({ strategy: 'manual', path, content })
      .then(() => setMergePath(''))
      .catch(onError);
  };
  // 继续操作：全部解决后按 operation.kind 分派（merge/rebase/cherry-pick/revert）执行 --continue，
  // 成功返回日志页（响应已由 useContinueOperation 回写 status 缓存）；文案按操作种类泛化
  const onContinue = (): void => {
    continueOperation()
      .then(() => {
        void message.success('操作完成');
        back();
      })
      .catch(onError);
  };
  // 进行中操作名词（提示文案用）：merge→合并、rebase→变基、cherry-pick→摘樱桃、revert→还原；none→空
  const progressName = (kind: string | undefined): string => {
    switch (kind) {
      case 'rebase':
        return '变基';
      case 'cherry-pick':
        return '摘樱桃';
      case 'revert':
        return '还原';
      default:
        return '合并';
    }
  };
  // 冲突列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!conflictList) return null;
  return (
    <Flex vertical align="flex-start" style={{ height: '100%' }}>
      {/* 返回日志页 */}
      <Button type="link" onClick={back}>
        返回日志
      </Button>
      {/* 进行中操作提示：中止入口在日志页操作条（P2-A），本页只做展示；文案按 kind 泛化（merge→完成合并/其他→继续xx） */}
      {operation && operation.kind !== 'none' ? (
        <Typography.Text type="secondary" style={{ padding: '0 16px' }}>
          {progressName(operation.kind)}进行中：解决全部冲突后点击「{continueKindLabel(operation.kind)}」；中止请返回日志页操作条。
        </Typography.Text>
      ) : null}
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板状态随之重置 */}
      <ConflictsPanel
        key={repoId}
        conflicts={conflictList}
        resolving={resolving}
        continuing={continuing}
        operationKind={operation?.kind}
        onResolve={(body) => {
          resolveConflict(body).catch(onError);
        }}
        onOpenMergeView={setMergePath}
        onContinue={onContinue}
        // skip：rebase/cherry-pick/revert 冲突时丢弃当前提交的变更继续后续（merge 无 skip 概念不渲染）
        onSkip={
          operation && operation.kind !== 'none' && operation.kind !== 'merge'
            ? () => {
              skipOperation()
                .then(() => {
                  void message.success('已跳过');
                  back();
                })
                .catch(onError);
            }
            : undefined
        }
      />
      {/* 手动合并全屏 Modal：仅包 MergeView 内容区；destroyOnHidden 关闭即卸载 Monaco 与编辑态 */}
      <Modal
        title={`手动合并：${mergePath}`}
        open={mergePath !== ''}
        footer={null}
        onCancel={() => setMergePath('')}
        width="100%"
        style={{ top: 0, maxWidth: '100vw', margin: 0, paddingBottom: 0 }}
        styles={{ body: { height: 'calc(100vh - 110px)' } }}
        destroyOnHidden
      >
        {contents ? <MergeView contents={contents} onSave={onSaveMerge} saving={resolving} /> : '加载中…'}
      </Modal>
    </Flex>
  );
}
