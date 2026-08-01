# Gmail Filter Manager

A Google Apps Script web app for creating and managing Gmail filters in bulk. Filters are defined using a flexible key:value syntax that exposes the full Gmail filter API — match on sender, recipient, subject, keywords, attachment presence, message size, and more — then apply labels, archive, mark as read, star, forward, and other actions. All filter data is stored in a Google Sheet as the source of truth.

---

## Features

- **Web app UI** — add and view filters from any browser without opening the Apps Script editor
- **Two input formats** — a quick positional shorthand for common cases, and a full key:value format for everything else
- **Full Gmail filter criteria** — `from`, `to`, `subject`, `query`, `negatedQuery`, `hasAttachment`, `excludeChats`, `size`, `sizeComparison`
- **Full Gmail filter actions** — `label`, `skipInbox`, `markImportant`, `markAsRead`, `star`, `neverMarkImportant`, `neverSpam`, `forward`, `category`
- **Auto-creates labels** — including nested labels like `Finance/Alerts`
- **Skips duplicates** — if an identical filter already exists in Gmail, it won't create another
- **Replaces outdated filters** — if a filter exists for the same sender but with different settings, deletes the old one and creates the updated one
- **Backfill on demand** — filters added through the web UI can apply labels to existing matching threads; filters added directly to the sheet do not backfill
- **Sheet-based storage** — add rows directly to the sheet to define filters without using the UI
- **PropertiesService cache** — label IDs and filter criteria are cached locally so repeat syncs skip Gmail API calls for entries that haven't changed

