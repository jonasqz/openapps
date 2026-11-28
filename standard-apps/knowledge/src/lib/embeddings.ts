import type { QueryFn } from './db';
import {
  modelKeyOf,
  type EmbeddingModelInfo,
  type ModelBudget,
  type ModelUnavailable,
  type PlatformModels,
} from './platform-models';
import { visibleSourceApps, type Visibility } from './visibility';

/**
 * Vektoren fuer die Abschnitte (ADR 0025 B, D).
 *
 * ## Die Warteschlange
 *
 * Abgeleitet statt als eigene Tabelle: Ausstehend ist jeder Abschnitt eines
 * lebenden Dokuments, der fuer die **aktuelle** Modell-Kennung keine Zeile in
 * `chunk_embeddings` hat. Neue und geaenderte Abschnitte stehen damit von
 * selbst darin (ein geaenderter Abschnitt ist ein neuer, siehe
 * `replaceChunks`), und ein Modellwechsel macht alles wieder ausstehend, ohne
 * dass jemand etwas einreihen muss. Speichern beruehrt die Warteschlange
 * nicht und scheitert nie an einem Anbieter.
 *
 * ## Der Takt
 *
 * `startEmbeddingWorker` sieht beim Start und alle 60 s nach, `kickEmbeddings`
 * nach jedem Speichern. Ein Durchlauf fragt zuerst `platform.model_info`
 * (kostet keine Tokens): Ohne Modell passiert nichts weiter, auch kein
 * Aufruf von `embed`, und im Log steht einmal ein Hinweis.
 *
 * ## Budget (Entscheidung im ADR 0025, Umsetzung)
 *
 * Die Tagesgrenze je Subjekt (Default 200 000 Tokens, ADR 0024) gilt fuer
 * alles, was Knowledge tut: Backfill, Vektoren fuer Suchanfragen und
 * `answer`. Ein Backfill darf davon nur einen Anteil nehmen
 * (`BACKFILL_DAILY_SHARE`, die Haelfte), gemessen an dem, was die Plattform
 * fuer `app:knowledge` heute schon zaehlt; ebenso hoechstens die Haelfte der
 * Grenze der Installation. Ist der Anteil erreicht, pausiert der Backfill bis
 * zum naechsten UTC-Tag und macht dann von selbst weiter. Die Grenze selbst
 * aendert Knowledge nie; wer schneller will, hebt sie bewusst in der Env der
 * Control Plane an (`OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT`). Fortschritt und
 * Pause zeigt `embeddings.status`.
 *
 * ## Mehrere Instanzen
 *
 * Jeder Stapel laeuft in einer Transaktion mit einem Advisory-Lock. Eine
 * zweite Instanz ueberspringt den Stapel, statt dieselben Abschnitte noch
 * einmal einzubetten. Der Lock haelt keine Zeilen: Speichern wartet nie.
 */

