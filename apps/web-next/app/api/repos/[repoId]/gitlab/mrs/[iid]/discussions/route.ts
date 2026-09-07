/**
 * GET/POST /api/repos/:repoId/gitlab/mrs/:iid/discussions
 *  —— 行级讨论注记列表（GET discussions → 展平 notes）与添加（POST 同路径 {body, position:{new_path,new_line}}→刷新列表）。
 *  zod 校验：iid 正整数；body 非空且 ≤10_000、line 正整数、path 非空。
 */
import { addGitlabMrDiscussion, getGitlabMrDiscussions } from '@rebased/api';
import { gitlabDiscussionBodySchema, gitlabMrIidSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    return Response.json(await getGitlabMrDiscussions(resolveRepo(z.string().min(1).parse(repoId)), iid));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    const body = gitlabDiscussionBodySchema.parse(await req.json());
    return Response.json(await addGitlabMrDiscussion(resolveRepo(z.string().min(1).parse(repoId)), iid, body));
  } catch (error) {
    return handleApiError(error);
  }
}
