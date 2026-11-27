export { SdkConfigurationError, SdkError, UntrustedRequestError } from './errors.js';

export { readHeader, readListHeader, readRawHeader, type HeaderBag } from './headers.js';

export {
  APP_HOST_ENV,
  APP_ID_ENV,
  AUTH_SECRET_ENV,
  DEFAULT_MAX_AGE_SECONDS,
  getUser,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  MIN_SECRET_LENGTH,
  signatureFor,
  signatureMaterial,
  SIGNATURE_HEADER,
  SIGNATURE_MATERIAL_VERSION,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type GetUserOptions,
  type PlatformUser,
  type SignatureInput,
} from './gateway.js';

export {
  decodeNav,
  encodeNav,
  getNavigation,
  NAV_HEADER,
  NAV_LIMITS,
  NAV_MAX_APPS,
  NAV_MAX_HEADER_LENGTH,
  NAV_SIGNATURE_HEADER,
  NAV_SIGNATURE_MATERIAL_VERSION,
  navSignatureFor,
  navSignatureMaterial,
  type NavSignatureInput,
  type PlatformNav,
  type PlatformNavApp,
} from './nav.js';

export {
  decodeReadableApps,
  encodeReadableApps,
  getReadableApps,
  READABLE_APPS_HEADER,
  READABLE_APPS_MAX,
  READABLE_APPS_MAX_HEADER_LENGTH,
  READABLE_APPS_SIGNATURE_HEADER,
  READABLE_APPS_SIGNATURE_MATERIAL_VERSION,
  readableAppsSignatureFor,
  readableAppsSignatureMaterial,
  type ReadableAppsSignatureInput,
} from './readable-apps.js';

export {
  AGENT_CALLER_EMAIL_DOMAIN,
  AGENT_CALLER_PREFIX,
  APP_CALLER_EMAIL_DOMAIN,
  APP_CALLER_PREFIX,
  callerOf,
  type Caller,
} from './caller.js';

export {
  APP_CALL_DEFAULT_TIMEOUT_MS,
  APP_CALL_MAX_AGE_SECONDS,
  APP_CALL_MAX_BODY_BYTES,
  APP_CALL_SIGNATURE_MATERIAL_VERSION,
  AppCallError,
  appCallSignatureFor,
  appCallSignatureMaterial,
  CALL_SECRET_ENV,
  callAppTool,
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  PLATFORM_URL_ENV,
  sha256Hex,
  type AppCallErrorCode,
  type AppCallSignatureInput,
  type CallAppToolOptions,
} from './app-call.js';

export {
  APP_BASE_PATH_ENV,
  appBasePath,
  readShell,
  type ReadShellOptions,
  type ShellAppInfo,
  type ShellData,
  type ShellPlatformAppData,
  type ShellPlatformData,
  type ShellUserData,
} from './shell.js';

export {
  assertAppConnectionString,
  assertSafeSchemaName,
  createAppPool,
  DATABASE_SCHEMA_ENV,
  DATABASE_URL_ENV,
  type AppPoolOptions,
} from './db.js';

export {
  createToolRoute,
  parseArgs,
  ToolInputError,
  ToolNotFoundError,
  type ToolContext,
  type ToolHandler,
  type ToolRouteOptions,
} from './tools.js';

export {
  isAppRelativePath,
  normalizeSearchResult,
  parseSearchArgs,
  SEARCH_HIT_LIMITS,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  type SearchHit,
  type SearchToolArgs,
  type SearchToolResult,
} from './search.js';

export {
  MIGRATIONS_TABLE,
  runMigrations,
  runSeeds,
  SEED_PREFIX,
  type MigrationResult,
} from './migrate.js';
