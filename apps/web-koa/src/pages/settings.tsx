/**
 * 设置页容器：useSettings + useRepoConfig + useSetConfig 注入 ui SettingsPage（与 web-next 容器同构；
 * repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。保存失败经 message.error 呈现。
 */
import { useRepoConfig, useSetConfig, useSettings } from '@rebased/client';
import { SettingsPage } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoSettingsPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const { data: config } = useRepoConfig(repoId);
  const { trigger } = useSetConfig(repoId);
  // 保存失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，ConfigRow 行内输入 state 随之重置 */}
      <SettingsPage
        key={repoId}
        settings={settings}
        onPatchSettings={(patch) => update(patch).catch(onError)}
        config={config}
        onSetConfig={(key, value) => trigger({ key, value }).catch(onError)}
      />
    </Flex>
  );
}
