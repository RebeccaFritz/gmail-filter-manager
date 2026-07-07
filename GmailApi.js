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