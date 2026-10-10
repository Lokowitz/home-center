// Synthetic receipt/invoice texts for the parser accuracy regression set
// (lib/capture/accuracy.test.ts). Every business, address, phone number,
// account number and amount here is invented — no real documents are used.
//
// The texts imitate how extracted text really varies: thermal-printer
// receipts, PDF text layers where labels and values land on separate lines,
// OCR noise, columnar extraction, refunds and print timestamps.
//
// `knownMiss: true` marks texts the parser is expected to get wrong today;
// `why` says what it trips on. They count against the accuracy score but are
// not asserted field by field. When a parser change fixes one, the test says
// so — drop the flag to lock the fix in.
//
// Conventions: totals are magnitudes (a refund of $96.29 is 96.29 — the parser
// doesn't capture sign); vendor matches when the parsed vendor contains the
// expected text, ignoring case.

export type ReceiptExpectation = { date: string | null; total: number | null; vendor: string | null }

export type ReceiptFixture = {
  id: string
  text: string
  expected: ReceiptExpectation
  knownMiss?: true
  why?: string
}

/** The fixed "today" the set is written against (bounds the accepted year). */
export const FIXTURE_TODAY = new Date("2026-10-10T12:00:00Z")

export const RECEIPT_FIXTURES: ReceiptFixture[] = [
  // ── Auto shops ────────────────────────────────────────────────────────────
  {
    id: "auto-shop-invoice-labor-parts",
    text: `Riverside Auto Care
4471 Canal Rd, Millbrook, OH 44090
(555) 201-7740
INVOICE # RA-20931
Invoice Date: 09/22/2026
Customer: J. Sample
Vehicle: 2019 Subaru Outback   Odometer In: 84,213
LABOR
Replace front brake pads and rotors   2.30 hrs @ 145.00   333.50
Four wheel alignment                  1.00 hrs @ 120.00   120.00
PARTS
Brake pad set, front     1    68.99    68.99
Rotor, front             2    54.25   108.50
Total Labor     453.50
Total Parts     177.49
Shop Supplies    14.95
Subtotal        645.94
Sales Tax 7.25% 12.87
Grand Total     658.81
Thank you for your business!`,
    expected: { date: "2026-09-22", total: 658.81, vendor: "Riverside Auto Care" },
  },
  {
    id: "auto-shop-pdf-label-value-lines",
    text: `Page 1 of 1
INVOICE
Kessler Tire & Brake
900 Industrial Pkwy
Dunmore, PA 18509
Invoice Date
10/02/2026
Invoice Number
88412
Promised Date
10/03/2026
Parts
212.40
Labor
189.00
Subtotal
401.40
Tax
15.40
Total
416.80`,
    expected: { date: "2026-10-02", total: 416.8, vendor: "Kessler Tire & Brake" },
  },
  {
    id: "auto-shop-repair-order-paid",
    text: `Harlan Street Garage
Repair Order 55102
Date: 08/14/2026   Time In: 7:45 AM
Year/Make/Model: 2015 Ford F-150
Oil & filter change, synthetic   89.95
Tire rotation                    29.00
Cabin air filter                 34.50
Total Hours 0.80
Subtotal 153.45
Tax 6.39
Total Amount 159.84
Amount Paid 159.84
Balance Due 0.00
Next Service Due: 11/14/2026 or 91,500 mi`,
    expected: { date: "2026-08-14", total: 159.84, vendor: "Harlan Street Garage" },
  },
  {
    id: "auto-shop-estimate",
    text: `Lakeside Collision Center
ESTIMATE
Estimate #: E-30417
Date: Sep 28, 2026
Estimate valid until Oct 28, 2026
Rear bumper cover R&I        2.0 hr   130.00
Refinish rear bumper         2.6 hr   169.00
Paint materials                       118.30
Bumper reinforcement                  246.75
Subtotal 664.05
Tax 22.04
Estimated Total $686.09`,
    expected: { date: "2026-09-28", total: 686.09, vendor: "Lakeside Collision Center" },
  },

  // ── Big-box and grocery ───────────────────────────────────────────────────
  {
    id: "big-box-visa-tend",
    text: `BRIGHTMART
Save more. Live brighter.
Store #2281   Mgr: DANA
1800 Prairie Commons Dr
Fairview, IL 62208
ST# 2281 OP# 004417 TE# 14 TR# 05531
PAPER TOWEL 12PK    012345678901    18.97 F
DISH SOAP 24OZ      012345678902     3.47 N
BANANAS             000000004011     1.38 N
  2.04 lb @ 0.68 /lb
MILK 1GAL 2%        012345678903     3.29 F
LAUNDRY DET 92OZ    012345678904    13.97 N
AA BATTERIES 8PK    012345678905     7.88 T
BREAD WHITE         012345678906     1.98 F
EGGS LARGE 18CT     012345678907     4.12 F
COFFEE 30.5OZ       012345678908    11.48 F
TRASH BAGS 45CT     012345678909     9.97 N
SPONGES 6PK         012345678910     4.97 N
DOG TREATS          012345678911    15.35 N
SUBTOTAL            96.63
TAX 1  6.250 %       4.21
TOTAL              100.84
VISA TEND          100.84
VISA **** **** **** 4417
APPROVAL # 05521K
REF # 628300512
CHANGE DUE           0.00
# ITEMS SOLD 13
TC# 4471 0093 1120 5568 2201
10/03/26        14:22:51`,
    expected: { date: "2026-10-03", total: 100.84, vendor: "BRIGHTMART" },
  },
  {
    id: "big-box-cash-change",
    text: `HOMEBASE WAREHOUSE
#0912 Riverbend
  WOOD SCREWS 1LB      8.97
  PAINTERS TAPE 2PK    9.48
  SANDPAPER ASST       6.27
SUBTOTAL     24.72
SALES TAX     1.67
TOTAL        26.39
CASH TEND    40.00
CHANGE DUE   13.61
09/30/2026 10:18 AM  STORE 0912 REG 07`,
    expected: { date: "2026-09-30", total: 26.39, vendor: "HOMEBASE WAREHOUSE" },
  },
  {
    id: "big-box-savings-and-coupon-expiry",
    text: `PANTRY PLUS FOODS
Store 118  (555) 310-2299
ORGANIC SPINACH      3.99
CHEDDAR BLOCK        5.49
  PLUS CARD SAVINGS   1.00-
CHICKEN THIGHS       9.84
SPARKLING WATER 12   5.99
SUBTOTAL            25.31
TOTAL SAVINGS        1.00
TAX                  0.42
TOTAL               25.73
DEBIT TEND          25.73
10/06/2026 18:41  T# 3 TR# 2290
Save $2 on your next visit!
Coupon expires 11/30/2026`,
    expected: { date: "2026-10-06", total: 25.73, vendor: "PANTRY PLUS FOODS" },
  },
  {
    id: "grocery-balance-label",
    text: `GREENBASKET MARKET
1450 Orchard Ave
    YOGURT 32OZ          4.29
    APPLES GALA          5.12
    ROTISSERIE CHKN      7.99
    TORTILLA CHIPS       3.49
**** BALANCE          20.89
CASH                  40.00
CHANGE                19.11
TOTAL SAVINGS          2.10
10/01/26 12:07pm 0118 03 4471 220`,
    expected: { date: "2026-10-01", total: 20.89, vendor: "GREENBASKET MARKET" },
    knownMiss: true,
    why: "The total is labelled only BALANCE, which isn't a total label, so it falls back to the largest amount (cash tendered).",
  },
  {
    id: "pharmacy-receipt",
    text: `CORNERSTONE PHARMACY #4410
62 Elm St, Ashford, CT 06278
10/04/2026  9:15 AM
ALLERGY RELIEF 30CT       12.99
  REWARDS PRICE           -3.00
THERMOMETER DIGITAL        9.49
HAND SANITIZER             2.79
SUBTOTAL                  22.27
TAX 6.35%                  1.41
TOTAL                     23.68
MASTERCARD                23.68
You saved $3.00 today!
Returns accepted with receipt until 11/03/2026`,
    expected: { date: "2026-10-04", total: 23.68, vendor: "CORNERSTONE PHARMACY" },
  },
  {
    id: "gas-station-mmddyy",
    text: `QuickFuel #0377
I-80 & Route 9
10/08/26 07:12
PUMP# 6   REGULAR
12.418 GAL @ 3.459/GAL
FUEL TOTAL $ 42.95
CREDIT        42.95
AUTH 448120`,
    expected: { date: "2026-10-08", total: 42.95, vendor: "QuickFuel" },
  },
  {
    id: "hardware-refund",
    text: `Hollis Hardware & Lumber
33 Depot St
RETURN
10/07/2026 11:03 AM  Reg 2
Orig Trans 10/01/2026 Reg 2 #4471
-1 CORDLESS DRILL 18V     -89.99
SUBTOTAL                  -89.99
TAX                        -6.30
TOTAL                     -96.29
REFUND TO VISA             96.29`,
    expected: { date: "2026-10-07", total: 96.29, vendor: "Hollis Hardware & Lumber" },
  },
  {
    id: "columnar-labels-then-values",
    text: `TRAILHEAD SPORTS
Store 22
SUBTOTAL
TAX
TOTAL
VISA TEND
CHANGE DUE
54.10
3.79
57.89
57.89
0.00
09/27/2026 16:05`,
    expected: { date: "2026-09-27", total: 57.89, vendor: "TRAILHEAD SPORTS" },
  },
  {
    id: "columnar-cash-tendered",
    text: `TRAILHEAD SPORTS
Store 22
SUBTOTAL
TAX
TOTAL
CASH TEND
CHANGE DUE
54.10
3.79
57.89
60.00
2.11
09/27/2026 16:12`,
    expected: { date: "2026-09-27", total: 57.89, vendor: "TRAILHEAD SPORTS" },
    knownMiss: true,
    why: "Labels and values are in separate blocks, so TOTAL finds no amount nearby; the fallback takes the largest amount (cash tendered).",
  },

  // ── Utilities and recurring services ─────────────────────────────────────
  {
    id: "utility-electric-amount-due",
    text: `Lakeshore Electric Cooperative
PO Box 9031, Harbor Point, MI 49740
Account Number 3301-88720-04
Bill Date: 10/06/2026
Service Period: 09/03/2026 - 10/02/2026
Previous Balance                 118.42
Payment Received 09/18/2026 - Thank You   -118.42
Balance Forward                    0.00
Customer Charge                   14.00
Energy Charge 912 kWh @ 0.1311   119.56
Total Current Charges            133.56
Amount Due                      $133.56
Due Date                     10/27/2026`,
    expected: { date: "2026-10-06", total: 133.56, vendor: "Lakeshore Electric Cooperative" },
  },
  {
    id: "utility-due-date-first",
    text: `Ridgeview Water & Sewer Authority
Customer Statement
Account 0044-1187
Due Date: 11/02/2026
Amount Due: $64.20
Statement Date: 10/08/2026
Water usage 4,100 gal    38.70
Sewer                    25.50
Total Due                64.20`,
    expected: { date: "2026-10-08", total: 64.2, vendor: "Ridgeview Water & Sewer Authority" },
  },
  {
    id: "utility-late-amount-after-due-date",
    text: `Ridgeview Water & Sewer Authority
Customer Statement
Statement Date: 10/08/2026
Amount Due: $64.20
Due Date: 11/02/2026
Amount Due After 11/02/2026: $70.62`,
    expected: { date: "2026-10-08", total: 64.2, vendor: "Ridgeview Water & Sewer Authority" },
  },
  {
    id: "internet-service-pdf-lines",
    text: `Page 1 of 2
Northwind Fiber
Your monthly statement
Statement Date
Sep 21, 2026
Payment Due Date
Oct 12, 2026
Total Amount Due
$89.99
Internet 500 Mbps          75.00
Equipment rental           10.00
Taxes & fees                4.99`,
    expected: { date: "2026-09-21", total: 89.99, vendor: "Northwind Fiber" },
  },
  {
    id: "lawn-service-invoice-separate-lines",
    text: `Greenleaf Lawn Services
INVOICE
Bill To: Homeowner
Date
09/30/2026
Due Date
10/15/2026
Description   Qty   Rate   Amount
Weekly mowing - September   4   45.00   180.00
Leaf cleanup   1   95.00   95.00
Amount Due
$275.00`,
    expected: { date: "2026-09-30", total: 275, vendor: "Greenleaf Lawn Services" },
  },
  {
    id: "pest-control-one-line",
    text: `Oakmont Pest Control Invoice Date: 10/03/2026 Quarterly perimeter service 120.00 Tax 0.00 Total: $120.00 Thank you`,
    expected: { date: "2026-10-03", total: 120, vendor: "Oakmont Pest Control" },
    knownMiss: true,
    why: "Flattened to one line: the vendor heuristic skips any line containing 'invoice', so vendor is null.",
  },

  // ── Home services and contractors ────────────────────────────────────────
  {
    id: "hvac-date-of-service",
    text: `Brookline Heating & Cooling
Invoice #10442
Date of Service: 09/29/2026
Technician: R. Ortiz
Diagnostic fee              89.00
Run capacitor 45/5 MFD      68.00
Labor 1.0 hr               125.00
Subtotal                   282.00
Tax                          4.93
Total Due                  286.93
Payment received - Visa    286.93
Balance Due                  0.00
Next recommended service: 03/29/2027`,
    expected: { date: "2026-09-29", total: 286.93, vendor: "Brookline Heating & Cooling" },
  },
  {
    id: "roofing-estimate-thousands",
    text: `Summit Ridge Roofing LLC
ESTIMATE
Estimate #: E-1187
Date: Oct 1, 2026
Valid for 30 days
Tear off and dispose, 24 sq @ 95.00        2,280.00
Architectural shingles, 26 sq @ 142.00     3,692.00
Ice & water shield                           860.00
Ridge vent, 42 lf                            514.50
Labor                                      2,070.00
Estimated Total: $9,416.50
Deposit required (30%): $2,824.95`,
    expected: { date: "2026-10-01", total: 9416.5, vendor: "Summit Ridge Roofing LLC" },
  },
  {
    id: "contractor-final-less-deposit",
    text: `Bayside Fence & Deck
Final Invoice
Invoice Date: 2026-09-18
Cedar privacy fence, 120 lf    4,200.00
Gate with hardware               600.00
Total Project Cost             4,800.00
Less Deposit Received         -1,440.00
Balance Due                    3,360.00`,
    expected: { date: "2026-09-18", total: 4800, vendor: "Bayside Fence & Deck" },
  },
  {
    id: "plumber-tabs",
    text: `Allbright Plumbing Co.\nInvoice Date:\t10/05/2026\nWater heater flush\t\t$140.00\nAnode rod\t\t$62.00\nSubtotal\t\t$202.00\nTotal\t\t$202.00\nPaid by check #1043`,
    expected: { date: "2026-10-05", total: 202, vendor: "Allbright Plumbing Co." },
  },
  {
    id: "vet-invoice-total",
    text: `Cedar Hollow Veterinary Clinic
218 Mill Pond Rd
Invoice Date 10/01/2026
Patient: Biscuit (Canine)
Exam                        65.00
Rabies vaccine, 1 yr        28.00
DHPP booster                34.00
Heartworm test              36.50
Invoice Total              163.50
Payments                  -163.50
Balance                      0.00
Reminder: DHPP due 10/01/2027`,
    expected: { date: "2026-10-01", total: 163.5, vendor: "Cedar Hollow Veterinary Clinic" },
  },

  // ── Retail, restaurants, online orders ───────────────────────────────────
  {
    id: "online-order-iso-date",
    text: `Pinecrest Outdoor Supply
Order Confirmation
Order #PC-448120
Order Date: 2026-10-05
Trail running shoes, size 10     1   $109.99
Merino socks 3-pack              1    $19.99
Subtotal                            $129.98
Shipping                              $8.95
Tax                                  $10.11
Order Total                         $149.04`,
    expected: { date: "2026-10-05", total: 149.04, vendor: "Pinecrest Outdoor Supply" },
  },
  {
    id: "restaurant-month-name",
    text: `The Copper Kettle Bistro
212 Main St, Lindenwold
Server: Ana    Table 7    Guests 2
Oct 5, 2026  7:42 PM
2 Iced Tea                 5.90
1 Roasted Chicken         22.00
1 Mushroom Risotto        19.50
1 Bread Pudding            9.00
1 Espresso                 8.10
Subtotal                  64.50
Tax                        5.16
Total                     69.66`,
    expected: { date: "2026-10-05", total: 69.66, vendor: "The Copper Kettle Bistro" },
  },
  {
    id: "restaurant-tip-suggestions",
    text: `Harbor Lights Diner
Oct 2, 2026 12:31 PM
2 Club Sandwich           25.98
2 Coffee                   5.00
Subtotal                  30.98
Tax                        2.17
Total                     33.15
Suggested gratuity:
18% Tip 5.97  Total 39.12
20% Tip 6.63  Total 39.78
22% Tip 7.29  Total 40.44`,
    expected: { date: "2026-10-02", total: 33.15, vendor: "Harbor Lights Diner" },
    knownMiss: true,
    why: "Tip-suggestion lines also say 'Total', and the largest labelled amount wins.",
  },
  {
    id: "furniture-thousands-financing",
    text: `Oakline Home Furnishings
Sales Order SO-77120
Sale Date: 09/12/2026
Sectional sofa, slate       2,899.00
Delivery & setup              149.00
Protection plan               199.00
Subtotal                    3,247.00
Tax                           165.07
Total                      $3,412.07
Financed: 12 payments of $284.34`,
    expected: { date: "2026-09-12", total: 3412.07, vendor: "Oakline Home Furnishings" },
  },
  {
    id: "reprint-timestamp-on-top",
    text: `Maple Street Garden Center
REPRINT 10/09/2026 08:15 AM
Mulch, hardwood 2cf  x4     19.96
Hydrangea 3gal             34.99
SUBTOTAL                   54.95
TAX                         3.35
TOTAL                      58.30
VISA                       58.30
10/04/2026  3:47 PM  Reg 3  Trans 1180`,
    expected: { date: "2026-10-04", total: 58.3, vendor: "Maple Street Garden Center" },
  },
  {
    id: "ocr-noise-spacing-and-broken-lines",
    text: `Blue Heron  Bike  Shop
  1 1 2  Water  St
Invoice
Date:  10/06/2026
Tune-up,  standard          75.00
Chain  KMC  X9              32.00
Sub total                  107.00
Tax                          6.42
TOTAL  $  113.42`,
    expected: { date: "2026-10-06", total: 113.42, vendor: "Blue Heron  Bike  Shop" },
  },
  {
    id: "ocr-zero-for-o-in-labels",
    text: `FRESHWAY MARKET
STORE 0221
PRODUCE        6.12
DELI           9.88
BAKERY         4.29
GROCERY       20.88
SUBT0TAL      41.17
TAX            2.88
T0TAL         44.05
CASH          50.00
CHANGE         5.95
10/02/2026 17:44`,
    expected: { date: "2026-10-02", total: 44.05, vendor: "FRESHWAY MARKET" },
    knownMiss: true,
    why: "OCR read TOTAL as T0TAL (zero), so no total label matches and the fallback takes the largest amount (cash).",
  },
  {
    id: "ocr-zero-for-o-in-month",
    text: `Lantern Books & Cafe
0ct 3, 2026
Paperback novel     16.99
Latte                5.25
Subtotal            22.24
Tax                  1.33
Total               23.57`,
    expected: { date: "2026-10-03", total: 23.57, vendor: "Lantern Books & Cafe" },
    knownMiss: true,
    why: "OCR read the O in 'Oct' as a zero, so no month name matches and there is no other date.",
  },
  {
    id: "day-first-date",
    text: `Maplewood Tea Room
21/09/2026 15:10
Afternoon tea for two     48.00
Service                    4.80
Total                     52.80`,
    expected: { date: "2026-09-21", total: 52.8, vendor: "Maplewood Tea Room" },
    knownMiss: true,
    why: "Day-first numeric dates aren't supported (US month-first is assumed); 21 isn't a month, so no date.",
  },
  {
    id: "year-less-date",
    text: `Sunrise Coffee Cart
10/05 08:02 AM
Cold brew 16oz     4.75
Muffin             3.25
Total              8.00`,
    expected: { date: "2026-10-05", total: 8, vendor: "Sunrise Coffee Cart" },
    knownMiss: true,
    why: "The date has no year, and the parser won't guess one.",
  },

  // ── Junk above the vendor name ────────────────────────────────────────────
  {
    id: "job-number-above-vendor",
    text: `Job #188200417
Copperline Chimney Sweeps
88 Furnace Ln, Millbrook, OH 44090
Service Date: 09/14/2026
Chimney inspection and sweep     189.00
Total Due                        189.00`,
    expected: { date: "2026-09-14", total: 189, vendor: "Copperline Chimney Sweeps" },
  },
  {
    id: "order-number-above-vendor",
    text: `Order Number: QX55120847
Willowmere Home Goods
Order Date: 2026-09-25
Linen curtain panel x2      58.00
Shipping                     6.95
Order Total                 64.95`,
    expected: { date: "2026-09-25", total: 64.95, vendor: "Willowmere Home Goods" },
  },
  {
    id: "ocr-punctuation-before-vendor",
    text: `>. FAIRWEATHER TIRE
19 Quarry Rd
DATE 09/30/2026
Tire rotation          29.99
Valve stems x4         12.00
TOTAL                  41.99`,
    expected: { date: "2026-09-30", total: 41.99, vendor: "FAIRWEATHER TIRE" },
  },
  {
    id: "date-line-above-vendor",
    text: `Sep 19, 2026
Hollowbrook Dental Group
(555) 310-4420
Cleaning and exam        145.00
Insurance adjustment     -95.00
Patient Balance           50.00
Amount Paid               50.00`,
    expected: { date: "2026-09-19", total: 50, vendor: "Hollowbrook Dental Group" },
  },
  {
    id: "contact-lines-above-vendor",
    text: `Page 1 of 2
(555) 482-0091
www.quarryhill-electric.test
Quarry Hill Electric
Invoice Date: 10/01/2026
Panel inspection          95.00
Total                     95.00`,
    expected: { date: "2026-10-01", total: 95, vendor: "Quarry Hill Electric" },
  },
]
