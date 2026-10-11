import { describe, expect, it } from "vitest"
import { parseReceipt } from "./parse"

const today = new Date("2026-10-10T12:00:00Z")
const p = (t: string) => parseReceipt(t, today)

describe("parseReceipt date", () => {
  it("prefers a labelled invoice date over a due or print date", () => {
    const t = "Acme Plumbing\nPrinted 10/09/2026\nDue Date: 11/05/2026\nInvoice Date: 10/05/2026\nTotal $120.00"
    expect(p(t).date).toBe("2026-10-05")
  })
  it("a 'Due' on the line above doesn't veto a labelled statement date", () => {
    const t = "Water Co\nDue Date: 11/02/2026\nAmount Due: $64.20\nStatement Date: 10/08/2026"
    expect(p(t).date).toBe("2026-10-08")
  })
  it("without a label, skips a reprint or due date for the transaction date", () => {
    expect(p("Garden Center\nREPRINT 10/09/2026 08:15\nTOTAL 58.30\n10/04/2026 3:47 PM").date).toBe("2026-10-04")
    expect(p("Shop\nPayment due 11/01/2026\n10/04/2026").date).toBe("2026-10-04")
    expect(p("Shop\nREPRINT 10/09/2026").date).toBe("2026-10-09")
  })
  it("reads MM/DD/YYYY", () => expect(p("Shop\n03/14/2025 thanks").date).toBe("2025-03-14"))
  it("reads YYYY-MM-DD", () => expect(p("Shop\n2025-03-14").date).toBe("2025-03-14"))
  it("reads 'Oct 5, 2026'", () => expect(p("Shop\nOct 5, 2026").date).toBe("2026-10-05"))
  it("reads '5-Oct-26'", () => expect(p("Shop\n5-Oct-26").date).toBe("2026-10-05"))
  it("rejects years past next year", () => {
    expect(p("Shop\n01/01/2028").date).toBeNull()
    expect(p("Shop\n01/01/2027").date).toBe("2027-01-01")
  })
  it("bounds the year by the injected today", () => {
    expect(parseReceipt("Shop\n01/01/2031", new Date("2030-06-01")).date).toBe("2031-01-01")
  })
  it("picks the most common date without a label", () => {
    expect(p("Shop\n01/02/2026 x 03/04/2026 y 03/04/2026").date).toBe("2026-03-04")
  })
  it("returns null with no date", () => expect(p("Shop\nno dates here").date).toBeNull())
  it("never takes a date of birth, even right after a 'Date' label", () => {
    expect(p("Clinic\nPatient: A. Person\nDate of Birth: 2009-12-29\nVisit 03/14/2025").date).toBe("2025-03-14")
    expect(p("Clinic\nDOB: 01/02/1980\nSeen 03/14/2025").date).toBe("2025-03-14")
    expect(p("Clinic\nBirth date 01/02/1980\n03/14/2025").date).toBe("2025-03-14")
  })
  it("reads collection, procedure and visit dates as labelled", () => {
    expect(p("Lab\n10/20/23, 7:10 AM\nCollected on 10/18/2023 11:52 AM\n10/20/23, 7:10 AM").date).toBe("2023-10-18")
    expect(p("Lab\nResult 10/9/26\nCollection Date: 10/8/26").date).toBe("2026-10-08")
    expect(p("Clinic\nPrinted 5/29/24\nProcedure Date: 5/28/2024").date).toBe("2024-05-28")
    expect(p("Clinic\nDate of Visit: 7/7/2022\n7/9/22").date).toBe("2022-07-07")
  })
  it("treats a browser print stamp ('10/20/23, 7:10 AM') as a print date", () => {
    expect(p("Shop\n10/20/23, 7:10 AM\nSold 10/18/2023\n10/20/23, 7:10 AM").date).toBe("2023-10-18")
    // ...unless that's the only date there is.
    expect(p("Shop\n10/20/23, 7:10 AM").date).toBe("2023-10-20")
  })
})

