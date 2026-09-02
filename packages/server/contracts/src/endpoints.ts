/**
 * 端点入参 schema：路由/服务层用 zod 校验 HTTP 查询与请求体，解析结果即类型。
 * 查询参数走字符串，故数值用 coerce 宽容转换；布尔不用 coerce（'false' 会被当成 true），见 diffQuerySchema.staged。
 */
import { z } from 'zod';

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
