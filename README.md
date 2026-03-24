# ExpenseManager — Personal Finance, Simplified

> A full-stack multi-user personal finance web app. Track expenses, loans, EMIs, credit cards, daily items, and more — all in one place, privately per user.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Setup & Installation](#setup--installation)
3. [User Guide](#user-guide)
   - [Dashboard](#dashboard)
   - [Expenses](#expenses)
   - [Friends & Loans](#friends--loans)
   - [Split Expenses](#split-expenses)
   - [Trips](#trips)
   - [Reports](#reports)
   - [EMI Calculator](#emi-calculator)
   - [My EMIs](#my-emis)
   - [Credit Cards](#credit-cards)
   - [Bank Accounts](#bank-accounts)
   - [Planner](#planner)
   - [Daily Tracker](#daily-tracker)
   - [Recurring Entries](#recurring-entries)
   - [AI Lookup](#ai-lookup)
4. [File Structure](#file-structure)
5. [Backup & Restore](#backup--restore)
6. [Environment Variables](#environment-variables)
7. [Auto-Start on Windows](#auto-start-on-windows)

---

## Tech Stack

### Backend
| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | **Node.js** | v20+ (LTS) | Server-side JavaScript |
| Framework | **Express.js** | 4.18 | HTTP routing, middleware |
| Database | **SQLite** via `better-sqlite3` | 12.x | File-based, zero-config database |
| Auth | **bcryptjs** | 2.4 | Password hashing (10 rounds) |
| Sessions | **express-session** + `connect-sqlite3` | — | 30-day persistent sessions |
| File Upload | **multer** | 1.4 LTS | CSV / Excel file handling |
| Excel | **xlsx** + **xlsx-populate** | — | Import/export spreadsheets |
| AI | **@anthropic-ai/sdk** | 0.80+ | Claude AI integration (AI Lookup) |
| JWT | **jsonwebtoken** | 9.x | Token utilities |

### Frontend
| Layer | Technology | Notes |
|-------|-----------|-------|
| UI | **Vanilla HTML/CSS/JS** | No build step, no framework |
| Fonts | **DM Sans** + **JetBrains Mono** | Via Google Fonts |
| Charts | **Chart.js** 4.4 | CDN, dashboard & reports |
| Icons/Logo | **Inline SVG** | Custom designed, no icon library |
| Styling | **Custom CSS** with CSS variables | Dark green theme, responsive |

### Database Schema (SQLite tables)
| Table | Purpose |
|-------|---------|
| `users` | Accounts, roles, subscriptions |
| `expenses` | Daily expense entries |
| `friends` | Friend contacts |
| `loan_transactions` | Money lent/borrowed |
| `divide_groups` | Bill split sessions |
| `trips` + `trip_expenses` | Group trip tracking |
| `emi_records` + `emi_installments` | EMI schedules |
| `credit_cards` + `cc_cycles` + `cc_txns` | Credit card management |
| `bank_accounts` | Bank balance tracking |
| `default_payments` + `monthly_payments` | Recurring monthly bills |
| `daily_trackers` + `daily_entries` | Daily item tracking (milk, etc.) |
| `recurring_entries` | Monthly auto-applied entries |
| `plans` + `user_subscriptions` | Plan/subscription management |

---

## Setup & Installation

### Requirements
- **Node.js v20 LTS** or higher — [nodejs.org](https://nodejs.org)
- Windows 10/11, macOS, or Linux

### Step 1 — Install Node.js

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** installer
2. Run the installer, check **"Add to PATH"**
3. Verify:
   ```
   node --version   # should be v20+
   npm --version
   ```

### Step 2 — Install Dependencies

```bash
cd C:\Projects\ExpenseManager
npm install
```

> **Windows note:** If you get `ERR_DLOPEN_FAILED` for `better-sqlite3`, you are likely on Node v24+. Run `npm install better-sqlite3@latest` to get prebuilt binaries for your Node version.

### Step 3 — Start the Server

```bash
npm start
```

Output:
```
  ┌──────────────────────────────────────────┐
  │   💰 Expense Manager is running!         │
  │   Open: http://localhost:3000            │
  └──────────────────────────────────────────┘
```

### Step 4 — Open in Browser

Go to **http://localhost:3000**

- Click **"Create account"** to register
- First registered user automatically becomes **Admin**
- Each user sees only their own private data

### Share on Local Network

1. Find your IP: `ipconfig` → look for **IPv4 Address** (e.g. `192.168.1.10`)
2. Others open `http://192.168.1.10:3000` from any device on the same Wi-Fi
3. Each person registers their own account

---

## User Guide

### Dashboard

The home screen gives you a financial snapshot for the selected year:

- **Summary card** — total expenses, fair vs extra breakdown
- **Monthly bar chart** — click any bar to filter that month
- **Credit card dues** — outstanding amounts per card
- **EMI snapshot** — active EMIs and upcoming installments
- **Top spending categories** — where your money goes
- **Bank balances** — current balance across all accounts

---

### Expenses

Track every rupee you spend.

**Adding an expense:**
1. Click **+ Add** in the top-right of the Expenses tab
2. Fill in: Date, Item name, Amount
3. Check **"Extra"** if it's a non-essential/impulse purchase
4. Click **Add**

**Filters & Search:**
- Filter by **year**, **month** (click the bar chart or chip)
- Search by item name
- Toggle between **All / Fair / Extra** spend types
- Sort by Date, Amount, or Name (click column headers)

**Import from file:**
- **Import CSV** — upload a `.csv`, map columns (date, name, amount), preview and confirm
- **Import Excel** — select sheet, map columns, bulk import

---

### Friends & Loans

Track money you've lent or borrowed with friends.

**Adding a friend:** Click **+ Add Friend**, enter their name.

**Recording a transaction:**
1. Click a friend's name → **+ Add Transaction**
2. Choose direction: **You gave** (lent) or **You received** (borrowed)
3. Enter amount, date, and optional note

**Settlement:** When settled, add a transaction in the opposite direction. Net balance auto-updates.

---

### Split Expenses

Split a shared bill among a group.

1. Click **+ New Split**
2. Add a description and the people involved
3. Add expense line items with amounts
4. Choose split mode: **Equal**, **Percentage**, or **Ratio**
5. Mark who paid
6. Click **Calculate** — it generates individual shares and optionally creates loan entries

---

### Trips

Manage group travel expenses.

1. **Create a trip** — name, dates, add members
2. **Add expenses** — who paid, how much, for whom
3. **Settlements tab** — see who owes what to settle the trip
4. **Lock members** — freeze a member's share once paid

---

### Reports

Visual breakdown of your spending.

- **Year/Month selector** — drill down to any period
- **Category chart** — spending by item type
- **Monthly comparison** — bar chart across months
- **Fair vs Extra** — pie chart split
- **Top items** — your most frequent/expensive purchases

---

### EMI Calculator

Calculate loan EMIs before committing.

1. Enter: **Principal**, **Interest Rate (%)**, **Tenure (months)**
2. Optionally add **GST %** and **Processing charges**
3. See: Monthly EMI, Total payable, Total interest, Full amortization schedule
4. Click **"Activate — Add to My EMIs"** to track it

---

### My EMIs

Track all your active loans and EMIs.

- See each EMI with: remaining balance, next due date, installment breakdown
- **Mark installment as paid** — records payment date and amount
- **View schedule** — full month-by-month amortization table
- **Add to Expenses** — push EMI payments into your expense tracker
- Paid installments auto-grey out; overdue ones are highlighted

---

### Credit Cards

Full credit card billing cycle management.

**Adding a card:**
1. Go to **Credit Cards → Add Card**
2. Enter: Bank name, Card name, Last 4 digits, Expiry, Bill generation day, Due days, Credit limit, Default discount %

**Adding a transaction:**
1. Open a card → **+ Add Transaction**
2. Enter: Date, Description, Amount, Discount %
3. ✅ **"Also add as expense"** — check this to simultaneously log it in your expense tracker
4. Net payable is shown live (after discount)

**Billing cycles:**
- Transactions auto-assign to the current open cycle
- When your bill generates, click **Close Cycle** and record payment
- A new cycle opens automatically

**Views available:**
- **Current cycle** — live transactions and due amount
- **Cycle history** — all past bills
- **Monthly summary** — spending by month across all cycles
- **Yearly summary** — annual total per card

---

### Bank Accounts

Track balances across multiple bank accounts.

- Add accounts with current balance
- Mark one as **default** (used for auto-deductions)
- Balances update when you record payments (EMIs, monthly bills)
- See **spendable amount** (balance minus upcoming dues)

---

### Planner

Monthly financial overview — see everything due in one view.

- Credit card due dates and amounts
- EMI installments due
- Monthly recurring bills
- **Mark bills as paid / skip** directly from the planner
- Navigate month by month with ← →

---

### Daily Tracker

> **New feature** — Track items you consume every day (milk, newspaper, maid visits, etc.)

**Creating a tracker:**
1. Go to **Daily Tracker → + Add Tracker**
2. Enter: Name (e.g. "Milk"), Unit (e.g. "litre"), Price per unit (₹65), Default qty/day (0.5)

**How it works:**
- When you open a tracker, today and all past days of the current month are **auto-filled** with your default quantity
- Each day shows the quantity, calculated amount, and a badge:
  - **Auto** — filled automatically with default qty
  - **Edited** — you manually changed that day's quantity

**Editing a day:**
1. Click **Edit** next to any day
2. Type the new quantity (e.g. 0 if delivery didn't come, 1 if you took extra)
3. Press **Enter** or click ✓ — the badge switches to "Edited"

**Monthly summary:**
- Total quantity consumed, total amount, days tracked
- Navigate past months with ← →

**Adding to Expenses:**
- Click **+ To Expenses** on the summary card
- The month's total is added as a single expense entry (e.g. "Milk – Mar 2026")
- Button shows ✓ once added to prevent duplicates

---

### Recurring Entries

> **New feature** — Set up entries that auto-apply on the 1st of every month.

Use this for fixed monthly costs: subscriptions, rent, salary deductions, etc.

**Adding a recurring entry:**
1. Go to **Recurring → + Add Recurring**
2. Choose type:
   - **Expense** — adds directly to your expense list; optionally mark as "Extra"
   - **Credit Card Transaction** — adds to a specific card's billing cycle; choose the card and discount %; optionally also add to expenses
3. Enter: Description, Amount
4. Click **Add**

**How auto-apply works:**
- Every time you open the app, it silently checks if this month's entries have been applied
- If not, it applies all active recurring entries and shows a toast notification
- `last_applied` tracks the month — entries are never double-applied

**Manual apply:** Click **Apply Now** to trigger immediately (useful after adding a new entry mid-month).

**Active toggle:** Use the checkbox in the "On" column to enable/disable any entry without deleting it.

---

### AI Lookup

Ask financial questions in plain English — powered by Claude AI.

Examples:
- "What would my EMI be for ₹10L at 8.5% for 20 years?"
- "How much have I spent on food this year?"
- "Explain how credit card billing cycles work"
- "What's the difference between flat rate and reducing balance interest?"

Requires an Anthropic API key set in the environment (`ANTHROPIC_API_KEY`).

---

## File Structure

```
ExpenseManager/
├── server.js                  # Express server entry point
├── package.json               # Dependencies & scripts
├── db/
│   └── database.js            # SQLite schema, migrations & all query functions
├── middleware/
│   └── auth.js                # Session-based auth middleware
├── routes/
│   ├── auth.js                # Login / register / logout / OTP
│   └── api.js                 # All data API endpoints
├── views/
│   ├── landing.html           # Public landing/marketing page
│   ├── login.html             # Login page
│   ├── register.html          # Registration page
│   └── app.html               # Main single-page app (post-login)
├── public/
│   ├── favicon.svg            # Browser tab icon
│   ├── logo.svg               # Full wordmark SVG
│   ├── css/
│   │   └── app.css            # All styles (CSS variables, components)
│   └── js/
│       ├── utils.js           # api(), toast(), modal(), currency/date helpers
│       └── app.js             # All tab logic, UI rendering, feature functions
└── data/                      # Auto-created on first run
    ├── expense_manager.db     # Main SQLite database (all user data)
    └── sessions.db            # Session store
```

---

## Backup & Restore

All data lives in a single file:

```
data/expense_manager.db
```

**Backup:** Copy this file to a safe location (USB, cloud drive, etc.)

**Restore:** Replace the file and restart the server — all data is back instantly.

**Automated backup (Windows):** Schedule a Task in Task Scheduler to copy the file nightly.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the server listens on |
| `SESSION_SECRET` | `(built-in fallback)` | Change this in production |
| `ANTHROPIC_API_KEY` | — | Required for AI Lookup feature |

**Setting variables (Windows):**
```bat
set PORT=8080
set ANTHROPIC_API_KEY=sk-ant-...
npm start
```

**Setting variables (permanent, PowerShell):**
```powershell
[System.Environment]::SetEnvironmentVariable("PORT","8080","User")
```

---

## Auto-Start on Windows

### Method 1 — Startup Folder (simplest)

1. Press `Win+R` → type `shell:startup` → Enter
2. Create a file `start-expensemanager.bat` there:
   ```bat
   @echo off
   cd C:\Projects\ExpenseManager
   node server.js
   ```
3. The server starts automatically every time you log in to Windows

### Method 2 — Windows Service (background, no window)

Use [NSSM](https://nssm.cc) (Non-Sucking Service Manager):
```bat
nssm install ExpenseManager "C:\Program Files\nodejs\node.exe" "C:\Projects\ExpenseManager\server.js"
nssm set ExpenseManager AppDirectory "C:\Projects\ExpenseManager"
nssm start ExpenseManager
```

---

## Admin Panel

The first registered user is automatically made **Admin**.

Admins can access `/admin` tab to:
- View and manage all users
- Change user roles (Admin / User)
- Manage subscription plans and assign them to users
- Send OTP / reset password links
- Control which pages each plan can access

---

*Built with Node.js · Express · SQLite · Vanilla JS*