---

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (required to install [clasp](https://developers.google.com/apps-script/guides/clasp))
- A Google account with Gmail

### 1. Clone the repository

``` bash
git clone https://github.com/RebeccaFritz/gmail-filter-manager.git
cd gmail-filter-manager
```

### 2. Install clasp

``` bash
npm install -g @google/clasp
clasp login
```

This opens a browser window to authorize clasp with your Google account

### 3. Create a new Apps Script project
Go to [script.google.com](https://script.google.com) and create a new standalone project. Copy the script ID from Project Settings (the gear icon in the left sidebar).

### 4. Configure clasp

Create a .clasp.json file in the project root:

``` json
{
  "scriptId": "your-script-id-here",
  "rootDir": "."
}
```

### 5. Enable the Gmail Advanced Service

- In the left sidebar, click **Services** (`+`)
- Find **Gmail API** and click **Add**

### 6. Push the code

``` bash
clasp push
```

### 7. Initialize the sheet
In the Apps Script editor, select getOrCreateSheet from the function dropdown and click Run. This creates the "Gmail Filter Manager" spreadsheet in your Drive.

### 8. Deploy as a web app
- Go to **Deploy → New deployment**
- Click the gear icon next to "Select type" and choose **Web app**
- Set **Execute as** to `Me`
- Set **Who has access** to `Only myself`
- Click **Deploy** and copy the URL

Bookmark that URL — it's your permanent entry point. 

### 9. Authorize the script
On first run you'll be prompted to authorize the script to access Gmail and Drive. Follow the prompts.

---

## Usage

### Adding filters via the web app

Open your bookmarked web app URL. On the **Add Filters** tab, enter one filter per line. Two formats are supported:

#### Positional format (shorthand)

```
email@example.com, Label
email@example.com, Label, skipInbox, markImportant
```

Fields are positional and comma-separated. `skipInbox` and `markImportant` default to `false` when omitted.

```
# label only — both flags default to false
dad@family.com, Family

# skip inbox, don't mark important
newsletters@service.com, Newsletters, true, false

# skip inbox and mark important
boss@work.com, Work, true, true
```

#### Key:value format

For filters that go beyond `from` + `label`, use explicit `key:value` pairs:

```
from:boss@work.com, label:Work, skipInbox:true

subject:Invoice, label:Finance, markAsRead:true

from:alerts@bank.com, hasAttachment:true, label:Receipts, star:true

from:newsletter@service.com, label:Newsletters, skipInbox:true, neverMarkImportant:true

from:boss@work.com, query:budget, label:Work, skipInbox:true
```

The format is auto-detected: any token containing `:` triggers key:value parsing.

#### Deleting filters

Prefix any filter line with `DEL` to delete it instead of creating it. Both formats are supported:

```
DEL email@example.com, Label, true, false

DEL from:email@example.com, label:Label, skipInbox:true
```

The `DEL` line must include the same flags as the original filter for an exact match. If no matching filter is found, the entry is skipped.

#### Supported criteria keys

These control which emails the filter matches:

| Key | Type | Description |
|---|---|---|
| `from` | string | Sender email address |
| `to` | string | Recipient email address |
| `subject` | string | Subject line contains |
| `query` | string | Full Gmail search query — must be enclosed in parentheses |
| `negatedQuery` | string | Exclude emails matching this query — must be enclosed in parentheses |
| `hasAttachment` | boolean | Only match emails with attachments |
| `excludeChats` | boolean | Exclude chat messages |
| `size` | number | Message size in bytes |
| `sizeComparison` | string | `larger` or `smaller` (used with `size`) |

#### Supported action keys

These control what happens to matched emails:

| Key | Type | Description |
|---|---|---|
| `label` | string | Label to apply; created if it does not exist |
| `skipInbox` | boolean | Archive the email (remove from inbox) |
| `markImportant` | boolean | Mark as important |
| `markAsRead` | boolean | Mark as read |
| `star` | boolean | Star the email |
| `neverMarkImportant` | boolean | Never mark as important |
| `neverSpam` | boolean | Never send to spam |
| `forward` | string | Forward to this email address |
| `category` | string | Assign to a category tab (`personal`, `social`, `forums`, or `updates`) |

### Adding filters directly to the sheet

Open the "Gmail Filter Manager" spreadsheet in Drive and add rows manually. The sheet has three columns:

| Criteria | Actions | Last Synced |
|---|---|---|
| `from:alerts@service.com` | `label:Newsletters, skipInbox:true` | |

The first two columns use key:value format. Then run `syncFilters()` from the Apps Script editor. Filters added this way are **not backfilled** — the label will only apply to new incoming emails, not existing threads.

### Viewing existing filters

The **View Filters** tab in the web app shows all entries currently stored in the sheet.

### Syncing the sheet to Gmail

`syncFilters()` reads every row in the sheet and ensures a matching Gmail label and filter exists for each one. Safe to run repeatedly — entries already in sync are skipped.

---

## Testing

`Test.gs` contains unit tests for the parsing layer. Tests run entirely within Apps Script — no external test runner needed.

To run all tests: open the Apps Script editor, select `runAllTests` from the function dropdown, and click **Run**. Results appear in the Execution Log.

---

## Entry points

### `doGet()`
Serves the web app UI. Called automatically when someone visits the deployment URL.

### `syncFilters()`
Run manually from the Apps Script editor. Reads all rows from the sheet and applies any filters not yet in Gmail. Does not backfill existing emails (unless the row's Backfill checkbox is checked).

---

## File structure

### `App.gs`
Web app endpoints and UI-facing functions
- `doGet()` — serves `Index.html` as the web app
- `include()` — used to inject CSS and frontend JavaScript into `Index.html`
- `addFiltersFromUI(rawInput)` — called by the web UI; parses input, creates filters, optionally backfills existing threads
- `getFiltersForUI()` — called by the web UI to populate the View Filters table
- `syncFilters()` — bidirectionally sync the filters between the Google sheet and the Gmail account

### `Cache.gs` 
`PropertiesService` caching 
- `cacheFilter / getCachedFilter / evictFilterCache` — PropertiesService helpers for filter criteria
- `cacheLabelId / getCachedLabelId` — PropertiesService helpers for label IDs

### `FilterParser.gs` 
Parsing and interpreting user input 
- `parseLine(str)` — detects format and routes to the appropriate parser
- `parseKVString(str)` — parses a key:value string into an object
- `buildKVString(parsed)` — converts an object containing criteria or action keys into a key:value string
- `parsePositionalString(str)` — parses a positional CSV line into a KV object
- `splitOutsideParentheses(str)` — splits on commas while preserving contents in parentheses
- `parsePrimitive(val)` — coerces strings to booleans or numbers
- `buildCriteria(parsed)` — builds a Gmail API criteria object from a parsed KV object
- `buildAction(parsed, labelIds)` — builds a Gmail API action object from a parsed KV action object and resolved label IDs
- `parseActionFromGmail(action, idToNameMap)` — Builds a KV action object from a Gmail API action object

### `FilterService.gs` 
Contains the application's core workflow 
- `applyFilter(criteriaStr, actionsStr, backfill)` — creates Gmail labels and a filter from criteria/actions strings; shared by both `addFiltersFromUI` and `syncFilters`
- `deleteFilter(parsed)` — deletes a Gmail filter matching the specified criteria and label/action combination; uses `isDesiredFilter` for exact matching

### `GmailApi.gs` 
Gmail-specific operations 
- `getOrCreateLabel(labelName)` — Returns the ID of a Gmail label by name, creating it if it doesn't exists
- `processExistingFilters(from, labelId, parsedActions)` — checks for existing Gmail filters; keeps exact matches, deletes outdated ones
- `isDesiredFilter(match, labelId, parsedActions)` — compares a filter object against desired criteria
- `syncGmailToSheet(rows)` — Gets every filter object from Gmail and ensures each one has a matching row in the sheet

### `Index.html`, `Script.html`, and `Stylesheet.html` 
The web app UI. Two tabs:
- **Add Filters** — textarea input with client-side validation, loading state, and a color-coded results log
- **View Filters** — table of all entries from the sheet

### `Spreadsheet.gs` 
All Google sheet operations — no Gmail logic lives here:
- `getOrCreateSpreadsheet()` — finds or creates the "Gmail Filter Manager" spreadsheet; caches its ID
- `getOrCreateSheet()` — finds or creates the Filters sheet with header and formatting
- `formatSheet(sheet)` — applies formating to a newly made sheet
- `readFiltersFromSheet()` — returns all data rows as an array of objects
- `writeFilterToSheet(criteriaStr, actionsStr, backfill)` — appends a new row; skips duplicates
- `markSyncedInSheet(criteriaStr)` — updates the Last Synced timestamp for a given row
- `filterExistsInSheet(criteriaStr)` — returns true if a row with that criteria string already exists
- `syncSheetToGmail(rows)` — Reads every row from the sheet and ensures a matching Gmail label and filter exists for each one

### `Constants.gs` 
Shared constants and configuration 

### `Test.gs` 
Unit tests for the parsing layer. Contains `assert`, `assertEqual`, and `assertThrows` helpers, individual test functions, and a `runAllTests()` runner. Run from the Apps Script editor — no deployment needed.

---

## Notes

- Nested labels use `/` as a separator (e.g. `Job Search/In Progress`) and appear as a folder hierarchy in the Gmail sidebar.
- `GmailApp.search()` returns a maximum of 500 threads. If you have more than 500 emails from one sender, the backfill will only label the first 500.
- When you make code changes, redeploy via **Deploy → Manage deployments → Edit** and increment the version. The URL stays the same.
