/**
 * Fehler des SDK. Eine App soll sie nicht einzeln behandeln müssen: Jeder davon
 * heißt „diesen Aufruf nicht bedienen“. Deshalb trägt jeder einen `status`, den
 * eine App unverändert als HTTP-Status zurückgeben kann.
 */
export class SdkError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.status = status;
  }
}

/**
 * Der Aufruf kam nicht nachweisbar durch das Gateway, oder die Nutzer-Header
 * fehlen bzw. sind unbrauchbar. Kein anonymer Nutzer, kein Fallback: 401.
 */
export class UntrustedRequestError extends SdkError {
  constructor(message: string) {
    super(message, 401);
  }
}

/** Die App ist falsch konfiguriert — fehlende oder unbrauchbare Env. 500. */
export class SdkConfigurationError extends SdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 500, options);
  }
}
