// @vitest-environment node
/**
 * format 纯函数测试：带偏移/裸时间的串按原样截取；带 Z 的 UTC 串按本机时区换算
 * （命令日志、存档 mtime、托管平台 API 时间戳都是 Z 串——曾出现页面时间比本地时钟差一个时区）。
 */
import { describe, expect, it } from 'vitest';
import { formatAuthorLine, formatCommitDate } from './format';

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
