import { describe, expect, it } from "vitest"
import { forecastByMonth, forecastSchedules, largestPlanned, mileageNote, type ForecastSchedule } from "./forecast"

const noon = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12))
const from = noon(2026, 10, 24)
const day = (d: Date) => d.toISOString().slice(0, 10)

const sched = (o: Partial<ForecastSchedule> = {}): ForecastSchedule => ({
  id: "s1",
  title: "Task",
  assetType: "PROPERTY",
  assetId: "p1",
  isActive: true,
  estimatedCost: 100,
  intervalDays: null,
  intervalMiles: null,
  dueMonths: null,
  dueDay: null,
  nextDueDate: null,
  nextDueMileage: null,
  ...o,
})

const dates = (s: ForecastSchedule[], f = from, months?: number) => forecastSchedules(s, f, months).occurrences.map((o) => day(o.date))

describe("forecastSchedules", () => {
  it("repeats an interval reminder every intervalDays from its due date", () => {
    const f = forecastSchedules([sched({ nextDueDate: noon(2026, 11, 1), intervalDays: 90, estimatedCost: 38 })], from)
    expect(f.occurrences.map((o) => day(o.date))).toEqual(["2026-11-01", "2027-01-30", "2027-04-30", "2027-07-29"])
    expect(f.total).toBe(152)
  })

  it("counts an overdue interval reminder once today, then repeats from today", () => {
    expect(dates([sched({ nextDueDate: noon(2026, 8, 1), intervalDays: 180 })])).toEqual(["2026-10-24", "2027-04-22"])
  })

  it("uses days when a reminder has both days and miles", () => {
    const f = forecastSchedules([sched({ intervalDays: 180, intervalMiles: 7500, nextDueDate: noon(2026, 12, 1), nextDueMileage: 50000 })], from)
    expect(f.occurrences.map((o) => day(o.date))).toEqual(["2026-12-01", "2027-05-30"])
    expect(f.mileageOnly).toBe(0)
  })

  it("puts a calendar reminder in every listed month", () => {
    expect(dates([sched({ dueMonths: "1,4,7,10", dueDay: 1, nextDueDate: noon(2027, 1, 1) })])).toEqual(["2027-01-01", "2027-04-01", "2027-07-01"])
  })

  it("counts an overdue calendar reminder once today, then at the next listed month", () => {
    expect(dates([sched({ dueMonths: "10", dueDay: 15, nextDueDate: noon(2026, 10, 15) })])).toEqual(["2026-10-24"])
  })

  it("starts a calendar reminder with no due date at the first listed month from today", () => {
    expect(dates([sched({ dueMonths: "11", dueDay: 1, nextDueDate: null })])).toEqual(["2026-11-01"])
  })

  it("counts a one-time item once inside the window", () => {
    const f = forecastSchedules([sched({ nextDueDate: noon(2027, 3, 10), estimatedCost: 14000 })], from)
    expect(f.occurrences).toHaveLength(1)
    expect(f.total).toBe(14000)
    expect(dates([sched({ nextDueDate: noon(2029, 1, 1) })])).toEqual([])
    expect(dates([sched({ nextDueDate: noon(2026, 9, 1) })])).toEqual(["2026-10-24"])
  })

  it("ends the window on the first of the thirteenth month", () => {
    expect(dates([sched({ nextDueDate: noon(2027, 9, 30) })])).toHaveLength(1)
    expect(dates([sched({ nextDueDate: noon(2027, 10, 1) })])).toHaveLength(0)
    expect(dates([sched({ nextDueDate: noon(2026, 10, 31) })], from, 1)).toHaveLength(1)
    expect(dates([sched({ nextDueDate: noon(2026, 11, 1) })], from, 1)).toHaveLength(0)
  })

  it("treats a due date earlier today as today, not overdue", () => {
    const f = forecastSchedules([sched({ nextDueDate: new Date(Date.UTC(2026, 9, 24, 3)) })], from)
    expect(f.occurrences).toHaveLength(1)
    expect(f.occurrences[0].date).toEqual(from)
  })

  it("leaves mileage-only reminders out and counts them", () => {
    const miles = { intervalMiles: 105000, nextDueMileage: 120000, estimatedCost: 900 }
    const oneTime = { nextDueMileage: 60000 }
    const a = forecastSchedules([sched(miles)], from)
    expect(a.occurrences).toEqual([])
    expect(a.mileageOnly).toBe(1)
    expect(forecastSchedules([sched(oneTime)], from).mileageOnly).toBe(1)
    expect(forecastSchedules([sched({ ...miles, estimatedCost: null })], from).mileageOnly).toBe(0)
    expect(forecastSchedules([sched({ ...oneTime, estimatedCost: null })], from).mileageOnly).toBe(0)
    expect(forecastSchedules([sched({ ...miles, isActive: false })], from).mileageOnly).toBe(0)
    expect(forecastSchedules([sched({ ...oneTime, isActive: false })], from).mileageOnly).toBe(0)
  })

  it("counts a days-and-miles reminder that only has a due mileage as mileage-based", () => {
    const f = forecastSchedules([sched({ intervalDays: 180, intervalMiles: 5000, nextDueDate: null, nextDueMileage: 50000, estimatedCost: 80 })], from)
    expect(f.occurrences).toEqual([])
    expect(f.mileageOnly).toBe(1)
    expect(forecastSchedules([sched({ intervalDays: 180, intervalMiles: 5000, nextDueDate: null, nextDueMileage: 50000, estimatedCost: null })], from).mileageOnly).toBe(0)
  })

  it("skips paused reminders but counts snoozed ones", () => {
    expect(dates([sched({ isActive: false, nextDueDate: noon(2026, 11, 15) })])).toEqual([])
    expect(dates([sched({ snoozedUntil: noon(2026, 12, 1), nextDueDate: noon(2026, 11, 15) })])).toEqual(["2026-11-15"])
  })

  it("skips reminders with no cost, a zero cost, or nothing left due", () => {
    expect(dates([sched({ estimatedCost: null, nextDueDate: noon(2026, 11, 15) })])).toEqual([])
    expect(dates([sched({ estimatedCost: 0, nextDueDate: noon(2026, 11, 15) })])).toEqual([])
    const done = forecastSchedules([sched({ nextDueDate: null, nextDueMileage: null })], from)
    expect(done.occurrences).toEqual([])
    expect(done.mileageOnly).toBe(0)
  })

  it("sorts occurrences across schedules by date and rounds the total to cents", () => {
    const f = forecastSchedules(
      [
        sched({ id: "a", title: "Late", estimatedCost: 0.1, nextDueDate: noon(2026, 12, 1) }),
        sched({ id: "b", title: "Early", estimatedCost: 0.2, nextDueDate: noon(2026, 11, 1) }),
      ],
      from
    )
    expect(f.occurrences.map((o) => o.title)).toEqual(["Early", "Late"])
    expect(f.total).toBe(0.3)
  })
})

