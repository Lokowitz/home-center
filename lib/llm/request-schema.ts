import { z } from "zod"

export const MAX_MESSAGES = 40
export const MAX_MESSAGE_CHARS = 8000
export const MAX_TOTAL_CHARS = 64000

export const chatRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(MAX_MESSAGE_CHARS),
        })
      )
      .min(1)
      .max(MAX_MESSAGES),
    /** The viewer's calendar day, so "today" means their today, not UTC's. */
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.messages.at(-1)?.role !== "user") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The last message must be from the user." })
    }
    const total = v.messages.reduce((n, m) => n + m.content.length, 0)
    if (total > MAX_TOTAL_CHARS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Conversation too long — start a new chat." })
    }
  })

export type ChatRequestBody = z.infer<typeof chatRequestSchema>

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request."
}
