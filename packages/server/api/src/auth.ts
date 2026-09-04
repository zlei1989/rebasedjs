/**
 * 账户/令牌存储：应用层簿记，明文 token 持久化在应用配置（config.json，0600）。
 * 安全约束：token 本体绝不离开本模块的出口——三个公开函数只返回掩码视图
 * （tokenPreview = 前 4 位 + '***'）；日志亦不得打印 token。
 * 明文落盘的取舍见 config-store.ts 的 StoredAccount 注释。
 */
import type { AccountBody, AccountDeleteBody, AccountList } from '@rebased/contracts';
import { normalizeHost, ServiceError } from '@rebased/contracts';
import type { StoredAccount } from './lib/config-store';
import { loadConfig, saveConfig } from './lib/config-store';

/** token → 掩码预览：前 4 位 + '***'；长度 ≤4 时全掩码 '***'（避免短 token 整体泄露） */
function maskToken(token: string): string {
  return token.length <= 4 ? '***' : `${token.slice(0, 4)}***`;
}

/** 内部簿记 → 对外掩码视图（token 字段在此被丢弃，绝不随响应下行） */
function toView(accounts: StoredAccount[]): AccountList {
  return { accounts: accounts.map(({ host, account, token }) => ({ host, account, tokenPreview: maskToken(token) })) };
}

/** 账户列表（掩码视图）：token → tokenPreview（前 4 位 + '***'；长度 ≤4 时全掩码 '***'） */
export function listAccounts(): AccountList {
  return toView(loadConfig().auth?.accounts ?? []);
}

/**
 * 仅服务端内部使用，永不出现在响应/日志：按规范化 host 取回明文 token（认证回路注入用）。
 * 不经掩码出口，index.ts 不出口——同层模块直接 import './auth'。
 * 查找键遵循 normalizeHost 唯一约定（存侧可能大小写/形态不规整，查侧已规范化，两侧比对前统一归一）。
 */
export function findToken(host: string): string | null {
  const accounts = loadConfig().auth?.accounts ?? [];
  const match = accounts.find((a) => normalizeHost(a.host) === host);
  return match?.token ?? null;
}

/** 添加/覆盖账户（同 host+account 覆盖）；返回刷新掩码视图 */
export function upsertAccount(body: AccountBody): AccountList {
  const config = loadConfig();
  config.auth ??= { accounts: [] };
  const existing = config.auth.accounts.findIndex((a) => a.host === body.host && a.account === body.account);
  const entry: StoredAccount = { host: body.host, account: body.account, token: body.token };
  if (existing >= 0) {
    config.auth.accounts[existing] = entry;
  } else {
    config.auth.accounts.push(entry);
  }
  saveConfig(config);
  return toView(config.auth.accounts);
}

/** 删除账户（不存在 → ServiceError('INVALID_QUERY', '账户不存在：…')）；返回刷新掩码视图 */
export function deleteAccount(body: AccountDeleteBody): AccountList {
  const config = loadConfig();
  const accounts = config.auth?.accounts ?? [];
  const index = accounts.findIndex((a) => a.host === body.host && a.account === body.account);
  if (index < 0) {
    throw new ServiceError('INVALID_QUERY', `账户不存在：${body.host}/${body.account}`, {
      context: { host: body.host, account: body.account },
    });
  }
  accounts.splice(index, 1);
  saveConfig(config);
  return toView(accounts);
}
