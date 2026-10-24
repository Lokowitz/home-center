import type { AttachmentRecordType } from "@/app/generated/prisma/client"

// Every number the document pipeline depends on, in one place. Values are
// from docs/superpowers/specs/2026-09-30-document-search-design.md.

/** Bump to re-extract every file (e.g. after improving an extractor). */
export const EXTRACTOR_VERSION = 1
/** Bump to drop and rebuild search-index.db from AttachmentText. */
export const INDEX_SCHEMA_VERSION = 1

export const MAX_TEXT_CHARS = 2_000_000
export const MAX_OCR_PAGES = 30
export const EXTRACT_TIMEOUT_MS = 120_000
export const OCR_TIMEOUT_MS = 600_000
export const MAX_ATTEMPTS = 3
/** Heap cap for the extraction worker; past it the worker dies, not the server. */
export const EXTRACT_HEAP_MB = 1024
/** Added to the extract timeouts for the worker to start and compile the extractors. */
export const EXTRACT_WORKER_GRACE_MS = 15_000

/** Separates pages in AttachmentText.text. */
export const PAGE_BREAK = "\f"

/** Hidden from the assistant unless LlmSettings.healthDocumentsEnabled. Insurance is handled by policy kind, not record type. */
export const HEALTH_RECORD_TYPES = [
  "CONDITION", "OBSERVATION", "MEDICATION", "ALLERGY", "IMMUNIZATION",
] as const satisfies readonly AttachmentRecordType[]

/** Files OCR can add text to — re-queued when OCR is switched on. */
export const OCR_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"]
