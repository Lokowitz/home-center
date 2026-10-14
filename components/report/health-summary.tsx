import { Empty, SectionTitle } from "./report-parts"
import type { Formatter } from "@/lib/regional"
import {
  ALLERGY_SEVERITIES, CONDITION_STATUSES, INSURANCE_KINDS, isMedicationActive, labelFor,
} from "@/lib/health"
import type { ReportHealth } from "@/lib/report-server"
import {
  filterObservations, formatDuration, summarizeObservations, type RangeValue,
} from "@/lib/observations"

// Ordered the way a clinician reads a chart: what could hurt them, what they
// have, what they take, what they've had, who pays, who treats them.
export function HealthSummary({ health, now, observationDays, fmt }: { health: ReportHealth; now: Date; observationDays: number | null; fmt: Formatter }) {
  const { person, careTeam } = health
  const day = (d: Date | null | undefined) => (d ? fmt.date(d, { utc: true }) : "—")
  const conditions = person.conditions.filter((c) => c.status !== "RESOLVED")
  const resolved = person.conditions.length - conditions.length
  const medications = person.medications.filter((m) => isMedicationActive(m, now))

  return (
    <>
      <section className="report-section report-break-avoid mt-7">
        <SectionTitle>Allergies</SectionTitle>
        {person.allergies.length === 0 ? (
          <Empty>No allergies recorded.</Empty>
        ) : (
          <Rows
            head={["Substance", "Severity", "Reaction"]}
            rows={person.allergies.map((a) => [
              a.substance,
              // Spelled out in capitals, not coloured: it has to survive a monochrome printer.
              a.severity === "SEVERE" ? <strong key="s">SEVERE</strong> : labelFor(ALLERGY_SEVERITIES, a.severity),
              a.reaction ?? "—",
            ])}
          />
        )}
      </section>

      <section className="report-section report-break-avoid mt-7">
        <SectionTitle>Active conditions</SectionTitle>
        {conditions.length === 0 ? (
          <Empty>No active conditions recorded.</Empty>
        ) : (
          <Rows
            head={["Condition", "Status", "Since", "Provider"]}
            rows={conditions.map((c) => [c.name, labelFor(CONDITION_STATUSES, c.status), day(c.diagnosedDate), c.provider?.name ?? "—"])}
          />
        )}
        {resolved > 0 && <Empty>{resolved} resolved condition{resolved === 1 ? "" : "s"} not shown.</Empty>}
      </section>

      <section className="report-section report-break-avoid mt-7">
        <SectionTitle>Current medications</SectionTitle>
        {medications.length === 0 ? (
          <Empty>No current medications.</Empty>
        ) : (
          <Rows
            head={["Medication", "Dose", "Prescriber", "Since"]}
            rows={medications.map((m) => [
              m.name,
              [m.dosage, m.frequency].filter(Boolean).join(" · ") || "—",
              m.prescriber?.name ?? "—",
              day(m.startDate),
            ])}
          />
        )}
      </section>

      <section className="report-section report-break-avoid mt-7">
        <SectionTitle>Immunizations</SectionTitle>
        {person.immunizations.length === 0 ? (
          <Empty>No immunizations recorded.</Empty>
        ) : (
          <Rows
            head={["Vaccine", "Given", "Next due"]}
            rows={person.immunizations.map((i) => [i.dose ? `${i.vaccine} (${i.dose})` : i.vaccine, day(i.dateGiven), day(i.nextDueDate)])}
          />
        )}
      </section>

      {observationDays != null && <Observations rows={person.observations} days={observationDays} now={now} fmt={fmt} />}

      <section className="report-section report-break-avoid mt-7">
        <SectionTitle>Insurance</SectionTitle>
        {person.insurancePolicies.length === 0 ? (
          <Empty>No insurance on file.</Empty>
        ) : (
          <Rows
            head={["Carrier", "Type", "Member ID", "Group", "Phone", "Deductible"]}
            rows={person.insurancePolicies.map((p) => [
              p.planName ? `${p.carrier} · ${p.planName}` : p.carrier,
              labelFor(INSURANCE_KINDS, p.kind),
              p.memberId ?? "—",
              p.groupNumber ?? "—",
              p.phone ?? "—",
              p.deductible != null ? fmt.money(p.deductible) : "—",
            ])}
          />
        )}
      </section>

      <section className="report-section report-break-avoid mt-7">
        <SectionTitle>Care team</SectionTitle>
        {careTeam.length === 0 ? (
          <Empty>No providers linked.</Empty>
        ) : (
          <Rows
            head={["Provider", "Specialty", "Practice", "Phone"]}
            rows={careTeam.map((p) => [p.name, p.specialty ?? "—", p.practice ?? "—", p.phone ?? "—"])}
          />
        )}
      </section>
    </>
  )
}

function Observations({ rows, days, now, fmt }: { rows: ReportHealth["person"]["observations"]; days: number; now: Date; fmt: Formatter }) {
  const day = (d: Date | null | undefined) => (d ? fmt.date(d, { utc: true }) : "—")
  const shown = filterObservations(rows, { range: String(days) as RangeValue }, now)
  const summary = summarizeObservations(shown)
  return (
    <section className="report-section mt-7">
      <SectionTitle>Observations — last {days} days</SectionTitle>
      {shown.length === 0 ? (
        <Empty>Nothing logged in this period.</Empty>
      ) : (
        <>
          <p className="mt-1 text-[10pt]">
            {summary.byType.map((t) => `${t.type}: ${t.count}`).join(" · ")}
            {summary.avgSeverity != null && ` · average severity ${summary.avgSeverity} / 5`}
          </p>
          <Rows
            head={["When", "What", "Severity", "Duration", "Notes"]}
            rows={shown.map((o) => [
              `${day(o.date)}${o.time ? ` ${fmt.clock(o.time)}` : ""}`,
              o.condition ? `${o.type} (${o.condition.name})` : o.type,
              o.severity ? `${o.severity} / 5` : "—",
              formatDuration(o.durationMinutes),
              [o.notes, o.tags ? `Tags: ${o.tags}` : null].filter(Boolean).join(" — ") || "—",
            ])}
          />
        </>
      )}
    </section>
  )
}

function Rows({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="mt-1 w-full border-collapse text-[10pt]">
      <thead>
        <tr>
          {head.map((h) => (
            <th
              key={h}
              className="border-b py-1.5 pr-3 text-left text-[8.5pt] font-semibold uppercase tracking-wide"
              style={{ borderColor: "var(--rule-strong)", color: "var(--ink-faint)" }}
              data-print-color=""
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className="border-b py-1.5 pr-3 align-top" style={{ borderColor: "var(--rule)" }} data-print-color="">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