/** Hoechstens so viele Abschnitte je Aufruf von `embed` (Plattform: 100). */
export const EMBED_BATCH = 32;
/** Anteil der Tagesgrenzen, den ein Backfill hoechstens nimmt. */
export const BACKFILL_DAILY_SHARE = 0.5;
/** So lange laeuft ein Durchlauf hoechstens; der Rest folgt im naechsten. */
export const CYCLE_BUDGET_MS = 20_000;
/** Pause nach einem Fehler des Anbieters oder der Plattform. */
export const ERROR_PAUSE_MS = 5 * 60_000;
/** Schaetzung wie in der Control Plane: vier Zeichen je Token. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const LOCK_KEY = 'knowledge.embeddings';

export interface EmbeddingState {
  readonly modelKey: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly dimensions: number | null;
  readonly providerLocal: boolean | null;
  readonly modelSince: Date | null;
  readonly checkedAt: Date | null;
  readonly lastRunAt: Date | null;
  readonly lastError: string | null;
  readonly lastErrorAt: Date | null;
  readonly pausedUntil: Date | null;
  readonly pausedReason: string | null;
}

interface StateRow extends Record<string, unknown> {
  model_key: string | null;
  provider: string | null;
  model: string | null;
  dimensions: number | null;
  provider_local: boolean | null;
  model_since: Date | null;
  checked_at: Date | null;
  last_run_at: Date | null;
  last_error: string | null;
  last_error_at: Date | null;
  paused_until: Date | null;
  paused_reason: string | null;
}

const EMPTY_STATE: EmbeddingState = Object.freeze({
  modelKey: null,
  provider: null,
  model: null,
  dimensions: null,
  providerLocal: null,
  modelSince: null,
  checkedAt: null,
  lastRunAt: null,
  lastError: null,
  lastErrorAt: null,
  pausedUntil: null,
  pausedReason: null,
});

/** Der Zustand der Warteschlange. Ohne Zeile (sollte nicht vorkommen): leer. */
export async function readState(q: QueryFn): Promise<EmbeddingState> {
  const rows = await q<StateRow>(
    `select model_key, provider, model, dimensions, provider_local, model_since, checked_at,
            last_run_at, last_error, last_error_at, paused_until, paused_reason
       from embedding_state where id`,
  );
  const row = rows[0];
  if (row === undefined) return EMPTY_STATE;
  return {
    modelKey: row.model_key,
    provider: row.provider,
    model: row.model,
    dimensions: row.dimensions === null ? null : Number(row.dimensions),
    providerLocal: row.provider_local,
    modelSince: row.model_since,
    checkedAt: row.checked_at,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    pausedUntil: row.paused_until,
    pausedReason: row.paused_reason,
  };
}

/**
 * Setzt das aktuelle Modell. Eine neue Kennung startet die Neuberechnung
 * (alles ausstehend) und hebt eine Pause auf; dieselbe Kennung aendert nur
 * `checked_at`. `null`: kein Modell, die Suche ist Volltext.
 */
export async function recordModel(q: QueryFn, model: EmbeddingModelInfo | null): Promise<boolean> {
  const key = model === null ? null : modelKeyOf(model);
  const rows = await q<{ changed: boolean }>(
    `update embedding_state
        set model_key = $1,
            provider = $2,
            model = $3,
            dimensions = $4,
            provider_local = $5,
            model_since = case when model_key is distinct from $1 then now() else model_since end,
            paused_until = case when model_key is distinct from $1 then null else paused_until end,
            paused_reason = case when model_key is distinct from $1 then null else paused_reason end,
            checked_at = now()
      where id
      returning (model_since = now()) as changed`,
    [
      key,
      model?.provider ?? null,
      model?.model ?? null,
      model?.dimensions ?? null,
      model?.local ?? null,
    ],
  );
  return rows[0]?.changed === true;
}

async function recordError(q: QueryFn, reason: string, pauseUntil: Date | null): Promise<void> {
  await q(
    `update embedding_state
        set last_error = $1, last_error_at = now(),
            paused_until = $2::timestamptz, paused_reason = case when $2::timestamptz is null then null else $1 end
      where id`,
    [reason.slice(0, 300), pauseUntil?.toISOString() ?? null],
  );
}

async function recordPause(q: QueryFn, reason: string, until: Date): Promise<void> {
  await q(
    `update embedding_state set paused_until = $2::timestamptz, paused_reason = $1 where id`,
    [reason.slice(0, 300), until.toISOString()],
  );
}

/** Die pgvector-Schreibweise eines Vektors: `[0.1,0.2]`. Nur endliche Zahlen. */
export function vectorLiteral(vector: readonly number[]): string {
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('vector contains a value that is not finite');
  }
  return `[${vector.join(',')}]`;
}

/* -------------------------------------------------------------------------- */
/* Abdeckung                                                                   */
/* -------------------------------------------------------------------------- */

