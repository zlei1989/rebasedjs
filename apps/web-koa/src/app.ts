/**
 * Koa 应用：中间件装配（错误 → bodyparser → 路由 → 静态托管）。
 * 直接运行（tsx src/app.ts，即 dev 脚本）时监听 3082 并打启动日志；
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
import { InvalidRequestBodyError } from './server-context';

const app = new Koa();
app.use(errorHandler);
// bodyparser 的解析失败用它的 onError 钩子精确标记为 InvalidRequestBodyError：
// 只有「请求体解析失败」会被映射成 400「请求体不是合法 JSON」，服务端内部其它 SyntaxError
// 走 toServiceError 的 500 可读原因（冒烟 D-42）。注意 bodyparser 抛的不是 SyntaxError 实例，
// 故不能再靠 `instanceof SyntaxError` 判断（旧写法在 koa 侧实为死分支）。
app.use(
  bodyParser({
    // encoding 是该库类型的必填项，值与库内默认一致（restOpts.encoding || 'utf-8'）
    encoding: 'utf-8',
    onError: (err: unknown): never => {
      throw new InvalidRequestBodyError(err);
    },
  }),
);
app.use(router.routes());
// 生产静态托管：vite build 产物 public/（dev 由 Vite 5173 代理）；目录不存在时跳过挂载
if (existsSync('public')) app.use(serve('public'));

// 主模块判定：tsx（含 watch）直接运行时 argv[1] 即本文件；测试/被导入时 argv[1] 为 vitest 等入口
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = 3082;
  app.listen(port, () => {
    console.log(`[web-koa] listening on http://localhost:${port}`);
  });
}

export { app };
