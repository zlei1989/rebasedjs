/**
 * 端点入参 schema：路由/服务层用 zod 校验 HTTP 查询与请求体，解析结果即类型。
 * 查询参数走字符串，故数值用 coerce 宽容转换；布尔不用 coerce（'false' 会被当成 true），见 diffQuerySchema.staged。
 */
import { z } from 'zod';
import { CONFIG_KEYS } from './domain';

export const openRepoBodySchema = z.object({ path: z.string().min(1) });
export type OpenRepoBody = z.infer<typeof openRepoBodySchema>;

export const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  author: z.string().optional(),
  path: z.string().optional(),
});
export type LogQuery = z.infer<typeof logQuerySchema>;

export const diffQuerySchema = z.object({
  file: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  // 查询串布尔：z.coerce.boolean() 会把 'false' 当成 true（Boolean('false')），
  // 故显式枚举 'true'/'false' 转换；同时兼容内部调用直接传 boolean
  staged: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(false),
});
export type DiffQuery = z.infer<typeof diffQuerySchema>;

export const settingsPatchSchema = z.object({
  logInEditor: z.boolean().optional(),
  recentRepoIds: z.array(z.string()).optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** 配置写请求体：键限白名单；值为字符串（布尔类键由调用方传 'true'/'false' 等 git 原样接受） */
export const configPutBodySchema = z.object({
  key: z.enum(CONFIG_KEYS),
  value: z.string().min(1).max(500),
});
export type ConfigPutBody = z.infer<typeof configPutBodySchema>;

/** 暂存区文件级操作：stage=加入暂存（git add）；unstage=移出暂存（git restore --staged）；discard=放弃修改（按条目状态分派 restore/clean） */
export const stagingBodySchema = z.object({
  action: z.enum(['stage', 'unstage', 'discard']),
  paths: z.array(z.string().min(1)).min(1),
});
export type StagingBody = z.infer<typeof stagingBodySchema>;

/** hunk 级操作：hunks 为 GET diff/patch 返回全文的 hunk 索引（0-based，按出现顺序） */
export const hunkStagingBodySchema = z.object({
  action: z.enum(['stage', 'unstage', 'discard']),
  file: z.string().min(1),
  hunks: z.array(z.number().int().min(0)).min(1),
});
export type HunkStagingBody = z.infer<typeof hunkStagingBodySchema>;

/** 提交请求体：message 必填；amend 改上次提交；signOff 追加 Signed-off-by；noVerify 跳过 hooks */
export const commitBodySchema = z.object({
  message: z.string().min(1),
  amend: z.boolean().optional(),
  signOff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
});
export type CommitBody = z.infer<typeof commitBodySchema>;