export interface Coverage {
  /** Lebende, sichtbare Abschnitte. */
  readonly sections: number;
  /** Davon mit Vektor der Kennung. */
  readonly embedded: number;
  /** Davon zurueckgehalten (Local-only-App, externer Anbieter). */
  readonly withheld: number;
  /** Davon noch ohne Zeile fuer die Kennung. */
  readonly pending: number;
}

/**
 * Wie weit die Kennung `modelKey` die Abschnitte abdeckt, die `visibility`
 * sehen darf. `null` als Sichtbarkeit heisst: alle Abschnitte (nur fuer die
 * Warteschlange selbst, nie fuer eine Antwort an einen Aufrufer).
 */
export async function coverage(
  q: QueryFn,
  modelKey: string,
  visibility: Visibility | 'all',
): Promise<Coverage> {
  const all = visibility === 'all';
  const rows = await q<{ sections: number; embedded: number; withheld: number }>(
    `select count(*)::int as sections,
            count(e.chunk_id) filter (where not e.withheld)::int as embedded,
            count(e.chunk_id) filter (where e.withheld)::int as withheld
       from chunks c
       join documents d on d.id = c.document_id
       left join chunk_embeddings e on e.chunk_id = c.id and e.model_key = $1
      where d.deleted_at is null
        and ($2::boolean or d.source_app is null or d.source_app = any($3::text[]))`,
    [modelKey, all, all ? [] : visibleSourceApps(visibility)],
  );
  const row = rows[0] ?? { sections: 0, embedded: 0, withheld: 0 };
  const sections = Number(row.sections);
  const embedded = Number(row.embedded);
  const withheld = Number(row.withheld);
  return { sections, embedded, withheld, pending: Math.max(0, sections - embedded - withheld) };
}

/**
 * Darf die Suche fuer diese Sichtbarkeit den Vektor-Teil nutzen? Nur, wenn
 * jeder einbettbare sichtbare Abschnitt einen Vektor der aktuellen Kennung
 * hat (ADR 0025 C) und es mindestens einen Vektor gibt. Zurueckgehaltene
 * Abschnitte zaehlen nicht gegen die Abdeckung.
 */
export function vectorReady(c: Coverage): boolean {
  return c.pending === 0 && c.embedded > 0;
}

/* -------------------------------------------------------------------------- */
/* Ein Durchlauf                                                               */
/* -------------------------------------------------------------------------- */

export interface CycleReport {
  /** Abschnitte mit neuem Vektor. */
  readonly embedded: number;
  /** Abschnitte, die die Plattform zurueckgehalten hat. */
  readonly withheld: number;
  /** Danach noch ausstehend, ueber alle Abschnitte. */
  readonly pending: number;
  /** Geloeschte Vektoren alter Kennungen. */
  readonly removedOld: number;
  /** Warum der Durchlauf vor dem Ende aufhoerte, oder `null`. */
  readonly stopped: string | null;
}

export interface CycleDeps {
  readonly query: QueryFn;
  readonly withTransaction: <T>(work: (tx: QueryFn) => Promise<T>) => Promise<T>;
  readonly models: PlatformModels;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

interface PendingRow extends Record<string, unknown> {
  id: string;
  text: string;
  source_app: string | null;
}

/** Was der Backfill heute noch nehmen darf, in Tokens. Ohne Angabe: kein Deckel hier. */
export function backfillAllowance(budget: ModelBudget | null): number {
  if (budget === null) return Number.POSITIVE_INFINITY;
  const subject = Math.floor(budget.subject.limit * BACKFILL_DAILY_SHARE) - budget.subject.used;
  const installation =
    Math.floor(budget.installation.limit * BACKFILL_DAILY_SHARE) - budget.installation.used;
  return Math.max(0, Math.min(subject, installation));
}

/** Beginn des naechsten UTC-Tages, falls die Plattform keinen nennt. */
export function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

const REASONS: Readonly<Record<ModelUnavailable, string>> = {
  not_configured: 'no embedding model is configured',
  denied: 'app:knowledge has no grant to execute platform.embed',
  budget_exceeded: 'the daily token limit is reached',
  no_platform: 'OPENAPPS_PLATFORM_URL or OPENAPPS_CALL_SECRET is not set',
  error: 'the platform or the model provider did not answer',
};

export function reasonOf(status: ModelUnavailable): string {
  return REASONS[status];
}

/**
 * Ein Durchlauf der Warteschlange: Modell pruefen, Stapel einbetten, bis
 * nichts mehr aussteht, der Tagesanteil erreicht ist oder `budgetMs` um ist.
 * Wirft nur, wenn die eigene Datenbank nicht antwortet.
 */
export async function runEmbeddingCycle(
  deps: CycleDeps,
  options: { readonly budgetMs?: number } = {},
): Promise<CycleReport> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const started = now().getTime();
  const budgetMs = options.budgetMs ?? CYCLE_BUDGET_MS;
  let embedded = 0;
  let withheld = 0;

