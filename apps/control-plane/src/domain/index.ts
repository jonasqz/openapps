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
export { appAuthSecret, type AppSecretInput } from './app-secret';
export { appIdOf, gatewayHost } from './gateway-identity';
export { appContainerPort, DEFAULT_APP_PORT } from './app-port';
export {
  IDENTITY_HEADERS,
  identityHeaders,
  identityHeadersForApp,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type GatewayIdentity,
  type IdentityHeaderInput,
} from './gateway-headers';
export {
  proposedGrantsOf,
  resourceRefOf,
  subjectKindOf,
  type ProposedGrant,
} from './manifest-grants';
export { record as recordAudit, audited } from './audit';
export { createApp, listApps, getApp, canAccessApp, requireAppPermission } from './apps';
export {
  requestDeploy,
  rollback,
  listDeployments,
  type DeployOutcome,
  type GatewayLintReport,
} from './deployments';
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
