/**
 * 忽略配置对话框：target 二选（.gitignore / .git/info/exclude）+ 可编辑文本域 +
 * 模板下拉（选中即替换预览：文本域立即替换为模板 content，可继续编辑，手改后清除选中态）+
 * 确定（提交当前文本域内容，无变化也允许提交——幂等）/取消。
 *  纯受控组件：open/contents/templates 由父级注入；target/内容/模板选中为内部状态，
 *  取消与重开时复位（内容回到 contents 对应 target 的当前值）；确认提交本身不复位——
 *  失败时容器保持打开，编辑须保留供用户重试（对齐 RebaseDialog 的 P3-B 终审裁定）。
 */
import { useEffect, useState } from 'react';
import { Flex, Input, Modal, Radio, Select, Typography } from 'antd';
import type { IgnoreContents, IgnoreTemplate } from '@rebased/contracts';

/** 忽略目标：gitignore = 仓库根 .gitignore；exclude = .git/info/exclude（与契约 IgnorePutBody.target 一致） */
type IgnoreTarget = 'gitignore' | 'exclude';

export interface IgnoreDialogProps {
  open: boolean;
  contents: IgnoreContents;
  templates: IgnoreTemplate[];
  onOk: (target: 'gitignore' | 'exclude', content: string) => void;
  onCancel: () => void;
  /** 保存请求进行中：确定按钮 loading 且禁用 */
  confirming?: boolean;
}

export function IgnoreDialog({
  open,
  contents,
  templates,
  onOk,
  onCancel,
  confirming,
}: IgnoreDialogProps): React.ReactNode {
  const [target, setTarget] = useState<IgnoreTarget>('gitignore');
  const [content, setContent] = useState<string>(contents.gitignore);
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);

  /** 复位全部内部状态（关闭后重开时）：target 回 gitignore、内容回 contents 当前值、模板选中清空 */
  const reset = (): void => {
    setTarget('gitignore');
    setContent(contents.gitignore);
    setTemplateId(undefined);
  };

  /** 关闭 → 打开的每次转换都复位：容器在成功/取消时关窗，下次打开以最新 contents 重新开始 */
  useEffect(() => {
    if (open) reset();
  }, [open]);

  /** 取消：先复位再通知父级（Modal 默认不卸载子树，重开不能残留上次编辑） */
  const close = (): void => {
    reset();
    onCancel();
  };

  /** target 切换：文本域随 target 显示 contents 对应内容，模板选中清空（模板选择只作用于当前 target） */
  const switchTarget = (next: IgnoreTarget): void => {
    setTarget(next);
    setContent(contents[next]);
    setTemplateId(undefined);
  };

  /** 模板选中即替换预览：文本域替换为模板 content（继续编辑可再改）；模板 id 未命中则忽略 */
  const pickTemplate = (id: string): void => {
    const tpl = templates.find((t) => t.id === id);
    if (tpl === undefined) return;
    setContent(tpl.content);
    setTemplateId(id);
  };

  /** 手改文本域：内容以当前编辑为准，模板选中态清空（内容已不再等于模板） */
  const changeContent = (value: string): void => {
    setContent(value);
    setTemplateId(undefined);
  };

  return (
    <Modal
      title="忽略配置"
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={confirming}
      okButtonProps={{ disabled: confirming }}
      onOk={() => onOk(target, content)}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Radio.Group value={target} onChange={(e) => switchTarget(e.target.value as IgnoreTarget)}>
          <Flex gap={16}>
            <Radio value="gitignore">.gitignore</Radio>
            <Radio value="exclude">.git/info/exclude</Radio>
          </Flex>
        </Radio.Group>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">模板：</Typography.Text>
          <Select
            data-testid="ignore-template-select"
            style={{ flex: 1 }}
            placeholder="选择模板（选中即替换内容）"
            value={templateId}
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
            onChange={pickTemplate}
          />
        </Flex>
        <Input.TextArea
          data-testid="ignore-content"
          rows={10}
          value={content}
          onChange={(e) => changeContent(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}
