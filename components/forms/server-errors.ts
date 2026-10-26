import { toast } from "sonner"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"
import type { FieldErrors } from "@/lib/form-types"

export const GENERIC_ERROR = "Please fix the errors and try again."

/** The first message of each field the server complained about. */
export function firstMessages(error: FieldErrors): Record<string, string> {
  return Object.fromEntries(Object.entries(error).flatMap(([name, messages]) => (messages?.[0] ? [[name, messages[0]]] : [])))
}

/**
 * Shows a failed action's `error`. A plain message is a toast. Field errors go under the fields they
 * name (`fields` defaults to every field of the form); a message for a field the form doesn't show
 * is toasted, and the generic line only when nothing mapped to a field at all.
 */
export function showServerError<T extends FieldValues>(form: UseFormReturn<T>, error: string | FieldErrors | undefined, fields?: readonly string[]) {
  if (typeof error === "string") return toast.error(error)
  const shown = new Set(fields ?? Object.keys(form.getValues()))
  const messages = Object.entries(firstMessages(error ?? {}))
  const mapped = messages.filter(([name]) => shown.has(name))
  mapped.forEach(([name, message], i) => form.setError(name as Path<T>, { message }, { shouldFocus: i === 0 }))
  const other = messages.find(([name]) => !shown.has(name))
  if (other) toast.error(other[1])
  else if (mapped.length === 0) toast.error(GENERIC_ERROR)
}
