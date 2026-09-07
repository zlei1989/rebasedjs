/**
 * GET/POST /api/repos/:repoId/github/prs/:number/review-comments
 *  —— 行级评审评论列表（GET pulls/:n/comments）与添加（POST 同路径 {path,line,side,body}→刷新列表）。
 *  zod 校验：number 正整数；body 非空且 ≤10_000、line 正整数、side LEFT/RIGHT（缺省 RIGHT）。
 */
import { addGithubPrReviewComment, getGithubPrReviewComments } from '@rebased/api';
import { githubPrNumberSchema, githubReviewCommentBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    return Response.json(await getGithubPrReviewComments(resolveRepo(z.string().min(1).parse(repoId)), number));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    const body = githubReviewCommentBodySchema.parse(await req.json());
    return Response.json(await addGithubPrReviewComment(resolveRepo(z.string().min(1).parse(repoId)), number, body));
  } catch (error) {
    return handleApiError(error);
  }
}