describe("forecastByMonth", () => {
  const occ = (list: Partial<ForecastSchedule>[]) => forecastSchedules(list.map((o, i) => sched({ id: `s${i}`, ...o })), from).occurrences

  it("buckets occurrences into twelve UTC months, zero-filled", () => {
    const months = forecastByMonth(
      occ([
        { nextDueDate: noon(2026, 11, 1), estimatedCost: 38 },
        { nextDueDate: noon(2027, 1, 30), estimatedCost: 38 },
        { nextDueDate: noon(2027, 3, 10), estimatedCost: 14000 },
      ]),
      from
    )
    expect(months).toHaveLength(12)
    expect(months[0].key).toBe("2026-10")
    expect(months[11].key).toBe("2027-09")
    expect(months[0].start).toEqual(noon(2026, 10, 1))
    expect(months[1]).toMatchObject({ key: "2026-11", total: 38, count: 1 })
    expect(months[0].total).toBe(0)
    expect(months[2].total).toBe(0)
    expect(months[5]).toMatchObject({ key: "2027-03", total: 14000, share: 1 })
    expect(months[1].share).toBeCloseTo(38 / 14000)
  })

  it("buckets by UTC day", () => {
    const months = forecastByMonth(occ([{ nextDueDate: new Date(Date.UTC(2026, 9, 31, 23)), estimatedCost: 50 }]), from)
    expect(months[0]).toMatchObject({ key: "2026-10", total: 50 })
  })

  it("rounds month totals to cents", () => {
    const months = forecastByMonth(
      occ([
        { nextDueDate: noon(2026, 11, 5), estimatedCost: 0.1 },
        { nextDueDate: noon(2026, 11, 6), estimatedCost: 0.2 },
      ]),
      from
    )
    expect(months[1].total).toBe(0.3)
  })
})

describe("largestPlanned", () => {
  const list = [
    sched({ id: "filter", title: "Filter", nextDueDate: noon(2026, 11, 1), intervalDays: 90, estimatedCost: 38 }),
    sched({ id: "roof", title: "Replace roof", nextDueDate: noon(2027, 3, 10), estimatedCost: 14000 }),
  ]
  const occurrences = forecastSchedules(list, from).occurrences

  it("ranks planned items per reminder", () => {
    const items = largestPlanned(occurrences, 8)
    expect(items.map((i) => i.scheduleId)).toEqual(["roof", "filter"])
    expect(items[0]).toMatchObject({ count: 1, share: 1 })
    expect(items[1]).toMatchObject({ total: 152, count: 4 })
    expect(items[1].next.toISOString().slice(0, 10)).toBe("2026-11-01")
  })

  it("keeps only the limit", () => {
    expect(largestPlanned(occurrences, 1).map((i) => i.scheduleId)).toEqual(["roof"])
  })
})

describe("mileageNote", () => {
  it("words the note, and says nothing for 0", () => {
    expect(mileageNote(0)).toBeNull()
    expect(mileageNote(1)).toBe("1 mileage-based reminder isn't included.")
    expect(mileageNote(2)).toBe("2 mileage-based reminders aren't included.")
  })
})
