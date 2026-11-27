/**
 * Die oeffentliche Oberflaeche der Domaene. HTTP-Routen und der Plattform-MCP
 * importieren nur von hier — und nie aus `src/adapters`.
 */

export * from './types';
export * from './errors';
export * from './ports';
export * from './naming';
export { type DomainContext, type GatewaySettings, systemClock, uuidIds } from './context';
export { can, requirePermission, grantMatches, subjectsOf } from './can';
export { appAuthSecret, appCallSecret, type AppSecretInput } from './app-secret';
export { appIdOf, gatewayHost } from './gateway-identity';
export { appContainerPort, DEFAULT_APP_PORT } from './app-port';
export {
  buildGatewayConfig,
  gatewayConfigProblems,
  gatewayRouterNameFor,
  gatewayRouterNames,
  routerMiddlewares,
  canonicalHeaderName,
  CATCH_ALL_ROUTER,
  CONTROL_PLANE_ROUTER,
  CONTROL_PLANE_SERVICE,
  DENY_SERVICE,
  FORWARD_AUTH_MIDDLEWARE,
  PLATFORM_ROUTER,
  GATEWAY_TIMEOUT_NOTE,
  ROUTER_MIDDLEWARES,
  STRIP_IDENTITY_MIDDLEWARE,
  type GatewayApp,
  type GatewayConfigInput,
  type GatewayDynamicConfig,
  type GuardedRouter,
} from './gateway-config';
export {
  EMPTY_NAV_HEADERS,
  fitNav,
  GATEWAY_RESPONSE_HEADERS,
  IDENTITY_HEADERS,
  identityHeaders,
  identityHeadersForApp,
  NAV_HEADER,
  NAV_HEADER_BUDGET,
  NAV_HEADERS,
  NAV_SIGNATURE_HEADER,
  navHeaders,
  navHeadersForApp,
  EMPTY_READABLE_APPS_HEADERS,
  fitReadableApps,
  READABLE_APPS_HEADER,
  READABLE_APPS_HEADER_BUDGET,
  READABLE_APPS_HEADERS,
  READABLE_APPS_SIGNATURE_HEADER,
  readableAppsHeaders,
  readableAppsHeadersForApp,
  type ReadableAppsHeaderInput,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type GatewayIdentity,
  type IdentityHeaderInput,
  type NavHeaderInput,
} from './gateway-headers';
export {
  canCreateApps,
  isPlatformAdmin,
  PLATFORM_ADMINS_GROUP,
  platformNavFor,
  visibleAppsFor,
} from './navigation';
export { readableAppsFor, readableAppsForTarget, wantsReadableApps } from './readable-apps';
export {
  AGENT_CALLER_EMAIL_DOMAIN,
  APP_CALLER_EMAIL_DOMAIN,
  AppToolError,
  callAppTool,
  callerIdentityFor,
  invocationIdentityFor,
  listAppTools,
  type AppToolInvoker,
  type AppToolRef,
  type HumanIdentity,
} from './app-tools';
export {
  federateSearch,
  gatewayAppHref,
  isSearchable,
  maySearchApp,
  parseSearchRequest,
  PLATFORM_PATH_PREFIX,
  PLATFORM_PATHS,
  PLATFORM_SEARCH_LIMITS,
  PLATFORM_SEARCH_PATH,
  searchApps,
  searchToolOf,
  type PlatformSearchAppResult,
  type PlatformSearchFailure,
  type PlatformSearchFailureReason,
  type PlatformSearchHit,
  type PlatformSearchResult,
  type SearchAppsInput,
  type SearchTarget,
} from './platform-search';
export {
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  UnauthenticatedCallerError,
  verifyAppCaller,
  type AppCallerInput,
} from './app-callers';
export {
  describeActor,
  type ActorDescription,
  type ActorGrant,
  type AgentSelf,
  type GrantSource,
} from './me';
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
  type GatewayConfigReport,
  gatewayConfigFor,
  ownRouterProblems,
  publishGatewayAtStartup,
} from './deployments';
export { grant, revoke, listGrants, canCallTool } from './grants';
export {
  listGroups,
  listGroupMembers,
  createGroup,
  addGroupMember,
  removeGroupMember,
} from './groups';
export {
  agentToken,
  createAgentIdentity,
  disableAgentIdentity,
  hashAgentSecret,
  listAgentIdentities,
  parseAgentToken,
  type CreatedAgentIdentity,
} from './agents';
export * as reviewGate from './review-gate';
export type {
  BasePathFact,
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
