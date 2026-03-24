# ExpenseManager — User Guide

A personal finance web application to track expenses, loans, trips, credit cards, EMIs, and monthly payments.

---

## Table of Contents

1. [Dashboard](#1-dashboard)
2. [Expenses](#2-expenses)
3. [Friends & Loans](#3-friends--loans)
4. [Split](#4-split)
5. [Trips](#5-trips)
6. [Reports](#6-reports)
7. [EMI Calculator](#7-emi-calculator)
8. [My EMIs](#8-my-emis)
9. [Credit Cards](#9-credit-cards)
10. [Bank Accounts](#10-bank-accounts)
11. [Planner](#11-planner)
12. [Admin Panel](#12-admin-panel)

---

## 1. Dashboard

An at-a-glance overview of your financial activity.

### What you see
- **Year selector** — switch between years to view historical data
- **This Month** — total spending and transaction count for the current month
- **This Year** — total spending and transaction count for the selected year
- **You Are Owed / You Owe** — net balances across all friends
- **Monthly Spend Chart** — stacked bar chart (Fair vs Extra) for all months in the selected year
- **Top 10 Expenses** — horizontal bar chart of your largest expenses
- **Spending Breakdown** — donut chart splitting Regular vs Extra spending
- **Recent Expenses** — last 5 transactions with date, name, and amount

### Actions
- Select a different year using the year dropdown
- View totals update instantly for the selected year

---

## 2. Expenses

The primary log of all personal expenses.

### What you see
- Filterable, sortable, paginated list of all expense entries
- Year/month mini-chart to visualise spending at a glance
- Search bar, type filter, and sort controls

### Filters & Controls
| Control | Options |
|---|---|
| Year | Select any year, or All |
| Month | Click any month bar in the mini-chart |
| Search | Filter by item name |
| Type | All / Fair / Extra |
| Sort | Date, Item, Amount — ascending or descending |

> **Fair** = essential/necessary spend. **Extra** = discretionary/non-essential.

### Actions

**Add Expense**
- Date, item name, amount (₹), type (Fair / Extra)
- Optional: charge to a credit card (creates a CC transaction automatically)

**Edit Expense**
- Modify any field of an existing entry

**Delete Expense**
- Permanently removes the entry

**Import from CSV**
- Upload a `.csv` file
- Map columns to: Date, Name, Amount, Type
- Preview before importing

**Import from Excel**
- Upload a `.xlsx` file
- Fixed column layout: B = Date, D = Description, E = Debit amount, F = Extra flag
- Supports password-protected files
- Select which sheet to import from
- Preview rows before confirming

---

## 3. Friends & Loans

Track money lent to or borrowed from friends.

### Friend List
- Each friend card shows their **net balance**:
  - Green = they owe you
  - Red = you owe them
  - Gray = settled
- Sort by: Alphabetical, Highest balance, Lowest balance

### Actions on Friends
- **Add Friend** — name only required
- **Edit Friend** — rename
- **Delete Friend** — removes the friend and all their loan transactions
- **Import from Excel** — each sheet = one friend; columns: Details, Date, Paid, Received

### Loan Transactions (Friend Detail)
Click any friend to see all transactions with them.

**Summary shown:**
- Total paid (you gave), Total received (you got), Net balance

**Filters:**
- Year, Month, Exact date, Search by details, Type (All / Paid only / Received only)

**Columns:** Date · Details · Paid · Received

**Actions per transaction:**
- **Add** — Date, details, paid amount, received amount
- **Edit** — modify any field
- **Delete** — remove the entry

---

## 4. Split

Split a shared expense between yourself and friends.

### How it works
1. Enter the expense details (date, amount, description)
2. Select **who paid** (you or a friend)
3. Select **who shares** the expense (any combination of you + friends)
4. Choose a **split mode**

### Split Modes
| Mode | Description |
|---|---|
| Equal | Divides total equally among selected people |
| Percent | Each person gets a % share (must total 100%) |
| Fraction | Decimal fractions (must total 1.0) |
| Direct Amount | Enter exact ₹ per person (must match total) |
| Parts / Ratio | Enter ratios (e.g. 1:2:3 — proportional) |

### Adding Items
- Add multiple items to one session before saving
- Live preview shows each person's running total

### Settlement Preview
Before saving, the form shows who owes whom after this split.

### Save
- Enter a session heading and date
- Choose expense type (Fair / Extra)
- Optionally charge to a credit card
- On save, automatically creates:
  - A personal expense entry
  - Loan transactions for each friend involved

### History
- Past split sessions listed with expandable rows
- See full per-person breakdown for each item
- Delete a single item or the entire session

---

## 5. Trips

Track group trip expenses, settlements, and finalization.

### Trip List
Filter tabs: **All · Active · Completed · Settlement Pending · I Owe · They Owe · Settled**

Each trip card shows:
- Name, status, date range
- Members (you always included)
- Total expenses + your net balance

### Create Trip
- Trip name (required), start date, end date (optional)
- Select members from your friends list

### Trip Detail

**Add Expense form:**
- Date, amount, description
- Paid by (any trip member)
- Divide between (any subset of members)
- Split mode: Equal / Percent / Fraction / Amount / Parts
- Optional: link to credit card

**Expenses table:**
- Date, details, paid by, amount, per-person breakdown
- Edit or delete any entry

**Settlement summary:**
- Per member: total share owed, amount paid, net balance

### Trip Actions
| Action | Description |
|---|---|
| Finalize | Convert trip to personal expenses + loan transactions |
| Mark Complete | Lock the trip |
| Re-open | Unlock a completed trip |
| Delete | Remove entire trip and all its expenses |

**Finalize modal:** Preview all transactions to be created, choose expense type (Fair/Extra).

---

## 6. Reports

Drill-down reporting across years → months → expenses.

### Level 1 — Years
- Stacked bar chart: Fair vs Extra by year
- Table: Year, Total, Fair, Extra, Count
- Click any year to drill down

### Level 2 — Months (for selected year)
- Stacked bar chart: Monthly Fair + Extra
- Table: Month, Total, Fair, Extra, Count
- Click any month to drill down

### Level 3 — Expenses (for selected month)
- Summary cards: Total, Fair total, Extra total, Count
- Searchable table: Date, Item, Amount, Type
- Pagination (50 per page)

### Print / PDF
Available at any level — generates a printable page with summary cards and table.

---

## 7. EMI Calculator

Calculate loan EMIs and optionally save/activate them.

### Inputs
| Field | Description |
|---|---|
| Loan Name | Label for this loan |
| Loan Amount (₹) | Principal |
| Interest Rate | % per annum |
| Tenure | Number of months |
| Processing Charges | Optional one-time fee |
| Charges financed | Toggle: add to loan or pay upfront |
| GST on Interest | Add 18% GST to interest component |

### Calculation Output
- **Monthly EMI** (highlighted)
- Principal, Total Interest, Total GST, Grand Total
- Processing charges breakdown

### EMI Schedule Table
Month-by-month: #, Interest, Principal, EMI, GST, Remaining Balance

**Editing the schedule:**
- **Bulk Edit** — change all unpaid EMI amounts at once (recalculates principal allocation)
- **Row Edit** — edit a specific month's EMI (must be ≥ interest for that month)

### Saving
- **Save EMI** — stores the calculation, not yet active
- **Save & Activate** — saves + creates the full installment schedule from a start date you choose

---

## 8. My EMIs

Track all saved and active EMI loans.

### Left Panel — EMI List

**Filter tabs:** All · Active · Saved · Completed

**Filter by tag** (if tags are assigned)

**Portfolio stats:**
- Total loans, Active count, Total principal, Grand total (P+I)

**Each EMI card shows:**
- Status badge (Active / Saved / Completed)
- Loan name, tag, description
- Principal, rate, tenure, monthly EMI
- Progress bar (% paid) for active loans

**Card actions:**
| Action | Available when |
|---|---|
| Activate | Saved status |
| Pay Next Installment | Active status |
| Edit Info | Always (name, tag, description) |
| Delete | Always |

**Expanded card (monthly breakdown):**
- Full schedule: Principal, Interest, GST, EMI, Due Date, Status
- Edit individual installment amount
- Bulk edit all unpaid installments
- Mark paid: amount, date, notes

### Right Panel — Monthly Summary
- Month/year navigator
- Stats: Total Due, Paid, Remaining, Count
- Progress bar
- List of installments due that month

---

## 9. Credit Cards

Track credit card transactions, billing cycles, and spending history.

### Card List
Summary bar shows total current dues across all cards.

Each card tile shows:
- Bank name, card name, last 4 digits, expiry
- Current cycle net payable
- Credit limit usage bar (%)
- Status badge: **Bill Due / Paid / Open**

### Add / Edit Card
| Field | Description |
|---|---|
| Bank Name | e.g. HDFC, ICICI |
| Card Name | e.g. Regalia, Amazon |
| Last 4 Digits | For identification |
| Expiry Month/Year | Optional |
| Bill Generation Day | Day of month billing cycle ends (default: 1) |
| Due Days | Days after bill generation to pay (default: 20) |
| Default Discount % | Applied automatically to all transactions |
| Credit Limit | For usage % display |

### Card Detail — Four Tabs

#### Tab 1: Current Cycle
- Cycle start/end dates, due date
- Total spent, total discount, net payable
- Transaction table: Date, Description, Amount, Discount %, Discount, Net
- **Add Transaction**: Date, description, amount, discount %
- **Close Cycle**: Enter paid amount and date → closes cycle, opens a new one

#### Tab 2: Billing History
- All past billing cycles in reverse order
- Each cycle: dates, status, total, discount, net payable, transaction count
- Status: **Open · Billed · Paid · Partial**
- Imported cycles show a "historical" badge
- **Import Historical Data** button (see below)

#### Tab 3: Monthly View
- Year filter chips (only years with data shown)
- Year totals: Spent, Discount, Net Paid, Active Months
- 12-month bar chart for selected year
- Table: Month, Total Spent, Discount, Net Paid, Transactions

#### Tab 4: Yearly View
- No year filter — shows **all years at once**
- All-time totals: Spent, Discount, Net Paid, Years Active
- Bar chart: Year-over-year net payable
- Table: Year, Total Spent, Discount, Net Paid, Transactions, Cycles

### Import Historical Data
For importing past billing cycles without transaction details:
1. Select a year
2. Enter total amount (and optional paid date) for each month
3. Click Import — duplicate periods are automatically skipped

---

## 10. Bank Accounts

Track balances across your bank accounts.

### Summary Card
- Total spendable balance (across all accounts)
- Total balance, locked amount, spendable breakdown

### Account Cards
Each card shows:
- Bank name, account name, account type
- **Balance** — click to edit inline
- **Spendable** = Balance − Minimum balance
- Minimum balance (locked by bank)
- Default badge (one account is your default)

### Inline Balance Edit
- Click the balance amount → input field appears
- Press **Enter** or click ✓ to save
- Press **Escape** or click ✗ to cancel
- Balance is saved immediately without opening a modal

### Add / Edit Account
| Field | Description |
|---|---|
| Bank Name | e.g. HDFC, SBI, PNB |
| Account Name | Optional label (e.g. Salary, Savings) |
| Account Type | Savings / Current / Salary |
| Current Balance | Current balance (₹) |
| Minimum Balance | Amount locked by bank (₹) |

### Actions
- **Set Default** — marks one account as default (used by Planner auto-debit)
- **Edit** — modify any field via modal
- **Delete** — removes the account; if it was default, the next account becomes default

> **Balance deduction**: When a monthly payment is marked as paid, the paid amount is automatically deducted from the linked bank account's balance.

---

## 11. Planner

Plan and track all monthly payments — recurring bills, EMIs, subscriptions, and credit card dues.

### Tabs: This Month | Default Payments

---

### This Month

**Month navigator:** ‹ Month Year ›

**Summary stats:**
| Stat | Description |
|---|---|
| Total Due | Sum of all payments this month |
| Already Paid | Amount paid so far |
| Remaining to Pay | What's still pending |
| Bank Spendable | Total spendable across all accounts |

**Result panel:**
- Shows how much you will have left after paying all dues
- Breakdown: Bank balance · Spendable · Remaining dues

**Bank-wise Due Overview:**
For each bank account:
- Balance, Spendable amount
- Assigned dues (payments linked to this bank)
- **Surplus** (green) or **Shortfall** (red)

---

### Payment Sections

**Pending** — unpaid payments, sorted by due date
- Each row: Name, bank label, recurring badge, due date, amount
- Actions: **Pay · Edit · Del**

**Paid** — completed payments
- Each row shows paid amount and date
- Can be toggled back to unpaid

**Credit Card Dues** — open/billed CC cycles due this month
- CC badge, card name, bank, due date, net payable
- Actions: **Pay CC Bill · View Card**

**Skipped This Month** — recurring payments removed for this month
- Each row shows name and amount (dimmed)
- Actions: **Re-add · Delete Permanently**

> **Re-add**: Restores the payment back to Pending for this month only.
> **Delete Permanently**: Removes just this month's instance (future months unaffected).

---

### Mark as Paid
Click **Pay** on any pending payment:
- Enter amount paid (pre-filled with due amount)
- Select payment date (default: today)
- On save: payment moves to Paid section, bank balance is deducted

Click the checkbox circle to quickly toggle paid/unpaid without a modal.

---

### Add Monthly Payment
One-off payment for the current month only:
- Name, amount, due date, assigned bank, notes

---

### Default Payments Tab

Manage recurring payments that auto-generate every month.

Each default payment shows:
- Name, category, bank label, auto-debit badge
- Due day (e.g. "Due on day 5 each month")
- Amount
- Active/Inactive status

**Add / Edit Default Payment:**
| Field | Description |
|---|---|
| Name | e.g. Rent, Netflix, SIP |
| Amount (₹) | Monthly due amount |
| Due Day | Day of month (1–28) |
| Category | e.g. Rent, Utilities, Subscriptions |
| Bank Account | Which bank to assign this to |
| Auto-debit | Informational flag — marks payment as auto-debited |

**Other actions:**
- **Disable / Enable** — pause a default without deleting it
- **Delete** — remove the default (existing months unaffected)

> When you navigate to any month, all active default payments are automatically generated for that month if not already present.

---

## 12. Admin Panel

Visible only to users with Admin role.

### Tab 1: Users
- Table of all registered users: Name, Contact, Role, Subscription, Status
- **Edit user**: Name, mobile, active status, password
- **Generate OTP**: Create a 6-digit one-time login code
- **Reset Link**: Generate a 24-hour password reset URL
- **Role**: Toggle between User and Admin

### Tab 2: Plans
Manage subscription plans shown to users.

Each plan card shows:
- Name, description, pages/features included
- Monthly and yearly pricing
- Free plan flag, Active flag

**Add / Edit Plan:**
- Name, description
- Monthly price, yearly price
- Mark as free plan
- Mark as active
- Select which pages/tabs are accessible under this plan

### Tab 3: Subscriptions
Manage which plan each user is on.

Table: User, Plan, Billing Cycle, Start Date, End Date, Status

**Add / Edit Subscription:**
- Select user, select plan
- Billing cycle: Monthly / Yearly / Lifetime
- Start date, end date (optional)
- Status

---

## General Notes

### Credit Card Integration
When adding an expense, split item, or trip expense — you can optionally charge it to a credit card. This automatically creates a transaction in that card's current billing cycle.

### Bank Balance Deductions
Marking a monthly planner payment as **paid** automatically deducts the paid amount from the linked bank account balance. Unmarking it restores the balance.

### Default Bank Account
One bank account can be set as **default**. The Planner uses this for payments with "Auto-debit" checked and no specific bank selected. When a bank is deleted, the next account automatically becomes default.

### Recurring Payments & Skipping
Recurring (default) payments auto-generate each month. Deleting them from a month marks them as **Skipped** — they won't re-appear that month, but will generate normally in future months. Use **Re-add** to restore, or **Delete Permanently** to hard-remove from that month only.

### Historical Credit Card Data
You can import past billing cycles into any credit card using the **Import Historical Data** feature. Enter only the total amount per month — no transaction details needed. Existing cycles for the same period are automatically skipped.