  const done = async (stopped: string | null, key: string | null): Promise<CycleReport> => {
    await deps.query('update embedding_state set last_run_at = now() where id');
    if (key === null) return { embedded, withheld, pending: 0, removedOld: 0, stopped };
    const all = await coverage(deps.query, key, 'all');
    let removedOld = 0;
    // Alte Vektoren erst loeschen, wenn die neue Kennung alles abdeckt (D):
    // Bis dahin sucht ohnehin niemand mit ihnen, aber ein Wechsel zurueck
    // kostete sonst alles noch einmal.
    if (all.pending === 0) {
      const removed = await deps.query<{ n: number }>(
        `with gone as (delete from chunk_embeddings where model_key <> $1 returning 1)
         select count(*)::int as n from gone`,
        [key],
      );
      removedOld = Number(removed[0]?.n ?? 0);
    }
    return { embedded, withheld, pending: all.pending, removedOld, stopped };
  };

  const info = await deps.models.info();
  if (info.status !== 'ok') {
    // Ohne Plattform kein Modell; die Suche bleibt Volltext. Kein Fehler.
    await recordModel(deps.query, null);
    await recordError(deps.query, reasonOf(info.status), null);
    return done(reasonOf(info.status), null);
  }
  if (info.embedding === null) {
    await recordModel(deps.query, null);
    return done(reasonOf('not_configured'), null);
  }
  const key = modelKeyOf(info.embedding);
  if (await recordModel(deps.query, info.embedding)) {
    log(
      `embedding model is now ${key}; sections are embedded again, search uses full text until done`,
    );
  }

  const state = await readState(deps.query);
  if (state.pausedUntil !== null && state.pausedUntil.getTime() > now().getTime()) {
    return done(
      `paused until ${state.pausedUntil.toISOString()}: ${state.pausedReason ?? ''}`,
      key,
    );
  }

  let allowance = backfillAllowance(info.budget);
  const resetsAt = info.budget === null ? nextUtcDay(now()) : new Date(info.budget.resetsAt);

