// Readiness decision logic, kept separate from the HTTP layer so it can be unit
// tested without a database, express, or env. The deploy's blue-green gate keys
// on the 200/503 result (see docs/migrations.md), so the branching here is the
// part worth testing.

export type ReadinessResult = {
  statusCode: 200 | 503
  body:
    | { status: 'ready'; role: string }
    | { status: 'not_ready'; reason: 'pending_migrations'; pending: string[]; role: string }
    | { status: 'not_ready'; reason: 'db_unavailable'; role: string }
}

export interface ReadinessDeps {
  // Throws if the DB can't be reached.
  ping: () => Promise<void>
  // Names of migrations defined in code but not yet applied.
  getPending: () => Promise<string[]>
  role: string
  // Optional sink for the underlying error when the DB is unreachable.
  onError?: (err: unknown) => void
}

export const checkReadiness = async (deps: ReadinessDeps): Promise<ReadinessResult> => {
  const { role } = deps
  try {
    await deps.ping()
    const pending = await deps.getPending()
    if (pending.length > 0) {
      return {
        statusCode: 503,
        body: { status: 'not_ready', reason: 'pending_migrations', pending, role },
      }
    }
    return { statusCode: 200, body: { status: 'ready', role } }
  } catch (err) {
    deps.onError?.(err)
    return { statusCode: 503, body: { status: 'not_ready', reason: 'db_unavailable', role } }
  }
}
