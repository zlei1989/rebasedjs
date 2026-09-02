/**
 * Koa 应用：中间件装配（错误 → bodyparser → 路由 → 静态托管）。
 * 直接运行（tsx src/app.ts，即 dev 脚本）时监听 3031 并打启动日志；
 * 作为模块导入（测试用 app.callback()）不监听。
 */
import { bodyParser } from '@koa/bodyparser';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Koa from 'koa';
import serve from 'koa-static';
import { errorHandler } from './middleware/error';
import { router } from './routes/repos';

const app = new Koa();
app.use(errorHandler);
app.use(bodyParser());
app.use(router.routes());
// 生产静态托管：vite build 产物 public/（dev 由 Vite 5173 代理）；目录不存在时跳过挂载
if (existsSync('public')) app.use(serve('public'));

// 主模块判定：tsx（含 watch）直接运行时 argv[1] 即本文件；测试/被导入时 argv[1] 为 vitest 等入口
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = 3031;
  app.listen(port, () => {
    console.log(`[web-koa] listening on http://localhost:${port}`);
  });
}

export { app };
