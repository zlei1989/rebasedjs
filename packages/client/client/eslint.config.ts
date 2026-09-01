/** client 包 ESLint：共享规则 + client 禁 apps 边界 */
import { withBoundary } from '../../../eslint.shared.ts';

export default withBoundary('client');
