/** web-next 包 ESLint：共享规则 + 与 web-koa 互禁边界 */
import { withBoundary } from '../../eslint.shared.ts';

export default withBoundary('web-next');
