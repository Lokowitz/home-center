import { describe, expect, it } from "vitest"
import { calendarLevel, calendarRanges, observationCalendar, utcDay } from "./observation-calendar"

const d = (s: string) => new Date(s)
const t = (s: string) => d(s).getTime()

describe("observationCalendar", () => {
  const obs = [
    { date: d("2026-09-02"), type: "Meltdown" },
    { date: d("2026-09-02"), type: "Rude" },
    { date: d("2026-09-30"), type: "Rage" },
    { date: d("2026-10-20"), type: "Outside range" },
  ]
  // Wednesday Sep 2 to Thursday Oct 1, 2026.
  const cal = observationCalendar(obs, t("2026-09-02"), t("2026-10-01"))

  it("lays weeks out Monday-first with partial edge columns", () => {
    expect(new Date(cal.weeks[0].start).toISOString().slice(0, 10)).toBe("2026-08-31")
    expect(cal.weeks[0].days.slice(0, 2)).toEqual([null, null])
    expect(cal.weeks).toHaveLength(5)
    expect(cal.weeks[4].days.slice(4)).toEqual([null, null, null])
  })
  it("counts each day and keeps its titles", () => {
    expect(cal.weeks[0].days[2]).toEqual({ day: t("2026-09-02"), count: 2, rating: 1, titles: ["Meltdown", "Rude"] })
    expect(cal.max).toBe(2)
    expect(cal.total).toBe(3)
  })
  it("rates each day by its worst entry", () => {
    const rated = observationCalendar([
      { date: d("2026-09-02"), type: "Rude", severity: 2 }, { date: d("2026-09-02"), type: "Rage", severity: 5 },
      { date: d("2026-09-02"), type: "Note" },
    ], t("2026-09-02"), t("2026-09-03"))
    expect(rated.weeks[0].days[2]).toMatchObject({ count: 3, rating: 5 })
    expect(rated.weeks[0].days[3]).toMatchObject({ count: 0, rating: 0 })
  })
  it("labels the first month with its year and later months by name", () => {
    expect(cal.months).toEqual([{ label: "Sep 2026", week: 0 }, { label: "Oct", week: 4 }])
  })
})

describe("calendarRanges", () => {
  it("offers the last 12 months then each year with data, newest first", () => {
    const r = calendarRanges([d("2024-03-01"), d("2026-05-01"), d("2024-07-01")], d("2026-10-16T15:00:00Z"))
    expect(r.map((x) => x.value)).toEqual(["12m", "2026", "2024"])
    expect(r[0].from).toBe(t("2025-10-17"))
    expect(r[0].to).toBe(t("2026-10-16"))
    expect(r[1].to).toBe(t("2026-10-16"))
    expect(r[2].to).toBe(t("2024-12-31"))
  })
})

describe("calendarLevel and utcDay", () => {
  it("caps the shade at three or more", () => {
    expect([0, 1, 2, 3, 5, 7, -1].map(calendarLevel)).toEqual([0, 1, 2, 3, 5, 5, 0])
  })
  it("drops the time of day", () => {
    expect(utcDay(d("2026-09-02T18:30:00Z"))).toBe(t("2026-09-02"))
  })
})
