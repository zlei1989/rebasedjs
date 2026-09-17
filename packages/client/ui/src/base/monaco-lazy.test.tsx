/**
 * monaco-lazy 的 React 集成测试：mock 掉 monaco-editor，只记录 create/dispose 调用序列。
 * 关注点只有一个——**不得出现「刚建好就被销毁」的 diff 编辑器**：
 * React 严格模式（开发态把每个 effect 走一遍「挂载 → 卸载 → 再挂载」）会在同一 tick 内
 * 建好编辑器又拆掉，而它的 diff 计算已经在 Monaco worker 里起飞；模型一销毁，
 * 该计算就以 `Canceled`（worker 客户端被回收）或 `no diff result available`（worker 侧模型被摘除）
 * 拒绝，拒绝又没人接管 → 页面控制台报错（实测 stack 落在 Monaco 的 computeDiff）。
 * 因此本文件锁定两条行为：① 严格模式双调用只建一次；② 创建落地前卸载就不建。
 */
import { StrictMode, act } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** mock monaco 的事件账本（vi.hoisted：vi.mock 工厂先于模块体执行，账本必须同步提升） */
const ledger = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('monaco-editor', () => {
  const record = (event: string): void => {
    ledger.events.push(event);
  };
  /**
   * 语言服务桩：monaco-lazy 在**模块作用域**就会关掉它们的 worker 能力（否则打开 .js/.ts 文件时
   * worker 侧解析 `vs/language/typescript/tsWorker.js` 会抛 toUrl），故这里必须存在且可记账。
   * 记账内容 = 「哪些能力还开着」：`mode.<languageId>:<保留的字段>`。
   */
  const makeDefaults = (languageId: string, modeConfiguration: Record<string, boolean>) => ({
    languageId,
    modeConfiguration,
    setModeConfiguration: (next: Record<string, boolean>): void => {
      record(`mode.${languageId}:${Object.keys(next).filter((key) => next[key]).join(',')}`);
    },
  });
  /** 最小编辑器桩：diff 模式与单编辑器模式共用，dispose 只记账 */
  const makeEditor = () => ({
    setModel: () => {},
    getModel: () => null,
    getValue: () => '',
    setValue: () => {},
    onDidChangeModelContent: () => ({ dispose: () => {} }),
    dispose: () => record('editor.dispose'),
  });
  return {
    editor: {
      createDiffEditor: () => {
        record('diff.create');
        return makeEditor();
      },
      create: () => {
        record('editor.create');
        return makeEditor();
      },
      createModel: () => {
        record('model.create');
        return { getValue: () => '', setValue: () => {}, dispose: () => record('model.dispose') };
      },
      setTheme: () => {},
    },
    languages: {
      css: {
        cssDefaults: makeDefaults('css', { completionItems: true, colors: true, diagnostics: true }),
        lessDefaults: makeDefaults('less', { completionItems: true, diagnostics: true }),
        scssDefaults: makeDefaults('scss', { completionItems: true, diagnostics: true }),
      },
      html: {
        htmlDefaults: makeDefaults('html', { completionItems: true, diagnostics: true }),
        razorDefaults: makeDefaults('razor', { completionItems: true }),
        handlebarDefaults: makeDefaults('handlebar', { completionItems: true }),
      },
      json: { jsonDefaults: makeDefaults('json', { completionItems: true, tokens: true, diagnostics: true }) },
      typescript: {
        typescriptDefaults: makeDefaults('typescript', { completionItems: true, diagnostics: true }),
        javascriptDefaults: makeDefaults('javascript', { completionItems: true, diagnostics: true }),
      },
    },
  };
});

import MonacoLazy from './monaco-lazy';

/** 冲刷一个宏任务：让「创建被推迟到下一个宏任务」的实现在断言前落地 */
async function flushMacrotask(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** 事件账本中某类事件的次数 */
function countOf(event: string): number {
  return ledger.events.filter((item) => item === event).length;
}

describe('monaco-lazy 编辑器的创建时机', () => {
  beforeEach(() => {
    ledger.events.length = 0;
  });

  it('严格模式双调用下只创建一个 diff 编辑器（不产生建完即弃的实例）', async () => {
    render(
      <StrictMode>
        <MonacoLazy original="a" modified="b" />
      </StrictMode>,
    );
    await flushMacrotask();
    expect(countOf('diff.create')).toBe(1);
    expect(countOf('editor.dispose')).toBe(0);
    // 只有一份模型（两个），被丢弃的那次挂载不应留下模型创建/销毁的痕迹
    expect(countOf('model.create')).toBe(2);
    expect(countOf('model.dispose')).toBe(0);
  });

  it('创建落地前卸载：一个编辑器都不建（避免孤儿 diff 计算）', async () => {
    const { unmount } = render(<MonacoLazy original="a" modified="b" />);
    unmount();
    await flushMacrotask();
    expect(ledger.events).toEqual([]);
  });

  it('正常挂载后卸载：创建一次、随卸载销毁一次（清理不泄漏）', async () => {
    const { unmount } = render(<MonacoLazy original="a" modified="b" />);
    await flushMacrotask();
    expect(countOf('diff.create')).toBe(1);
    unmount();
    expect(countOf('editor.dispose')).toBe(1);
    expect(countOf('model.dispose')).toBe(2);
  });

  it('挂载后文本变化不重建编辑器（创建只随 language 变化）', async () => {
    const { rerender } = render(<MonacoLazy original="a" modified="b" />);
    await flushMacrotask();
    rerender(<MonacoLazy original="a2" modified="b2" />);
    await flushMacrotask();
    expect(countOf('diff.create')).toBe(1);
  });
});

/**
 * 模块作用域的装配行为：worker 入口 + 语言服务裁剪。
 * 这两件事发生在 import 那一刻（早于任何 beforeEach），要观察到就得重置模块注册表后重新 import。
 */
describe('monaco-lazy 的模块级装配', () => {
  beforeEach(() => {
    ledger.events.length = 0;
  });

  it('关掉四个语言服务（含 less/scss/razor/handlebars）里所有走 worker 的能力，只给 JSON 留 tokens', async () => {
    vi.resetModules();
    await import('./monaco-lazy');
    // 留下任何一项都意味着对应的语言服务会 createWebWorker → worker 侧解析语言模块 URL 失败
    expect(ledger.events).toEqual([
      'mode.css:',
      'mode.less:',
      'mode.scss:',
      'mode.html:',
      'mode.razor:',
      'mode.handlebar:',
      'mode.json:tokens',
      'mode.typescript:',
      'mode.javascript:',
    ]);
  });

  it('装配 MonacoEnvironment.getWorker 作为 worker 入口', () => {
    // 上面的静态 import 已经跑过模块作用域，这里断言装配结果即可（jsdom 没有 Worker，不实际创建）
    expect(typeof window.MonacoEnvironment?.getWorker).toBe('function');
  });
});
