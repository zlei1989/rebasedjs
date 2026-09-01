/**
 * Next 自定义服务器入口 — 同端口服务 HTTP（Next 页面/API）与 WS（/api/agent/ws）。
 * 注意：本文件不经 Next 编译，由 tsx 直接运行；WS 路径不经 Next instrumentation，
 * 故显式 initDatabase（幂等）。自定义服务器使 Next 失去 Automatic Static Optimization，Electron/自托管场景可接受。
 */
import { createServer, type Server } from 'node:http';
import { setDefaultAutoSelectFamily } from 'node:net';
import { parse } from 'node:url';


// 禁用 Happy Eyeballs（autoSelectFamily）：DNS 返回多个 IP 时 Node 20 默认并发连接全部地址，
// 只要有一个不可达就会挂起直到超时（实测 DeepSeek 的 119.188.44.230 不可达，fetch 拉模型列表
// 恒超时 10s；curl 顺序尝试首个可达 IP 则正常）。禁用后按序连接，规避多 IP 场景的连接挂起。
// 权衡：禁用后仅连接解析出的首个地址、无并行兜底，若其它多 IP 供应商连接挂起，优先怀疑此全局选项。
setDefaultAutoSelectFamily(false);

import { createAgentQuery } from '@tiegongji/agent-sdk';
import next from 'next';


import { initDatabase } from './src/lib/db';
import { getChat, updateChat } from './src/lib/repositories/chats';
import { listMcpServers } from './src/lib/repositories/mcp-servers';
import { appendSessionEvent, getMaxSessionEventSeq } from './src/lib/repositories/session-events';
import { ProcessPool } from './src/server/process-pool';
import { SessionManager } from './src/server/session-manager';
import { attachWsGateway } from './src/server/ws-gateway';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3030);

/** 启动入口：初始化 DB → 准备 Next → 组装进程池/会话管理器 → 同端口挂 WS 网关 */
async function main(): Promise<void> {
  initDatabase();

  const app = next({ dev, port });
  await app.prepare();
  const handle = app.getRequestHandler();

  const pool = new ProcessPool();
  const sessionManager = new SessionManager({
    pool,
    createQuery: createAgentQuery,
    proxyBaseUrl: `http://127.0.0.1:${port}/api`,
    getChat,
    updateChat,
    appendEvent: appendSessionEvent,
    getMaxSeq: getMaxSessionEventSeq,
    listMcpServers,
  });
  // 空闲回收：经 sessionManager 广播 destroyed 后销毁（仍连着的客户端可感知）
  pool.startSweeper((chatId) => { void sessionManager.destroySession(chatId); });

  const server = createServer((req, res) => { void handle(req, res, parse(req.url ?? '', true)); });

  // Next dev 的 HMR WebSocket 处理器默认在首个真实 HTTP 请求触发后才注册到 http.Server。
  // 当浏览器在页面仍打开时重连（如服务器重启后），upgrade 事件可能先于首个真实请求到达，
  // 导致 HMR 握手超时、页面 navigation 被 dev client 卡住。此处显式调用 setupWebSocketHandler，
  // 使 HMR upgrade 处理器在 attachWsGateway 之前完成注册，避免两者竞争同一个 socket。
  (app as unknown as { setupWebSocketHandler(server: Server): void }).setupWebSocketHandler(server);

  attachWsGateway(server, { sessionManager, getChat });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.info(`[server] HTTP+WS 就绪: http://localhost:${port}（ws 路径 /api/agent/ws）`);

  // 优雅关停：销毁全部 agent 进程再退出
  const shutdown = (): void => {
    void sessionManager.shutdown().then(() => {
      server.close(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('[server] 启动失败', error);
  process.exit(1);
});
