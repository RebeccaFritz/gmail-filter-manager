// ─── PropertiesService Cache ──────────────────────────────────────────────────

/**
 * Returns the cached label ID for a given label name, or null if not cached.
 * @param {string} labelName
 * @returns {string|null}
 */
function getCachedLabelId(labelName) {
  return props.getProperty(`label:${labelName}`) || null;
}

/**
 * Stores a label name → ID mapping in the cache.
 * @param {string} labelName
 * @param {string} labelId
 */
function cacheLabelId(labelName, labelId) {
  props.setProperty(`label:${labelName}`, labelId);
}

/**
 * Returns the cached filter data for a given sender, or null if not cached.
 * @param {string} from
 * @returns {{ labelIds: string[], parsedActions: Object }|null}
 */
function getCachedFilter(from) {
  const raw = props.getProperty(`filter:${from}`);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Stores filter criteria for a sender in the cache.
 * @param {string}   from
 * @param {string[]} labelIds
 * @param {Object}   parsedActions
 */
function cacheFilter(from, labelIds, parsedActions) {
  props.setProperty(`filter:${from}`, JSON.stringify({ labelIds, parsedActions }));
}

/**
 * Removes a filter entry from the cache (used when criteria change).
 * @param {string} from
 */
function evictFilterCache(from) {
  props.deleteProperty(`filter:${from}`);
}

