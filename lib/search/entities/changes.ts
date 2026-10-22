// A debounced "records changed" signal from lib/prisma.ts to the record sync.
// It lives in its own module with no imports, so the Prisma client can depend
// on it without pulling in the search code (which itself imports Prisma).

/** Prisma models whose rows are embedded for global search. */
export const ENTITY_MODELS = new Set([
  "Property", "Vehicle", "Equipment", "Person", "ServiceRecord", "MaintenanceSchedule", "Warranty", "InsurancePolicy",
  "Provider", "HealthCondition", "Medication", "Allergy", "Immunization", "Observation", "Room", "RoomPaint",
])

export const WRITE_OPERATIONS = new Set([
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany",
])

/** Long enough that a burst of saves (an import, a form saving several rows) syncs once. */
export const DEBOUNCE_MS = 1500

type State = { listener?: () => void; timer?: ReturnType<typeof setTimeout> }
const g = globalThis as unknown as { __hcEntityChanges?: State }
const state: State = (g.__hcEntityChanges ??= {})

export function onEntitiesChanged(listener: () => void): void {
  state.listener = listener
}

/** No-op until a listener is registered (scripts, tests, the seed). */
export function entitiesChanged(): void {
  if (!state.listener) return
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state.timer = undefined
    state.listener?.()
  }, DEBOUNCE_MS)
  state.timer.unref?.()
}
