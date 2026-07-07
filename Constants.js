const props = PropertiesService.getScriptProperties();

const userId = 'me';

const CRITERIA_KEYS = new Set([
  'from', 'to', 'subject', 'query', 'negatedQuery',
  'hasAttachment', 'excludeChats', 'size', 'sizeComparison'
]);

const ACTION_KEYS = new Set([
  'label', 'skipInbox', 'markAsRead', 'star', 'markImportant', 
  'neverMarkImportant', 'neverSpam', 'forwardTo', 'delete', 'category'
]);