  while (now().getTime() - started < budgetMs) {
    const step = await deps.withTransaction(async (tx) => {
      const locked = await tx<{ ok: boolean }>(
        'select pg_try_advisory_xact_lock(hashtext($1)) as ok',
        [LOCK_KEY],
      );
      if (locked[0]?.ok !== true) return { kind: 'locked' as const };

      const rows = await tx<PendingRow>(
        `select c.id::text as id, c.text, d.source_app
           from chunks c
           join documents d on d.id = c.document_id
          where d.deleted_at is null
            and not exists (select 1 from chunk_embeddings e
                             where e.chunk_id = c.id and e.model_key = $1)
          order by d.created_at desc, c.document_id, c.ord
          limit $2`,
        [key, EMBED_BATCH],
      );
      if (rows.length === 0) return { kind: 'empty' as const };

      // Nur so viel, wie der Tagesanteil noch hergibt.
      const batch: PendingRow[] = [];
      let estimate = 0;
      for (const row of rows) {
        const cost = estimateTokens(row.text);
        if (estimate + cost > allowance) break;
        batch.push(row);
        estimate += cost;
      }
      if (batch.length === 0) return { kind: 'share' as const };

      const result = await deps.models.embed(
        batch.map((row) => ({
          id: row.id,
          sourceApp: row.source_app ?? 'knowledge',
          text: row.text,
        })),
      );
      if (result.status !== 'ok') return { kind: 'unavailable' as const, status: result.status };
      if (modelKeyOf(result.model) !== key)
        return { kind: 'model_changed' as const, model: result.model };

      const asked = new Set(batch.map((row) => row.id));
      const vectors = result.embeddings.filter((entry) => asked.has(entry.id));
      const dims = new Set(vectors.map((entry) => entry.vector.length));
      if (dims.size > 1) return { kind: 'unavailable' as const, status: 'error' as const };
      if (vectors.length > 0) {
        // Nur fuer Abschnitte, die es noch gibt; ein inzwischen ersetzter
        // Abschnitt faellt still heraus.
        await tx(
          `insert into chunk_embeddings (chunk_id, model_key, embedding, withheld)
           select c.id, $1, u.v::extensions.vector, false
             from unnest($2::text[], $3::text[]) as u(id, v)
             join chunks c on c.id = u.id::uuid
           on conflict (chunk_id, model_key) do nothing`,
          [
            key,
            vectors.map((entry) => entry.id),
            vectors.map((entry) => vectorLiteral(entry.vector)),
          ],
        );
      }
      const held = result.withheld.filter((id) => asked.has(id));
      if (held.length > 0) {
        await tx(
          `insert into chunk_embeddings (chunk_id, model_key, embedding, withheld)
           select c.id, $1, null, true
             from unnest($2::text[]) as u(id)
             join chunks c on c.id = u.id::uuid
           on conflict (chunk_id, model_key) do nothing`,
          [key, held],
        );
      }
      return { kind: 'ok' as const, embedded: vectors.length, withheld: held.length, estimate };
    });

    if (step.kind === 'locked' || step.kind === 'empty') return done(null, key);
    if (step.kind === 'share') {
      await recordPause(deps.query, 'the daily share for embedding is used up', resetsAt);
      log(`embedding backfill paused until ${resetsAt.toISOString()} (daily share used up)`);
      return done('daily share used up', key);
    }
    if (step.kind === 'model_changed') {
      await recordModel(deps.query, step.model);
      return done('the embedding model changed', modelKeyOf(step.model));
    }
    if (step.kind === 'unavailable') {
      if (step.status === 'not_configured') {
        await recordModel(deps.query, null);
        return done(reasonOf(step.status), null);
      }
      const until =
        step.status === 'budget_exceeded' ? resetsAt : new Date(now().getTime() + ERROR_PAUSE_MS);
      await recordError(deps.query, reasonOf(step.status), until);
      return done(reasonOf(step.status), key);
    }
    embedded += step.embedded;
    withheld += step.withheld;
    allowance -= step.estimate;
  }
  return done(null, key);
}

/* -------------------------------------------------------------------------- */
/* Laufzeit: Takt und Anstoss                                                  */
/* -------------------------------------------------------------------------- */

const INTERVAL_MS = 60_000;

export interface EmbeddingWorker {
  /** Stoesst einen Durchlauf an und kehrt sofort zurueck. Wirft nie. */
  kick(): void;
  /** Wartet, bis ein laufender Durchlauf fertig ist. */
  settle(): Promise<void>;
  /** Startet den Takt. */
  start(): void;
  /** Haelt den Takt an. */
  stop(): void;
  /** Ein Durchlauf, auf den gewartet wird (fuer `embeddings.backfill`). */
  runNow(options?: { readonly budgetMs?: number }): Promise<CycleReport>;
}

