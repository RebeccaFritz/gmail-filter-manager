// ─── Web App entry point ──────────────────────────────────────────────────────

/**
 * Serves the web app UI. Visit the deployment URL in any browser to open it.
 * Deploy via: Apps Script editor → Deploy → New deployment → Web app.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Gmail Filter Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
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

// ─── Core filter logic ────────────────────────────────────────────────────────

/**
 * Creates Gmail labels and a filter from criteria/actions strings, and writes
 * the entry to the sheet. Safe to call repeatedly — skips if an exact match exists.
 *
 * @param {string}  criteriaStr - e.g. "from:boss@work.com, hasAttachment:true"
 * @param {string}  actionsStr  - e.g. "label:[Work, Memes], skipInbox:true"
 * @param {boolean} [backfill=false]
 * @returns {{ status: 'created'|'skipped'|'error', message: string }}
 */
function applyFilter(criteriaStr, actionsStr, backfill = false) {
  const parsedCriteria = parseKVString(criteriaStr);
  const parsedActions  = parseLine(actionsStr);

  const labels   = parsedActions.label || [];
  const labelIds = labels.map(name => getOrCreateLabel(name));

  const criteria = buildCriteria(parsedCriteria);
  const action   = buildAction(parsedActions, labelIds);

  if (processExistingFilters(parsedCriteria.from, labelIds, parsedActions)) {
    writeFilterToSheet(criteriaStr, actionsStr, backfill);
    return { status: 'skipped', message: 'Filter already exists' };
  }

  Gmail.Users.Settings.Filters.create({ criteria, action }, userId);
  cacheFilter(parsedCriteria.from, labelIds, parsedActions);

  let backfilledCount = 0;
  if (backfill && parsedCriteria.from) {
    const threads = GmailApp.search('from:' + parsedCriteria.from);
    if (threads.length > 0) {
      for (const labelName of labels) {
        const gmailLabel = GmailApp.getUserLabelByName(labelName);
        if (gmailLabel) gmailLabel.addToThreads(threads);
      }
      if (parsedActions.skipInbox) GmailApp.moveThreadsToArchive(threads);
    }
    backfilledCount = threads.length;
  }

  writeFilterToSheet(criteriaStr, actionsStr);
  return {
    status: 'created',
    message: backfill ? `Backfilled ${backfilledCount} thread(s)` : 'Filter created'
  };
}

/**
 * Deletes a Gmail filter matching the specified criteria and label/action combination.
 * Uses isDesiredFilter for exact matching — the DEL line must include the same
 * flags as the original filter (e.g. skipInbox, markImportant) to match correctly.
 *
 * @param {Object} parsed - Output of parseLine() for a DEL line, with _delete: true stripped.
 * @returns {{ status: 'deleted'|'skipped'|'error', message: string }}
 */
function deleteFilter(parsed) {
  if (!parsed.from && !parsed.to) {
    return { status: 'error', message: 'DEL requires from: or to:' };
  }

  const key    = parsed.from ? 'from' : 'to';
  const val    = parsed.from || parsed.to;
  const labels = parsed.label || [];

  const labelIds = labels.map(name => getOrCreateLabel(name));

  const response        = Gmail.Users.Settings.Filters.list(userId);
  const existingFilters = (response && response.filter) ? response.filter : [];
  const matches         = existingFilters.filter(f => f.criteria && f.criteria[key] === val);

  if (matches.length === 0) {
    return { status: 'skipped', message: `No filter found for ${key}:${val}` };
  }

  const toDelete = matches.filter(f => isDesiredFilter(f, labelIds, parsed));

  if (toDelete.length === 0) {
    return { status: 'skipped', message: `No filter matched the specified labels/actions for ${key}:${val}` };
  }

  for (const match of toDelete) {
    Gmail.Users.Settings.Filters.remove(userId, match.id);
  }

  evictFilterCache(val);

  return { status: 'deleted', message: `Deleted ${toDelete.length} filter(s) for ${key}:${val}` };
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