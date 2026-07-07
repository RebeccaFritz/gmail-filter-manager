// ─── Web App entry point ──────────────────────────────────────────────────────

/**
 * Serves the web app UI. Visit the deployment URL in any browser to open it.
 * Deploy via: Apps Script editor → Deploy → New deployment → Web app.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Gmail Filter Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * include directly injects html file snippets into a file when called with printing scriptlets
 * @param {string} filename
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ─── UI handler (called by the page via google.script.run) ───────────────────

/**
 * Parses textarea input, creates Gmail labels and filters, writes rows to the
 * sheet, and returns a result array for the page to display.
 *
 * Accepts both formats per line:
 *   boss@work.com, Label, true, false
 *   from:boss@work.com, label:Work, skipInbox:true, hasAttachment:true
 *
 * @param {string} rawInput
 * @returns {{ criteriaStr: string, actionsStr: string, status: string, message: string }[]}
 */
function addFiltersFromUI(rawInput) {
  const lines = rawInput
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('//'));

  const results = [];

  for (const line of lines) {
    const parsed = parseLine(line);

    if (parsed._delete) {
      try {
        const delResult = deleteFilter(parsed);
        results.push({ criteriaStr: line, actionsStr: '', ...delResult });
      } catch (e) {
        results.push({ criteriaStr: line, actionsStr: '', status: 'error', message: e.message });
      }
      continue;
    }

    const criteriaKeys = [...CRITERIA_KEYS].filter(k => parsed[k] !== undefined);
    const actionKeys   = [...ACTION_KEYS].filter(k => parsed[k] !== undefined);

    const criteriaStr = criteriaKeys.map(k => `${k}:${parsed[k]}`).join(', ');
    const actionsStr  = [
      ...(parsed.label ? [`label:${Array.isArray(parsed.label) ? '[' + parsed.label.join(', ') + ']' : parsed.label}`] : []),
      ...actionKeys.filter(k => k !== 'label').map(k => `${k}:${parsed[k]}`)
    ].join(', ');

    if (!parsed.from && !parsed.to) {
      results.push({ criteriaStr: line, actionsStr: '', status: 'error', message: 'Must include from: or to:' });
      continue;
    }
    if (!parsed.label || parsed.label.length === 0) {
      results.push({ criteriaStr, actionsStr: '', status: 'error', message: 'label: is required' });
      continue;
    }

    try {
      const { status, message } = applyFilter(criteriaStr, actionsStr, parsed.backfill === true);
      results.push({ criteriaStr, actionsStr, status, message });
    } catch (e) {
      results.push({ criteriaStr, actionsStr, status: 'error', message: e.message });
    }
  }

  return results;
}

/**
 * Returns all filter rows from the sheet for display in the UI.
 * @returns {{ criteria: string, actions: string, backfill: boolean, lastSynced: string }[]}
 */
function getFiltersForUI() {
  return readFiltersFromSheet();
}

// ─── Sync (sheet → Gmail) ─────────────────────────────────────────────────────

/**
 * Reads every row from the sheet and ensures a matching Gmail label and filter
 * exists for each one. Safe to run repeatedly.
 */
function syncFilters() {
  const rows = readFiltersFromSheet();

  if (rows.length === 0) {
    console.log('No filter rows found in sheet. Add entries via the web app and run again.');
    return;
  }

  for (const { criteria, actions } of rows) {
    try {
      const { status, message } = applyFilter(criteria, actions);
      const icon = status === 'created' ? '✅' : '⏭️';
      console.log(`${icon} ${criteria} — ${message}`);
      markSyncedInSheet(criteria);
    } catch (e) {
      console.error(`❌ ${criteria}: ${e.message}`);
    }
  }
}