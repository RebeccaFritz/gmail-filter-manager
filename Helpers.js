// ─── PropertiesService Cache ──────────────────────────────────────────────────

const props = PropertiesService.getScriptProperties();

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

// ─── Gmail Label Helpers ──────────────────────────────────────────────────────

const userId = 'me';

const CRITERIA_KEYS = new Set([
  'from', 'to', 'subject', 'query', 'negatedQuery',
  'hasAttachment', 'excludeChats', 'size', 'sizeComparison'
]);

const ACTION_KEYS = new Set([
  'label', 'skipInbox', 'markAsRead', 'star', 'markImportant', 
  'neverMarkImportant', 'neverSpam', 'forwardTo', 'delete', 'category'
]);

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

// ─── Parsing Utilities ────────────────────────────────────────────────────────

/**
 * Parses a key:value string into an object.
 * Splits on commas outside brackets to preserve label:[Work, Memes].
 * Label values are always normalized to an array.
 *
 * @param {string} str - e.g. "from:boss@work.com, label:[Work, Memes], skipInbox:true"
 * @returns {Object}
 */
function parseKVString(str) {
  const tokens = splitOutsideBrackets(str);
  const result = {};

  for (const token of tokens) {
    const colon = token.indexOf(':');
    if (colon === -1) continue;
    const key = token.slice(0, colon).trim();
    const val = token.slice(colon + 1).trim();

    switch (key) {
      case 'label':
        result[key] = parseLabels(val);
        break;
      case 'skipInbox':
      case 'hasAttachment':
      case 'excludeChats':
      case 'skipInbox':
      case 'markAsRead':
      case 'star':
      case 'neverMarkImportant':
      case 'markImportant':
      case 'delete':
        parsed_val = parsePrimitive(val)
        if (typeof parsed_val !== 'boolean') throw new Error(`"${val}" is not a valid boolean for key "${key}"`);
        result[key] = parsed_val;
        break;
      default:
        result[key] = parsePrimitive(val);
    }
  }

  return result;
}

/**
 * Parses a positional CSV line into a KV object.
 * parts[0]=from, parts[1]=label, parts[2]=skipInbox, parts[3]=markImportant
 *
 * @param {string} str - e.g. "boss@work.com, [Work, Memes], true, false"
 * @returns {Object}
 */
function parsePositionalString(str) {
  const parts = splitOutsideBrackets(str); 
  const result = {};

  if (parts[0]) result.from            = parts[0];
  if (parts[1]) result.label           = parseLabels(parts[1]);
  if (parts[2]) {
    const skipInbox = parsePrimitive(parts[2]);
    if (typeof skipInbox !== 'boolean') throw new Error(`"${parts[2]}" is not a valid boolean for skipInbox`);
    result.skipInbox = skipInbox;
  }
  if (parts[3]) {
    const markImportant = parsePrimitive(parts[3]);
    if (typeof markImportant !== 'boolean') throw new Error(`"${parts[3]}" is not a valid boolean for markImportant`);
    result.markImportant = markImportant;
  }

  return result;
}

/**
 * Detects format and delegates to the appropriate parser.
 * KV format: any token matches /^\w+:/
 *
 * @param {string} str
 * @returns {Object}
 */
function parseLine(str) {
  const isDel = /^DEL\s+/i.test(str);
  const body  = isDel ? str.replace(/^DEL\s+/i, '') : str;
  const isKV  = body.split(',').some(t => /^\s*\w+:/.test(t));
  const result = isKV ? parseKVString(body) : parsePositionalString(body);
  if (isDel) result._delete = true;
  return result;
}

/**
 * Splits a string on commas that are not inside square brackets.
 * e.g. "label:[Work, Memes], skipInbox:true" → ["label:[Work, Memes]", "skipInbox:true"]
 *
 * @param {string} str
 * @returns {string[]}
 */
function splitOutsideBrackets(str) {
  const tokens = [];
  let depth = 0, current = '';

  for (const ch of str) {
    if (ch === '[') { depth++; current += ch; }
    else if (ch === ']') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { tokens.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/**
 * Normalizes a label value to an array.
 * "Work" → ["Work"]
 * "[Work, Memes]" → ["Work", "Memes"]
 *
 * @param {string} val
 * @returns {string[]}
 */
function parseLabels(val) {
  const stripped = val.trim().replace(/^\[|\]$/g, '');
  return stripped.split(',').map(l => l.trim()).filter(Boolean);
}

/**
 * Converts a string primitive to its proper JS type.
 * "true" → true, "false" → false, "42" → 42, else string.
 *
 * @param {string} val
 * @returns {boolean|number|string}
 */
function parsePrimitive(val) {
  if (val.toLowerCase() === 'true')  return true;
  if (val.toLowerCase() === 'false') return false;
  if (!isNaN(val) && val !== '')     return Number(val);
  return val;
}

/**
 * Builds a Gmail API criteria object from a parsed KV object.
 *
 * @param {Object} parsed
 * @returns {Object}
 */
function buildCriteria(parsed) {
  const criteria = {};
  for (const key of CRITERIA_KEYS) {
    if (parsed[key] !== undefined) criteria[key] = parsed[key];
  }
  return criteria;
}

/**
 * Builds a Gmail API action object from a parsed KV object and resolved label IDs.
 *
 * @param {Object}   parsed
 * @param {string[]} labelIds - resolved Gmail label IDs for all labels in parsed.label
 * @returns {Object}
 */
function buildAction(parsed, labelIds) {
  const addLabelIds    = [...labelIds];
  const removeLabelIds = [];

  if (parsed.skipInbox)          removeLabelIds.push('INBOX');
  if (parsed.markImportant)      addLabelIds.push('IMPORTANT');
  if (parsed.neverMarkImportant) addLabelIds.push('NEVER_IMPORTANT');
  if (parsed.star)               addLabelIds.push('STARRED');
  if (parsed.markAsRead)         addLabelIds.push('UNREAD'); // removeLabelIds
  if (parsed.neverSpam)          addLabelIds.push('SPAM');   // removeLabelIds

  // markAsRead and neverSpam remove labels rather than add them
  if (parsed.markAsRead) { removeLabelIds.push('UNREAD'); addLabelIds.splice(addLabelIds.indexOf('UNREAD'), 1); }
  if (parsed.neverSpam)  { removeLabelIds.push('SPAM');  addLabelIds.splice(addLabelIds.indexOf('SPAM'),  1); }

  const action = {};
  if (addLabelIds.length)    action.addLabelIds    = addLabelIds;
  if (removeLabelIds.length) action.removeLabelIds = removeLabelIds;
  if (parsed.forwardTo)      action.forward        = parsed.forwardTo;

  return action;
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
