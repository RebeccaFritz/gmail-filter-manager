// ─── Core filter logic ────────────────────────────────────────────────────────

/**
 * Creates Gmail labels and a filter from criteria/actions strings, and writes
 * the entry to the sheet. Safe to call repeatedly — skips if an exact match exists.
 *
 * @param {string}  criteriaStr - e.g. "from:boss@work.com, hasAttachment:true"
 * @param {string}  actionsStr  - e.g. "label:Work, skipInbox:true"
 * @param {boolean} [backfill=false]
 * @returns {{ status: 'created'|'skipped'|'error', message: string }}
 */
function applyFilter(criteriaStr, actionsStr, backfill = false) {
  const parsedCriteria = parseKVString(criteriaStr);
  const parsedActions  = parseLine(actionsStr); // !!!! problem

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