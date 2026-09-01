/** ui 包 ESLint：共享规则 + UI 禁 client/api/apps 边界 */
import { withBoundary } from '../../../eslint.shared.ts';

export default withBoundary('ui');
