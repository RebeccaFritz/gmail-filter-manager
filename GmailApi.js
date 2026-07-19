// ─── Gmail Label Helpers ──────────────────────────────────────────────────────

/**
 * Returns the ID of a Gmail label by name, creating it if it doesn't exist.
 * Checks PropertiesService cache before querying Gmail.
 *
 * @param {string} labelName
 * @returns {string} Gmail label ID
 */
function getOrCreateLabel(labelName) {
  const cached = getCachedLabelId(labelName);
  if (cached) {
    console.log(`  Label "${labelName}" found in cache (ID: ${cached})`);
    return cached;
  }

  const response      = Gmail.Users.Labels.list(userId);
  const existingLabels = (response && response.labels) ? response.labels : [];
  const found         = existingLabels.find(l => l.name === labelName);

  if (found) {
    console.log(`  Label "${labelName}" already exists (ID: ${found.id})`);
    cacheLabelId(labelName, found.id);
    return found.id;
  }

  const newLabel = Gmail.Users.Labels.create(
    { name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    userId
  );
  console.log(`  Created label "${labelName}" (ID: ${newLabel.id})`);
  cacheLabelId(labelName, newLabel.id);
  return newLabel.id;
}

// ─── Gmail Filter Helpers ─────────────────────────────────────────────────────

/**
 * Checks existing Gmail filters for a sender. Cache-first.
 * Keeps the first exact match; deletes all others.
 * Returns true if an exact match was found (caller should skip creating a duplicate).
 *
 * @param {string}   from
 * @param {string[]} labelIds
 * @param {Object}   parsedActions
 * @returns {boolean}
 */
function processExistingFilters(from, labelIds, parsedActions) {
  // 1. Cache fast-path
  const cached = getCachedFilter(from);
  if (cached) {
    const exactMatch =
      JSON.stringify(cached.labelIds)      === JSON.stringify(labelIds) &&
      JSON.stringify(cached.parsedActions) === JSON.stringify(parsedActions);

    if (exactMatch) {
      console.log(`  Cache hit: filter for ${from} already matches`);
      return true;
    }
    console.log(`  Cache mismatch for ${from} — querying Gmail`);
    evictFilterCache(from);
  }

  // 2. Query Gmail
  const response        = Gmail.Users.Settings.Filters.list(userId);
  const existingFilters = (response && response.filter) ? response.filter : [];
  const matches         = existingFilters.filter(f => f.criteria && f.criteria.from === from);

  if (matches.length === 0) {
    console.log(`  No existing filters for ${from}`);
    return false;
  }

  let foundExactMatch = false;
  for (const match of matches) {
    if (!foundExactMatch && isDesiredFilter(match, labelIds, parsedActions)) {
      foundExactMatch = true;
      cacheFilter(from, labelIds, parsedActions);
    } else {
      Gmail.Users.Settings.Filters.remove(userId, match.id);
      console.log(`  🗑️ Deleted stale filter for ${from} (ID: ${match.id})`);
    }
  }

  return foundExactMatch;
}

/**
 * Returns true if an existing Gmail filter object matches all desired criteria.
 *
 * @param {Object}   match
 * @param {string[]} labelIds
 * @param {Object}   parsedActions
 * @returns {boolean}
 */
function isDesiredFilter(match, labelIds, parsedActions) {
  const addIds    = match.action.addLabelIds    || [];
  const removeIds = match.action.removeLabelIds || [];

  const allLabelsPresent = labelIds.every(id => addIds.includes(id));
  const importantCorrect = addIds.includes('IMPORTANT')  === (parsedActions.markImportant === true);
  const inboxCorrect     = removeIds.includes('INBOX')   === (parsedActions.skipInbox     === true);

  return allLabelsPresent && importantCorrect && inboxCorrect;
}

/**
 * Gets every filter object from Gmail and ensures each one has a matching row in the sheet.
 * @param {Spreadsheet_Row[]}
 * @return {{ created: number, skipped: number, errors: number }}
 */
function syncGmailToSheet(rows) {
  const labelResponse = Gmail.Users.Labels.list(userId);
  const idToNameMap = {};
  for (const label of (labelResponse.labels || [])) {
    idToNameMap[label.id] = label.name;
  }

  const parsedSheetRows = rows.map(row => ({
    criteria: sortObject(parseKVString(row.criteria)),
    actions:  sortObject(parseKVString(row.actions))
  }));

  // Query Gmail
  const response        = Gmail.Users.Settings.Filters.list(userId);
  const gmailFilters = (response && response.filter) ? response.filter : [];

  // Convert the Gmail filters into an object and sort them to prepare for comparison
  const parsedGmailFilters = gmailFilters.map(filter => ({
    criteria: sortObject(filter.criteria),
    action: sortObject(parseActionFromGmail(filter.action, idToNameMap))
  }))

  // compare Gmail filters to filters in sheet
  const syncStatus = {
    created: 0,
    skipped: 0,
    errors: 0,
  };
  for (const {criteria: gmailCriteria, action: gmailAction} of parsedGmailFilters) {
    const alreadyInSheet = parsedSheetRows.some(row =>
      JSON.stringify(row.criteria) === JSON.stringify(gmailCriteria) &&
      JSON.stringify(row.actions)  === JSON.stringify(gmailAction)
    );
    if (!alreadyInSheet) {
      const criteriaStr = buildKVString(gmailCriteria);
      const actionStr = buildKVString(gmailAction);
      try {
        const { status, message } = writeFilterToSheet(criteriaStr, actionStr, false);
        let icon;
        if (status === 'created') {
          icon = '✅';
          syncStatus.created += 1;
        } else {
          icon = '⏭️';
          syncStatus.skipped += 1;
        }
        console.log(`${icon} ${criteriaStr} ${actionStr} — ${message}`);
      } catch (e) {
        console.error(`❌ ${criteriaStr} ${actionStr}: ${e.message}`);
        syncStatus.errors += 1;
      }
    }
  }

  return syncStatus;
}