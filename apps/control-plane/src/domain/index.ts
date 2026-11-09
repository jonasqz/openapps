/**
 * Die oeffentliche Oberflaeche der Domaene. HTTP-Routen und der Plattform-MCP
 * importieren nur von hier — und nie aus `src/adapters`.
 */

export * from './types';
export * from './errors';
export * from './ports';
export * from './naming';
export { type DomainContext, systemClock, uuidIds } from './context';
export { can, requirePermission, grantMatches, subjectsOf } from './can';
export { record as recordAudit, audited } from './audit';
export { createApp, listApps, getApp, canAccessApp, requireAppPermission } from './apps';
export { requestDeploy, rollback, listDeployments } from './deployments';
export { grant, revoke, listGrants, canCallTool } from './grants';
export * as reviewGate from './review-gate';
export type {
  CodeFacts,
  Finding,
  ReviewInput,
  ReviewPipeline,
  ReviewResult,
  ReviewStep,
  ScannerProcess,
  Severity,
  StepResult,
} from './review-gate/types';