describe("parseReceipt total", () => {
  it("Grand Total beats subtotal and tax", () => {
    const t = "Shop\nSubtotal 100.00\nTax 8.25\nGrand Total 108.25\nCash 120.00\nChange 11.75"
    expect(p(t).total).toBe(108.25)
  })
  it("ignores the late amount owed after the due date", () => {
    expect(p("Water Co\nAmount Due: $64.20\nAmount Due After 11/02/2026: $70.62").total).toBe(64.2)
    expect(p("Water Co\nTotal Due 64.20\nTotal with late fee 70.62").total).toBe(64.2)
  })
  it("reads an amount on the line after the label", () => {
    expect(p("Shop\nAmount Due\n\n$45.10\nSubtotal 40.00").total).toBe(45.1)
  })
  it("handles thousands separators", () => expect(p("Shop\nTotal: $1,234.56").total).toBe(1234.56))
  it("falls back to the largest amount", () => expect(p("Shop\n12.00\n15.50").total).toBe(15.5))
  it("returns null with no amounts", () => expect(p("Shop\nnothing to pay").total).toBeNull())
  it("handles tabs", () => {
    const r = p("Shop\nInvoice Date:\t10/05/2026\nTotal\t\t$99.99")
    expect(r).toEqual({ date: "2026-10-05", total: 99.99, vendor: "Shop" })
  })
})

