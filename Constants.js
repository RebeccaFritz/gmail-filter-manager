/**
 * A dictionary of key:value pairs for a filter
 * @typedef {Object} Key_Map
 * @property {string} [category]
 * @property {boolean} [delete] - Whether to delete all incoming emails matching the filter criteria. 
 * @property {boolean} [excludeChats] - Whether the response should exclude chats.
 * @property {string} [forward] - Email address that the message should be forwarded to. This effectively redirects the message to the address specified in this field, maintaining the original sender in the "From" field.
 * @property {string} [from] - The sender's display name or email address.
 * @property {boolean} [hasAttachment] - Whether the message has any attachment.
 * @property {string[]} [label] - Applies the provided labels to emails matching the filter criteria.
 * @property {boolean} [markAsRead] - Whether to mark all emails matching the filter criteria as read.
 * @property {boolean} [markImportant] - Whether to mark all emails matching the filter criteria as important.
 * @property {string} [negatedQuery] - Only return messages not matching the specified query. Supports the same query format as the Gmail search box. For example, "from:someuser@example.com rfc822msgid:<somemsgid@example.com> is:unread"
 * @property {boolean} [neverMarkImportant] - Ensure emails matching the filter criteria are never marked as important.
 * @property {boolean} [neverSpam] - Ensure emails matching the filter criteria are never marked as spam.
 * @property {string} [query] - Only return messages matching the specified query. Supports the same query format as the Gmail search box. For example, "from:someuser@example.com rfc822msgid:<somemsgid@example.com> is:unread".
 * @property {number} [size] - The size of the entire RFC822 message in bytes, including all headers and attachments.
 * @property {string} [sizeComparison] - How the message size in bytes should be in relation to the size field (unspecified, smaller, larger)
 * @property {boolean} [skipInbox] - Whether emails matching the filter criteria will be archived.
 * @property {boolean} [star] -  Whether to star all emails matching the filter criteria.
 * @property {string} [subject] - Case-insensitive phrase found in the message's subject. Trailing and leading whitespace are be trimmed and adjacent spaces are collapsed.
 * @property {string} [to] - The recipient's display name or email address. Includes recipients in the "to", "cc", and "bcc" header fields. You can use simply the local part of the email address. For example, "example" and "example@" both match "example@gmail.com". This field is case-insensitive.
 * @property {boolean} [_delete] - permanently delete the specified filter.
 */

/**
 * @typedef {Object} Action_Keys
 * @property {string} [category]
 * @property {boolean} [delete] - Whether to delete all incoming emails matching the filter criteria. 
 * @property {string} [forward] - Email address that the message should be forwarded to. This effectively redirects the message to the address specified in this field, maintaining the original sender in the "From" field.
 * @property {string[]} [label] - Applies the provided labels to emails matching the filter criteria.
 * @property {boolean} [markAsRead] - Whether to mark all emails matching the filter criteria as read.
 * @property {boolean} [markImportant] - Whether to mark all emails matching the filter criteria as important.
 * @property {boolean} [neverMarkImportant] - Ensure emails matching the filter criteria are never marked as important.
 * @property {boolean} [neverSpam] - Ensure emails matching the filter criteria are never marked as spam.
 * @property {boolean} [skipInbox] - Whether emails matching the filter criteria will be archived.
 * @property {boolean} [star] -  Whether to star all emails matching the filter criteria.
 */

/**
 * Filter Object definition for users.settings.filters
 * @typedef {Object} Filter
 * @property {string} id - The server assigned ID of the filter
 * @property {Filter_Criteria} criteria - Matching criteria for the filter
 * @property {Filter_Action} action - Action that the filter performs
 */

/**
 * Criteria Object definition for users.settings.filters 
 * @typedef {Object} Filter_Criteria
 * @property {string} [from] - The sender's display name or email address.
 * @property {string} [to] - The recipient's display name or email address. Includes recipients in the "to", "cc", and "bcc" header fields. You can use simply the local part of the email address. For example, "example" and "example@" both match "example@gmail.com". This field is case-insensitive.
 * @property {string} [subject] - Case-insensitive phrase found in the message's subject. Trailing and leading whitespace are be trimmed and adjacent spaces are collapsed.
 * @property {string} [query] - Only return messages matching the specified query. Supports the same query format as the Gmail search box. For example, "from:someuser@example.com rfc822msgid:<somemsgid@example.com> is:unread".
 * @property {string} [negatedQuery] - Only return messages not matching the specified query. Supports the same query format as the Gmail search box. For example, "from:someuser@example.com 
 * @property {boolean} [hasAttachment] - Whether the message has any attachment.
 * @property {boolean} [excludeChats] - Whether the response should exclude chats.
 * @property {number} [size] - The size of the entire RFC822 message in bytes, including all headers and attachments.
 * @property {string} [sizeComparison] - How the message size in bytes should be in relation to the size field (unspecified, smaller, larger)
 */

/**
 * Action Object definition for users.settings.filters
 * @typedef {Object} Filter_Action
 * @property {string[]} [addLabelIds]
 * @property {string[]} [removeLabelIds] 
 * @property {string} [forward] 
 */

/**
 * An array of objects representing one filter / one row of the spreadsheet
 * @typedef {Object} Spreadsheet_Row
 * @property {string} criteria 
 * @property {string} actions
 * @property {boolean} backfill
 * @property {string} lastSynced
 */

// ─── Constants ───────────────────────────────────────────────────────────────────

const props = PropertiesService.getScriptProperties();

const userId = 'me';

/**
 * Criteria keys used in the UI. These match the criteria fields used by the Gmail API filter object.
 */
const CRITERIA_KEYS = new Set([
  'from', 'to', 'subject', 'query', 'negatedQuery',
  'hasAttachment', 'excludeChats', 'size', 'sizeComparison'
]);

/**
 * Action keys used in the UI. 
 */
const ACTION_KEYS = new Set([
  'label', 'skipInbox', 'markAsRead', 'star', 'markImportant', 
  'neverMarkImportant', 'neverSpam', 'forward', 'delete', 'category'
]);

// ─── Shared Functions ───────────────────────────────────────────────────────────

/**
 * Sorts an object by value
 * @param {Object} obj 
 * @returns {Object}
 */
function sortObject(obj) {
    return Object.fromEntries(Object.entries(obj).sort());
}