/**
 * GET /api/repos/:repoId/events —— SSE：仓库状态与进行中操作推送
 * （首帧依次产 repo.state-changed（当前状态）与 operation.state-changed（当前操作），之后各自变化才推）。
 * 断开 → req.signal → watchRepoStatus 轮询退出；getRepoStatus 抛错冒泡 → 流内 error 帧后结束。
 */
import { watchRepoStatus } from '@rebased/api';
import { serializeSseEvent } from '@rebased/contracts';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

/** SSE 字节流编码器：Response body 仅接受字节块，serializeSseEvent 的文本帧需编码后产出 */
const encoder = new TextEncoder();

/** @types/node ^20 未声明 Node 20.6+ 的 ReadableStream.from（运行时存在），在此补类型 */
const streamFrom = (ReadableStream as unknown as { from(it: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> }).from;

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const repoPath = resolveRepo(repoId);
    const stream = streamFrom(
      (async function* () {
        try {
          for await (const event of watchRepoStatus(repoPath, { signal: req.signal })) {
            yield encoder.encode(serializeSseEvent(event));
          }
        } catch (error) {
          // 流错误呈现：发 error 帧后结束，不崩响应
          yield encoder.encode(serializeSseEvent({ type: 'stream.error', payload: { message: (error as Error).message } }));
        }
      })(),
    );
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
