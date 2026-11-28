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
  constructor(message = 'not granted') {
    super(message, 'permission_denied');
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'not found') {
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

/**
 * Eine Postgres-Erweiterung aus `databaseExtensions` fehlt im Schema
 * `extensions` (ADR 0025). Der Deploy endet als `failed`; die Meldung nennt
 * den einmaligen Schritt als Superuser.
 */
export class MissingDatabaseExtensionError extends ConflictError {
  constructor(readonly extension: string) {
    super(
      `database extension "${extension}" is not installed in schema extensions. ` +
        'Run openapps-vector once as superuser in the database container ' +
        '(infra/betrieb/README.md, "Database extensions"), then deploy again.',
    );
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

/**
 * Fuer diese Funktion ist kein Modell konfiguriert (ADR 0024 A). Kein
 * Fehler der Plattform: Ohne Schluessel ruft sie nie ein Modell auf.
 */
export class NotConfiguredError extends DomainError {
  constructor(message = 'no model is configured for this function') {
    super(message, 'not_configured');
  }
}

/** Die Tagesgrenze fuer Modell-Tokens ist erreicht (ADR 0024 C). */
export class BudgetExceededError extends DomainError {
  constructor(message: string) {
    super(message, 'budget_exceeded');
  }
}

/**
 * Der Modell-Anbieter hat nicht oder mit einem Fehler geantwortet. Die
 * Meldung nennt Anbieter, Status und hoechstens die Fehlerart des Anbieters,
 * nie seinen Text und nie den Schluessel.
 */
export class ModelProviderError extends DomainError {
  constructor(message: string) {
    super(message, 'model_error');
  }
}