describe("parseReceipt vendor", () => {
  it("skips INVOICE, Receipt and Page lines", () => {
    expect(p("INVOICE\nPage 1\nReceipt\n  Bob's Garage LLC  \n123 Main").vendor).toBe("Bob's Garage LLC")
  })
  it("skips lines without three letters", () => expect(p("12345\n--\nAce Hardware").vendor).toBe("Ace Hardware"))
  it("truncates to 60 chars", () => expect(p("A".repeat(80)).vendor).toHaveLength(60))
  it("skips job, order, ref, PO, account, ticket and transaction number lines", () => {
    expect(p("Job #188200417\nCopperline Chimney Sweeps").vendor).toBe("Copperline Chimney Sweeps")
    expect(p("Order Number: QX55120847\nWillowmere Home Goods").vendor).toBe("Willowmere Home Goods")
    expect(p("Ref: AB-77120\nPO# 55102\nAccount No. 4471-2290\nTicket 00412\nTransaction ID: T9981\nFernlake Glass").vendor).toBe("Fernlake Glass")
    expect(p("Work Order WO-3381\nAcct: 99812\nConfirmation # ZK41\nGreystone Movers").vendor).toBe("Greystone Movers")
  })
  it("skips date lines", () => {
    expect(p("Jan 12, 2024\nHollowbrook Dental Group").vendor).toBe("Hollowbrook Dental Group")
    expect(p("Monday, March 3, 2025 10:42 AM\n10/04/2026 3:47 PM\nAshgrove Bakery").vendor).toBe("Ashgrove Bakery")
  })
  it("skips phone numbers, URLs, emails and mostly-digit lines", () => {
    const t = "(555) 201-7740\nTel: 555-201-7741\nwww.quarryhillelectric.test\nhttps://pay.quarryhillelectric.test/inv\nbilling@quarryhillelectric.test\n4471 2290 1183 AB\nPage 2 of 3\nQuarry Hill Electric"
    expect(p(t).vendor).toBe("Quarry Hill Electric")
  })
  it("trims leading and trailing OCR punctuation instead of rejecting the line", () => {
    expect(p(">. FAIRWEATHER TIRE\n12 Elm St").vendor).toBe("FAIRWEATHER TIRE")
    expect(p("** Brambleton Feed & Seed --\n12 Elm St").vendor).toBe("Brambleton Feed & Seed")
    expect(p("|  Allbright Plumbing Co.  |").vendor).toBe("Allbright Plumbing Co.")
  })
  it("still takes an address-led vendor and a name with a number", () => {
    expect(p("7-Star Car Wash\n100 Main St").vendor).toBe("7-Star Car Wash")
    // Names that start like a month or weekday are not date lines.
    expect(p("Sunoco 4471\nPump 3").vendor).toBe("Sunoco 4471")
    expect(p("Mayfair Cleaners #12").vendor).toBe("Mayfair Cleaners #12")
  })
  it("skips the household's own names and greetings", () => {
    const names = ["Pat Example", "Robin Example"]
    expect(parseReceipt("PAT EXAMPLE\n12 Elm St\nOakridge Heating", today, { householdNames: names }).vendor).toBe("Oakridge Heating")
    expect(parseReceipt("Pat & Robin Example\nOakridge Heating", today, { householdNames: names }).vendor).toBe("Oakridge Heating")
    expect(p("Hi PAT,\nThanks for your order\nOakridge Heating").vendor).toBe("Oakridge Heating")
  })
  it("skips labels, document titles, table headers and money lines", () => {
    expect(p("RECIPIENT\nESTIMATE\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("Name: Pat Example | DOB: 1/1/80\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("Issued date:Tue Jul 8, 2025\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("Order Summary\nOrder Total: $701.88\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("Item Description Quantity Price Amount\nTrip Fee 1.00 100.00 $100.00\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("WARNING\nInspection Report\nOakridge Heating").vendor).toBe("Oakridge Heating")
  })
  it("skips street-address lines but keeps a name that starts with a number", () => {
    expect(p("1535 Baker Rd PO Box 278\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("PO Box 12\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("7-Star Car Wash\n100 Main St").vendor).toBe("7-Star Car Wash")
  })
  it("skips city/state/ZIP, country and bare 'date' heading lines", () => {
    expect(p("Dexter, MI 48130\nUnited States\nDue date\nESTIMATE DATE\nOakridge Heating").vendor).toBe("Oakridge Heating")
    expect(p("DEXTER, MI 48130-8620\nUSA\nOakridge Heating").vendor).toBe("Oakridge Heating")
  })
  it("takes an email's sender name", () => {
    const names = ["Pat Example"]
    const t = "Pat Example <pat@mail.test>\nHere's your receipt\nOakridge Parts <orders@em.oakridgeparts.test> Fri, Jul 24, 2026\nItem list"
    expect(parseReceipt(t, today, { householdNames: names }).vendor).toBe("Oakridge Parts")
  })
  it("falls back to the shop's email or web domain when no line names it", () => {
    const t = "12 Elm St\nDexter, MI 48130\ninfo@oakridgemechanical.test\nBILL TO\nPAT EXAMPLE\nTERMS Cash On Delivery"
    expect(parseReceipt(t, today, { householdNames: ["Pat Example"] }).vendor).toBe("oakridgemechanical.test")
    // Free mail is the customer's, not the shop's.
    expect(p("12 Elm St\npat@gmail.com\nTERMS Net 30").vendor).toBe("TERMS Net 30")
  })
  it("prefers the line that matches the shop's domain over the domain itself", () => {
    expect(p("Thanks for visiting\nAce Hardware\nwww.acehardware.test").vendor).toBe("Ace Hardware")
  })
  it("skips OCR letter soup", () => {
    expect(p("g ro u p @@@3 h 1 tt4 t5 b 8 9 5 4 k n jj9 x v\nOakridge Heating").vendor).toBe("Oakridge Heating")
  })
  it("prefers a line that names a business over an earlier plain line", () => {
    expect(p("Thank you for choosing us\nWe appreciate it\nOakridge Mechanical LLC\n12 Elm St").vendor).toBe("Oakridge Mechanical LLC")
    expect(p("Quarry Hill\nquarry hill electric co").vendor).toBe("quarry hill electric co")
    // Trade words alone don't count: item lines are full of them.
    expect(p("Belmont Tire\nChecked electrical connections\nService Details").vendor).toBe("Belmont Tire")
    // ...nor a line that comes after a bill-to label: that's the customer.
    expect(p("Ace Hardware\nBill To:\nExample Services LLC").vendor).toBe("Ace Hardware")
  })
})

describe("parseReceipt edge inputs", () => {
  it("empty string", () => expect(p("")).toEqual({ date: null, total: null, vendor: null }))
  it("whitespace only", () => expect(p(" \t\n ")).toEqual({ date: null, total: null, vendor: null }))
  it("text with no newlines", () => {
    expect(p("Joe's Auto Invoice Date 10/01/2026 Subtotal 50.00 Total 54.00")).toEqual({
      date: "2026-10-01", total: 54, vendor: null,
    })
  })
  it("multi-paragraph text", () => {
    const t = "Northside HVAC\n\nService Date: Sep 3, 2026\n\nLabor 200.00\nParts 50.00\n\nTotal Due $250.00\n"
    expect(p(t)).toEqual({ date: "2026-09-03", total: 250, vendor: "Northside HVAC" })
  })
})
