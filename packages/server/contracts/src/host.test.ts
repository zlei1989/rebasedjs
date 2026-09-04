import { describe, expect, it } from 'vitest';
import { normalizeHost } from './host';

describe('normalizeHost（host 规范化：auth 账户存查与 token 注入的唯一键）', () => {
  it('https URL：去协议、路径与 .git 后缀', () => {
    expect(normalizeHost('https://github.com/user/repo.git')).toBe('github.com');
    expect(normalizeHost('https://gitlab.example.com/group/proj')).toBe('gitlab.example.com');
  });

  it('scp 式 SSH（git@host:path）：取冒号前的主机、去用户', () => {
    expect(normalizeHost('git@github.com:user/repo.git')).toBe('github.com');
  });

  it('ssh URL（ssh://git@host/path）：去协议与用户', () => {
    expect(normalizeHost('ssh://git@github.com/user/repo.git')).toBe('github.com');
  });

  it('大小写归一：主机名一律小写', () => {
    expect(normalizeHost('GitHub.com')).toBe('github.com');
    expect(normalizeHost('HTTPS://GitHub.COM/User/Repo.git')).toBe('github.com');
  });

  it('端口剥离：github.com:443 与默认端口视为同一账户', () => {
    expect(normalizeHost('github.com:443')).toBe('github.com');
    expect(normalizeHost('https://github.com:8443/user/repo.git')).toBe('github.com');
  });

  it('尾斜杠与纯主机串', () => {
    expect(normalizeHost('github.com/')).toBe('github.com');
    expect(normalizeHost('github.com')).toBe('github.com');
  });

  it('非法输入：原样小写返回（不抛错，保证存查一致）', () => {
    expect(normalizeHost('not a url')).toBe('not a url');
    expect(normalizeHost('EXAMPLE')).toBe('example');
  });
});
