import { describe, expect, it } from 'vitest';
import { relativeToHome } from './repo-page-utils';

describe('relativeToHome', () => {
  it('主目录下的路径显示为 ~/…', () => {
    expect(relativeToHome('/home/user/proj', '/home/user')).toBe('~/proj');
  });

  it('多级子路径保留相对段', () => {
    expect(relativeToHome('/home/user/a/b/c', '/home/user')).toBe('~/a/b/c');
  });

  it('路径等于主目录时显示 ~', () => {
    expect(relativeToHome('/home/user', '/home/user')).toBe('~');
  });

  it('主目录外的路径原样返回', () => {
    expect(relativeToHome('/opt/repo', '/home/user')).toBe('/opt/repo');
  });

  it('仅前缀相同但非目录边界不误判（/home/user2 不属于 /home/user）', () => {
    expect(relativeToHome('/home/user2/repo', '/home/user')).toBe('/home/user2/repo');
  });

  it('Windows 反斜杠分隔符归一化后匹配', () => {
    expect(relativeToHome(String.raw`C:\Users\me\repo`, String.raw`C:\Users\me`)).toBe('~/repo');
  });

  it('主目录带尾部分隔符也能匹配', () => {
    expect(relativeToHome('/home/user/proj', '/home/user/')).toBe('~/proj');
  });

  it('homeDir 为空时原样返回', () => {
    expect(relativeToHome('/home/user/proj', '')).toBe('/home/user/proj');
  });
});