export function createEmbeddingWorker(deps: CycleDeps): EmbeddingWorker {
  let running: Promise<unknown> | null = null;
  let again = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastNotice: string | null = null;
  const log = deps.log ?? ((line: string) => console.info(`[knowledge] ${line}`));

  const notice = (report: CycleReport): void => {
    // Ein Hinweis je Zustand, nicht je Durchlauf: Ohne Modell steht genau
    // eine Zeile im Log.
    const text =
      report.stopped === reasonOf('not_configured')
        ? 'no embedding model is configured: search uses full text only'
        : report.stopped;
    if (text === null || text === lastNotice) return;
    lastNotice = text;
    if (!text.startsWith('paused until')) log(`embeddings: ${text}`);
  };

  const cycle = async (options?: { readonly budgetMs?: number }): Promise<CycleReport> => {
    const report = await runEmbeddingCycle({ ...deps, log }, options);
    notice(report);
    if (report.stopped === null) lastNotice = null;
    return report;
  };

  const loop = (): void => {
    if (running !== null) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await cycle();
        } catch (error) {
          const name = error instanceof Error ? error.name : 'error';
          console.warn(`[knowledge] embeddings: cycle failed (${name})`);
        }
      } while (again);
    })().finally(() => {
      running = null;
    });
  };

  return {
    kick: loop,
    async settle() {
      while (running !== null) await running;
    },
    start() {
      if (timer !== null) return;
      loop();
      timer = setInterval(loop, INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    async runNow(options) {
      while (running !== null) await running;
      const work = cycle(options);
      running = work.catch(() => undefined);
      try {
        return await work;
      } finally {
        running = null;
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Status und Backfill                                                         */
/* -------------------------------------------------------------------------- */

export interface EmbeddingStatus {
  readonly configured: boolean;
  readonly model: {
    readonly provider: string;
    readonly model: string;
    readonly dimensions: number | null;
    readonly local: boolean;
    readonly since: string | null;
  } | null;
  /** Fuer die Sichtbarkeit des Aufrufers: hybrid oder nur Volltext. */
  readonly search: 'hybrid' | 'fulltext';
  readonly coverage: Coverage | null;
  /** Vektoren alter Kennungen, die nach Abschluss geloescht werden. */
  readonly oldVectors: number;
  readonly backfill: {
    readonly dailyShare: number;
    /** Tokens, die der Backfill heute noch nehmen darf; `null`: unbekannt. */
    readonly allowanceToday: number | null;
    /** Grobe Schaetzung der verbleibenden Tokens fuer alle ausstehenden Abschnitte. */
    readonly pendingTokens: number;
    /** Grob: wie viele UTC-Tage es bei diesem Anteil noch dauert. */
    readonly estimatedDays: number | null;
    readonly pausedUntil: string | null;
    readonly pausedReason: string | null;
  };
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  /** Ein Satz fuer Menschen und Agents, was gerade gilt. */
  readonly note: string;
}

/**
 * `embeddings.status`, mit der Sichtbarkeit des Aufrufers. Liest nur: Das
 * Modell kommt frisch von `platform.model_info`, die Abdeckung aus der
 * eigenen Datenbank. Antwortet die Plattform nicht, gilt der zuletzt
 * gespeicherte Stand.
 */
export async function embeddingStatus(
  q: QueryFn,
  models: PlatformModels,
  visibility: Visibility,
): Promise<EmbeddingStatus> {
  const info = await models.info();
  const state = await readState(q);
  const iso = (value: Date | null): string | null => value?.toISOString() ?? null;
  const share = BACKFILL_DAILY_SHARE;

  let model: EmbeddingModelInfo | null;
  if (info.status === 'ok') model = info.embedding;
  else if (info.status === 'error' && state.modelKey !== null) {
    model = {
      provider: state.provider ?? '',
      model: state.model ?? '',
      dimensions: state.dimensions,
      local: state.providerLocal === true,
    };
  } else model = null;

  const common = {
    lastRunAt: iso(state.lastRunAt),
    lastError: state.lastError,
    lastErrorAt: iso(state.lastErrorAt),
  };

  if (model === null) {
    return {
      configured: false,
      model: null,
      search: 'fulltext',
      coverage: null,
      oldVectors: await countOld(q, null),
      backfill: {
        dailyShare: share,
        allowanceToday: null,
        pendingTokens: 0,
        estimatedDays: null,
        pausedUntil: null,
        pausedReason: null,
      },
      ...common,
      note:
        info.status === 'ok' || info.status === 'not_configured'
          ? 'No embedding model is configured. Search uses full text only, exactly as before.'
          : `Search uses full text only: ${reasonOf(info.status)}.`,
    };
  }

  const key = modelKeyOf(model);
  const visible = await coverage(q, key, visibility);
  const pendingRows = await q<{ chars: number }>(
    `select coalesce(sum(length(c.text)), 0)::bigint as chars
       from chunks c join documents d on d.id = c.document_id
      where d.deleted_at is null
        and not exists (select 1 from chunk_embeddings e where e.chunk_id = c.id and e.model_key = $1)`,
    [key],
  );
  const pendingTokens = Math.ceil(Number(pendingRows[0]?.chars ?? 0) / 4);
  const budget = info.status === 'ok' ? info.budget : null;
  const allowanceToday = budget === null ? null : backfillAllowance(budget);
  const perDay =
    budget === null
      ? null
      : Math.min(
          Math.floor(budget.subject.limit * share),
          Math.floor(budget.installation.limit * share),
        );
  let estimatedDays: number | null = null;
  if (pendingTokens === 0) estimatedDays = 0;
  else if (perDay !== null && perDay > 0) estimatedDays = Math.ceil(pendingTokens / perDay);

  // Die Pause gilt nur fuer die Kennung, unter der sie entstand.
  const samePause = state.modelKey === key;
  const search = vectorReady(visible) ? 'hybrid' : 'fulltext';
  return {
    configured: true,
    model: {
      provider: model.provider,
      model: model.model,
      dimensions: model.dimensions,
      local: model.local,
      since: samePause ? iso(state.modelSince) : null,
    },
    search,
    coverage: visible,
    oldVectors: await countOld(q, key),
    backfill: {
      dailyShare: share,
      allowanceToday,
      pendingTokens,
      estimatedDays,
      pausedUntil: samePause ? iso(state.pausedUntil) : null,
      pausedReason: samePause ? state.pausedReason : null,
    },
    ...common,
    note:
      search === 'hybrid'
        ? 'Search combines full text and vectors (hybrid).'
        : visible.pending > 0
          ? `Search uses full text only until all ${String(visible.sections)} visible sections are embedded (${String(visible.pending)} pending).`
          : 'Search uses full text only: there are no vectors yet.',
  };
}

async function countOld(q: QueryFn, key: string | null): Promise<number> {
  const rows = await q<{ n: number }>(
    `select count(*)::int as n from chunk_embeddings where $1::text is null or model_key <> $1`,
    [key],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * `embeddings.backfill`: Zurueckgehaltene Abschnitte der aktuellen Kennung
 * noch einmal versuchen (die Liste der Local-only-Apps kann sich geaendert
 * haben) und einen Durchlauf abwarten. Respektiert den Tagesanteil: Eine
 * Pause wegen des Anteils hebt es nicht auf, eine Pause wegen eines Fehlers
 * schon.
 */
export async function backfillEmbeddings(
  q: QueryFn,
  worker: EmbeddingWorker,
): Promise<{ readonly retriedWithheld: number; readonly report: CycleReport }> {
  const state = await readState(q);
  let retriedWithheld = 0;
  if (state.modelKey !== null) {
    const rows = await q<{ n: number }>(
      `with gone as (delete from chunk_embeddings where model_key = $1 and withheld returning 1)
       select count(*)::int as n from gone`,
      [state.modelKey],
    );
    retriedWithheld = Number(rows[0]?.n ?? 0);
  }
  await q(
    `update embedding_state set paused_until = null, paused_reason = null
      where id and paused_reason is distinct from 'the daily share for embedding is used up'`,
  );
  const report = await worker.runNow();
  return { retriedWithheld, report };
}
