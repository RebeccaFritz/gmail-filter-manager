// ─── Parsing Utilities ────────────────────────────────────────────────────────

/**
 * Detects format and delegates to the appropriate parser.
 * KV format: any token matches /^\w+:/
 *
 * @param {string} str
 * @returns {Key_Map}
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
 * Parses a key:value string into an object.
 * Splits on commas outside parentheses to preserve query:(from:someuser@example.com is:unread).
 * Label values are always normalized to an array.
 *
 * @param {string} str - e.g. "from:boss@work.com, label:Work, skipInbox:true"
 * @returns {Key_Map}
 */
function parseKVString(str) {
  const tokens = splitOutsideParentheses(str);
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
      case 'neverSpam':
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
 * Converts an object containing criteria or action keys into a key:value string
 * @param {Filter_Criteria | Action_Keys} parsed 
 * @return {string} - e.g. "from:boss@work.com, label:Work, skipInbox:true"
 */
function buildKVString(parsed) {
  let parts = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'query' || key === 'negatedQuery') {
      parts.push(key + ':(' + value + ')');
    } else {
      parts.push(key + ':' + value);
    }
  }

  return parts.join(', ')
}

/**
 * Parses a positional CSV line into a KV object.
 * parts[0]=from, parts[1]=label, parts[2]=skipInbox, parts[3]=markImportant
 *
 * @param {string} str - e.g. "boss@work.com, Work, true, false"
 * @returns {Key_Map}
 */
function parsePositionalString(str) {
  const parts = str.split(','); 
  const result = {};

  if (parts[0]) result.from            = parts[0];
  if (parts[1]) result.label           = parts[1];
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
 * Splits a string on commas that are not inside parentheses.
 * e.g. "query:(from:someuser@example.com is:unread), skipInbox:true" → ["query:(from:someuser@example.com is:unread)", "skipInbox:true"]
 *
 * @param {string} str
 * @returns {string[]}
 */
function splitOutsideParentheses(str) {
  const tokens = [];
  let depth = 0, current = '';

  for (const ch of str) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
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
 * @param {Key_Map} parsed
 * @returns {Filter_Criteria}
 */
function buildCriteria(parsed) {
  const criteria = {};
  for (const key of CRITERIA_KEYS) {
    if (parsed[key] !== undefined) criteria[key] = parsed[key];
  }
  return criteria;
}

/**
 * Builds a Gmail API action object from a parsed KV action object and resolved label IDs.
 *
 * @param {Key_Map}   parsed
 * @param {string[]} labelIds - resolved Gmail label IDs for all labels in parsed.label
 * @returns {Filter_Action} 
 */
function buildAction(parsed, labelIds) {
  const addLabelIds    = [...labelIds];
  const removeLabelIds = [];

  if (parsed.skipInbox)          removeLabelIds.push('INBOX');
  if (parsed.markImportant)      addLabelIds.push('IMPORTANT');
  if (parsed.neverMarkImportant) removeLabelIds.push('NEVER_IMPORTANT');
  if (parsed.star)               addLabelIds.push('STARRED');
  if (parsed.markAsRead)         addLabelIds.push('UNREAD'); // removeLabelIds
  if (parsed.neverSpam)          addLabelIds.push('SPAM');   // removeLabelIds

  // markAsRead and neverSpam remove labels rather than add them
  if (parsed.markAsRead) { removeLabelIds.push('UNREAD'); addLabelIds.splice(addLabelIds.indexOf('UNREAD'), 1); }
  if (parsed.neverSpam)  { removeLabelIds.push('SPAM');  addLabelIds.splice(addLabelIds.indexOf('SPAM'),  1); }

  const action = {};
  if (addLabelIds.length)    action.addLabelIds    = addLabelIds;
  if (removeLabelIds.length) action.removeLabelIds = removeLabelIds;
  if (parsed.forward)      action.forward        = parsed.forward;

  return action;
}

/**
 * Builds a KV action object from a Gmail API action object
 * 
 * @param {Filter_Action} action
 * @param {Object} idToNameMap - e.g. { "Label_123": "Work", "Label_456": "Social" }
 * @returns {Action_Keys}
 */
function parseActionFromGmail(action, idToNameMap) {
  let parsedAction = {};

  for (const label of (action.addLabelIds || [])) {
    switch (label) {
      case `TRASH`:
        parsedAction.delete = true;
        break;
      case `STARRED`:
        parsedAction.star = true;
        break;
      case `IMPORTANT`:
        parsedAction.markImportant = true;
        break;
      case `CATEGORY_PERSONAL`:
      case `CATEGORY_UPDATES`:
      case `CATEGORY_SOCIAL`:
      case `CATEGORY_FORUMS`:
        console.warn('parseActionFromGmail is not implemented for the ' + label + ' system label');
        break;
      default:
        parsedAction.label = [];
        parsedAction.label.push(idToNameMap[label]);
    }
  }

  for (const label of (action.removeLabelIds || [])) {
    switch (label) {
    case `INBOX`: 
      parsedAction.skipInbox = true;
      break;
    case `SPAM`: 
      parsedAction.neverSpam = true;
      break;
    case `IMPORTANT`: 
      parsedAction.neverMarkImportant = true;
      break;
    case `UNREAD`: 
      parsedAction.markAsRead = true;
      break;
    }
  }

  if (`forward` in action) parsedAction.forward = action.forward;
  
  return parsedAction
}