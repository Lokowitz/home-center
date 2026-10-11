@AGENTS.md

# home-center

## Key files
- `prisma/schema.prisma`: data model. Read it before changing any model, query or page that reads or writes data.
- `README.md`: setup and project overview. Check it before asking how to run or configure the app.
- `app/(app)/layout.tsx`: shared layout for all authenticated pages. It works together with `components/sidebar.tsx` (navigation).
- `app/(app)/page.tsx`: dashboard. Its cards live in `components/dashboard/summary-card.tsx`.
- `app/(app)/maintenance/page.tsx`: maintenance page.
- `app/(app)/assets/people/[id]/page.tsx`, `app/(app)/assets/properties/[id]/page.tsx`, `app/(app)/assets/vehicles/[id]/page.tsx`: asset detail pages. When you change one, check whether the other two need the same change.
- `components/settings/llm-settings.tsx`: LLM settings UI.
