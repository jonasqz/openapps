/** Fehler der Domaene. HTTP und MCP bilden sie auf ihre eigenen Codes ab. */

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Default-Deny hat zugeschlagen: keine passende, offene Freigabe. */
export class PermissionDeniedError extends DomainError {
  constructor(message = 'nicht freigegeben') {
    super(message, 'permission_denied');
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'nicht gefunden') {
    super(message, 'not_found');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'conflict');
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'validation_failed');
  }
}

/** Das Review-Gate hat blockiert. Kein Deploy. */
export class ReviewBlockedError extends DomainError {
  constructor(
    message: string,
    readonly deploymentId: string,
  ) {
    super(message, 'review_blocked');
  }
}
