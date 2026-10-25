// Shapes shared by the generic entity dialog and the server actions it calls.
// Values travel as the strings the inputs hold; the zod schemas in
// lib/health-schemas.ts own every conversion to dates, numbers and nulls.

export type FormValues = Record<string, string>

export type FieldErrors = Record<string, string[] | undefined>

export type ActionResult = { success?: boolean; id?: string; error?: string | FieldErrors }

export type FieldOption = { value: string; label: string }

export type FieldConfig = {
  name: string
  label: string
  kind: "text" | "textarea" | "date" | "time" | "number" | "email" | "tel" | "select" | "checkboxes"
  required?: boolean
  placeholder?: string
  /// select and checkboxes only. A non-required select gets a "None" choice.
  options?: FieldOption[]
  /// select only: the label of the empty choice. Defaults to "None".
  emptyLabel?: string
  /// text only: values offered as you type (the field still accepts anything).
  suggestions?: string[]
  /// Spans both columns of the dialog grid.
  wide?: boolean
  /// A lib/field-help id: adds the "?" popover beside the label.
  help?: string
  /// Shown only while this returns true (values are the form's current values). A hidden field keeps its value.
  showWhen?: (values: FormValues) => boolean
  /// A warning shown under the field while it returns text.
  notice?: (values: FormValues) => string | null
}
