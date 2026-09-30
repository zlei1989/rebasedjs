// @vitest-environment node
/**
 * format 纯函数测试：带偏移/裸时间的串按原样截取；带 Z 的 UTC 串按本机时区换算
 * （命令日志、存档 mtime、托管平台 API 时间戳都是 Z 串——曾出现页面时间比本地时钟差一个时区）。
 */
import { describe, expect, it } from 'vitest';
import { formatAuthorLine, formatCommitDate, formatRelativeTime } from './format';

describe('formatCommitDate', () => {
  it('带时区偏移的串原样截取（git author date 保留作者当时墙上时间）', () => {
    expect(formatCommitDate('2026-08-01T10:30:00+08:00')).toBe('2026-08-01 10:30');
    expect(formatCommitDate('2026-08-01T10:30:45-05:00')).toBe('2026-08-01 10:30');
  });

  it('带 Z 的 UTC 串换算为本机时区墙上时间（不出现 UTC 时刻）', () => {
    const iso = '2026-01-02T03:04:00Z';
    const formatted = formatCommitDate(iso);
    // 无偏移的 "YYYY-MM-DDTHH:mm" 按本机时区解析——回读应等于同一时刻，证明输出即本机墙上时间
    expect(new Date(formatted.replace(' ', 'T')).getTime()).toBe(new Date(iso).getTime());
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('非法/无法解析的串原样返回', () => {
    expect(formatCommitDate('')).toBe('');
    expect(formatCommitDate('not-a-date')).toBe('not-a-date');
    expect(formatCommitDate('2026-01-02T99:99Z')).toBe('2026-01-02T99:99Z');
  });
});

describe('formatRelativeTime（注解行时间列的缩写）', () => {
  // 「现在」固定注入，断言才不受运行时刻影响；输入用相对该时刻的偏移构造
  const now = Date.parse('2026-09-30T04:00:00Z');
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const ago = (ms: number): string => new Date(now - ms).toISOString();

  it('五档缩写：刚刚 / 分钟 / 小时 / 天 / 月 / 年', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('刚刚');
    expect(formatRelativeTime(ago(59 * MIN), now)).toBe('59分钟前');
    expect(formatRelativeTime(ago(23 * HOUR), now)).toBe('23小时前');
    expect(formatRelativeTime(ago(31 * DAY), now)).toBe('31天前');
    expect(formatRelativeTime(ago(365 * DAY), now)).toBe('1年前');
    expect(formatRelativeTime(ago(730 * DAY), now)).toBe('2年前');
  });

  it('天与月的切点在 31 天：32 天起给「N月前」，且月数至少为 1（不出现「0月前」）', () => {
    // 用户口径的示例里「31天前」与「1月前」都要能出现——故按 31 天切，而不是 30 天
    expect(formatRelativeTime(ago(32 * DAY), now)).toBe('1月前');
    expect(formatRelativeTime(ago(59 * DAY), now)).toBe('1月前');
    expect(formatRelativeTime(ago(60 * DAY), now)).toBe('2月前');
    expect(formatRelativeTime(ago(364 * DAY), now)).toBe('12月前');
  });

  it('未来时刻（时钟偏差）按「刚刚」，不给负数', () => {
    expect(formatRelativeTime(new Date(now + 5 * MIN).toISOString(), now)).toBe('刚刚');
  });

  it('无法解析的串原样返回（与 formatCommitDate 同口径：不猜）', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date');
    expect(formatRelativeTime('', now)).toBe('');
  });
});

describe('formatAuthorLine', () => {
  it('偏移串拼成 "{author} on {date} at {time}"', () => {
    expect(formatAuthorLine('Alice', '2026-09-01T14:30:00+08:00')).toBe('Alice on 2026-09-01 at 14:30');
  });

  it('Z 串同样按本机时区换算后拼装', () => {
    const iso = '2026-01-02T03:04:00Z';
    const line = formatAuthorLine('Bob', iso);
    const time = line.replace('Bob on ', '').replace(' at ', 'T');
    expect(new Date(time).getTime()).toBe(new Date(iso).getTime());
  });

  it('无法解析的串退化为 "{author} on {raw}"', () => {
    expect(formatAuthorLine('Alice', 'unknown')).toBe('Alice on unknown');
  });
});
