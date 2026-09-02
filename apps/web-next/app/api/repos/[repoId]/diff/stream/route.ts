/**
 * GET /api/repos/:repoId/diff/stream —— SSE：diff.chunk 增量；断开 → req.signal → 取消 git 进程。
 * file 校验（相对路径/绝对路径逃逸）与 from/to、staged 互斥由 api assertValidQuery 覆盖；
 * rev:'' 404 语义推迟（Ruling 2 期）：不做特判，git show :file 失败按 GIT_ERROR 走流内 error 帧。
 */
import { streamDiffEvents } from '@rebased/api';
import { diffQuerySchema, serializeSseEvent } from '@rebased/contracts';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

/** SSE 字节流编码器：Response body 仅接受字节块，serializeSseEvent 的文本帧需编码后产出 */
const encoder = new TextEncoder();

/** @types/node ^20 未声明 Node 20.6+ 的 ReadableStream.from（运行时存在），在此补类型 */
const streamFrom = (ReadableStream as unknown as { from(it: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> }).from;

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const repoPath = resolveRepo(repoId);
    const query = diffQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const stream = streamFrom(
      (async function* () {
        try {
          for await (const event of streamDiffEvents(repoPath, query, { signal: req.signal })) {
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
