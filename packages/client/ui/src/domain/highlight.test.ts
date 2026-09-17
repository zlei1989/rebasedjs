/**
 * 补丁行标注纯函数测试：按行前缀给每行贴 kind（@@ 头 / + 增 / - 删 / 上下文 / \ No newline / 空行）。
 * 为什么需要它：整块补丁要一次性交给高亮器（跨行语法上下文不能被切断），
 * 于是「哪一行是新增、哪一行是删除」只能在切完行之后逐行补——本函数就是那份行元数据。
 */
import { describe, expect, it } from 'vitest';
import { decoratePatchLines, renderHighlightLines } from './highlight';

describe('decoratePatchLines', () => {
  it('hunk 头、增删、上下文分别标注', () => {
    const lines = decoratePatchLines('@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n');
    expect(lines.map((l) => [l.kind, l.content])).toEqual([
      ['hunk', '@@ -1,2 +1,2 @@'],
      ['context', ' ctx'],
      ['remove', '-old'],
      ['add', '+new'],
    ]);
  });

  it('每行 content 保留原始前缀（去掉的话前缀着色没有载体）', () => {
    expect(decoratePatchLines('+x')[0].content).toBe('+x');
    expect(decoratePatchLines('-x')[0].content).toBe('-x');
  });

  it('`\\ No newline at end of file` 标为 noNewline', () => {
    const lines = decoratePatchLines('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n');
    expect(lines.map((l) => l.kind)).toEqual(['hunk', 'remove', 'noNewline', 'add']);
  });

  it('空行标为 blank；行内空白不丢', () => {
    const lines = decoratePatchLines('\n   \n\ttab\n');
    expect(lines.map((l) => l.kind)).toEqual(['blank', 'context', 'context']);
    expect(lines[1].content).toBe('   ');
    expect(lines[2].content).toBe('\ttab');
  });

  it('末行无换行也保留；空文本 → 空数组；单个换行 → 一行空行', () => {
    expect(decoratePatchLines('+tail').map((l) => l.content)).toEqual(['+tail']);
    expect(decoratePatchLines('')).toEqual([]);
    expect(decoratePatchLines('\n').map((l) => l.kind)).toEqual(['blank']);
  });

  it('CRLF 补丁：按 \\n 切行并剥掉行尾 \\r（还原 \r 会以字面控制符渲染进 pre）', () => {
    expect(decoratePatchLines('+a\r\n-b\r\n')).toEqual([
      { kind: 'add', content: '+a' },
      { kind: 'remove', content: '-b' },
    ]);
    // 单独的 \r 不是换行：不带 \n 时仍留在行内
    expect(decoratePatchLines('+a\r')).toEqual([{ kind: 'add', content: '+a\r' }]);
  });
});

describe('renderHighlightLines', () => {
  it('双主题 token 的 htmlStyle 整体进 style（浅色不是 token.color——写错会产出 color:undefined）', () => {
    const html = renderHighlightLines([[{ content: 'const', htmlStyle: { color: '#D73A49', '--shiki-dark': '#F97583' } }]]);
    expect(html).toContain('style="color:#D73A49;--shiki-dark:#F97583"');
    expect(html).not.toContain('undefined');
  });

  it('无样式 token 不写 style 属性', () => {
    expect(renderHighlightLines([[{ content: 'x' }]])).toBe('<span class="line"><span class="code">x</span></span>');
  });

  it('补丁行挂 data-kind 与行首标记（前缀与 unified diff 同字符）', () => {
    const lines = decoratePatchLines('@@ -1 +1 @@\n ctx\n-old\n+new\n\\ No newline at end of file\n');
    const tokens = lines.map((line) => [{ content: line.content }]);
    const html = renderHighlightLines(tokens, lines);
    expect(html).toContain('<span class="line" data-kind="hunk">');
    expect(html).toContain('<span class="line" data-kind="context"><span class="diff-marker"> </span>');
    expect(html).toContain('<span class="line" data-kind="remove"><span class="diff-marker">-</span>');
    expect(html).toContain('<span class="line" data-kind="add"><span class="diff-marker">+</span>');
    expect(html).toContain('<span class="line" data-kind="noNewline"><span class="diff-marker">\\</span>');
  });

  it('行数与 token 行数一致，行之间以换行分隔；HTML 特殊字符转义', () => {
    const html = renderHighlightLines([[{ content: '<a>' }], [{ content: '&' }]]);
    expect(html.split('\n')).toHaveLength(2);
    expect(html).toContain('&lt;a&gt;');
    expect(html).toContain('&amp;');
  });
});
