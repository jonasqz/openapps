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
  assertAppConnectionString,
  assertSafeSchemaName,
  createAppPool,
  DATABASE_SCHEMA_ENV,
  DATABASE_URL_ENV,
  type AppPoolOptions,
} from './db.js';
