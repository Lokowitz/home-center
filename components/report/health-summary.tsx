import { Empty, SectionTitle } from "./report-parts"
import { MedicationReview, ObservationChartSection } from "./medication-review"
import type { Formatter } from "@/lib/regional"
import {
  ALLERGY_SEVERITIES, CONDITION_STATUSES, INSURANCE_KINDS, isMedicationActive, labelFor,
} from "@/lib/health"
import type { ReportHealth } from "@/lib/report-server"
import { filterObservations, formatDuration, type RangeValue } from "@/lib/observations"
import { obsDays, rangeLabel, type ReportOptions } from "@/lib/report-options"

// Ordered the way a clinician reads a chart: what could hurt them, what they
// have, what they take, what they've had, who pays, who treats them.
export function HealthSummary({ health, now, options, fmt }: { health: ReportHealth; now: Date; options: ReportOptions; fmt: Formatter }) {
  const observationDays = obsDays(options)
  const { person, careTeam } = health
  const day = (d: Date | null | undefined) => (d ? fmt.date(d, { utc: true }) : "—")
  const conditions = person.conditions.filter((c) => c.status !== "RESOLVED")
  const resolved = person.conditions.length - conditions.length
  const medications = person.medications.filter((m) => isMedicationActive(m, now))

  return (
    <>
      {options.allergies && (
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
      )}

      {options.conditions && (
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
      )}

      {options.medications && (
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
      )}

      {options.immunizations && (
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
      )}


      {options.insurance && (
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
      )}

      {options.careTeam && (
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
      )}

      <MedicationReview
        medications={person.medications}
        observations={person.observations.map((o) => ({ date: o.date, type: o.type, severity: o.severity }))}
        now={now}
        fmt={fmt}
        show={{ review: options.review, history: options.history, list: options.medList, listNotes: options.medListNotes, changes: options.changes }}
        historyRange={options.historyRange}
      />

      {observationDays != null && (
        <>
          {options.obsView !== "none" && (
            <ObservationChartSection
              observations={person.observations.map((o) => ({ date: o.date, type: o.type, severity: o.severity }))}
              medications={person.medications}
              days={observationDays}
              view={options.obsView}
              now={now}
              fmt={fmt}
            />
          )}
          {options.obsList && <Observations rows={person.observations} days={observationDays} notes={options.obsNotes} now={now} fmt={fmt} />}
        </>
      )}
    </>
  )
}

function Observations({ rows, days, notes, now, fmt }: { rows: ReportHealth["person"]["observations"]; days: number | "all"; notes: boolean; now: Date; fmt: Formatter }) {
  const day = (d: Date | null | undefined) => (d ? fmt.date(d, { utc: true }) : "—")
  const shown = filterObservations(rows, { range: String(days) as RangeValue }, now)
  return (
    <section className="report-section mt-7">
      <SectionTitle>Observation entries — {rangeLabel(days)}</SectionTitle>
      {shown.length === 0 ? (
        <Empty>Nothing logged in this period.</Empty>
      ) : (
        <>
          <Rows
            head={notes ? ["When", "What", "Severity", "Duration", "Notes"] : ["When", "What", "Severity", "Duration"]}
            rows={shown.map((o) => [
              `${day(o.date)}${o.time ? ` ${fmt.clock(o.time)}` : ""}`,
              o.condition ? `${o.type} (${o.condition.name})` : o.type,
              o.severity ? `${o.severity} / 5` : "—",
              formatDuration(o.durationMinutes),
              ...(notes ? [[o.notes, o.tags ? `Tags: ${o.tags}` : null].filter(Boolean).join(" — ") || "—"] : []),
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
