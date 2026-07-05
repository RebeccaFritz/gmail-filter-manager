// ─── Runner ───────────────────────────────────────────────────────────────────

/** Runs all test functions and logs a pass/fail summary to the Execution Log. */
function runAllTests() {
  const tests = [
    test_parsePrimitive,
    test_parseLabels,
    test_parsePositionalString_happyPath,
    test_parsePositionalString_invalidBooleans,
    test_parseLine_positionalRouting,
    test_parseLine_kvRouting,
    test_parseLine_kvMultiLabel,
    test_parseLine_ignoreFormatting,
    test_parseLine_delRouting,
  ];

  let passed = 0, failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`✅ ${t.name}`);
      passed++;
    } catch (e) {
      console.error(`❌ ${t.name}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
}

// ─── Assertion Helpers ────────────────────────────────────────────────────────

/**
 * Throws if condition is falsy.
 * @param {boolean}  condition
 * @param {string}   message - Failure description shown in the error.
 */
function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
}

/**
 * Throws if actual and expected don't match by JSON deep-equality.
 * @param {*}      actual
 * @param {*}      expected
 * @param {string} message - Failure description shown in the error.
 */
function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`FAIL: ${message}\n  expected: ${e}\n  got:      ${a}`);
}

/**
 * Throws if fn does NOT throw. Logs the caught error message on success.
 * @param {() => void} fn      - Function expected to throw.
 * @param {string}     message - Failure description if fn doesn't throw.
 */
function assertThrows(fn, message) {
  try {
    fn();
    throw new Error(`FAIL: expected throw but got none — ${message}`);
  } catch (e) {
    if (e.message.startsWith('FAIL:')) throw e;
    console.log(`✅ threw as expected: ${e.message}`);
  }
}

// ─── parsePrimitive ───────────────────────────────────────────────────────────

/** Verifies string-to-type coercion: "true" → true, "42" → 42, unknown strings pass through. */
function test_parsePrimitive() {
  // Arrange
  const cases = [
    { input: 'true',  expected: true,    label: 'string "true" → boolean true'    },
    { input: 'false', expected: false,   label: 'string "false" → boolean false'  },
    { input: 'TRUE',  expected: true,    label: 'case-insensitive TRUE'            },
    { input: '42',    expected: 42,      label: 'numeric string → number'          },
    { input: 'hello', expected: 'hello', label: 'unknown string → string passthrough' },
  ];

  // Act
  const results = cases.map(c => ({ ...c, actual: parsePrimitive(c.input) }));

  // Assert
  for (const r of results) {
    assertEqual(r.actual, r.expected, r.label);
  }
}

// ─── parseLabels ─────────────────────────────────────────────────────────────

/** Verifies label normalization: bare strings, bracket single/multi, nested labels, whitespace trimming. */
function test_parseLabels() {
  // Arrange
  const cases = [
    { input: 'Work',           expected: ['Work'],           label: 'bare label'       },
    { input: '[Work]',         expected: ['Work'],           label: 'bracket single'   },
    { input: '[Work, Memes]',  expected: ['Work', 'Memes'],  label: 'bracket multi'    },
    { input: 'Finance/Alerts', expected: ['Finance/Alerts'], label: 'nested label'     },
    { input: '  Work  ',       expected: ['Work'],           label: 'trims whitespace' },
  ];

  // Act
  const results = cases.map(c => ({ ...c, actual: parseLabels(c.input) }));

  // Assert
  for (const r of results) {
    assertEqual(r.actual, r.expected, r.label);
  }
}

// ─── parsePositionalString ────────────────────────────────────────────────────

/** Verifies positional parsing for all valid field combinations including multi-label bracket syntax. */
function test_parsePositionalString_happyPath() {
  // Arrange
  const cases = [
    {
      input:    'test1@example.com, Work, true, true',
      expected: { from: 'test1@example.com', label: ['Work'], skipInbox: true, markImportant: true },
      label:    'all four fields',
    },
    {
      input:    'test5@example.com, Newsletters',
      expected: { from: 'test5@example.com', label: ['Newsletters'] },
      label:    'optional fields omitted — no skipInbox or markImportant keys',
    },
    {
      input:    'test6@example.com, Newsletters, true',
      expected: { from: 'test6@example.com', label: ['Newsletters'], skipInbox: true },
      label:    'one optional field',
    },
    {
      input:    'test7@example.com, Finance/Alerts, true, false',
      expected: { from: 'test7@example.com', label: ['Finance/Alerts'], skipInbox: true, markImportant: false },
      label:    'nested label',
    },
    {
      input:    'boss@work.com, [Work, Memes], true, false',
      expected: { from: 'boss@work.com', label: ['Work', 'Memes'], skipInbox: true, markImportant: false },
      label:    'multi-label bracket syntax',
    },
  ];

  // Act
  const results = cases.map(c => ({ ...c, actual: parsePositionalString(c.input) }));

  // Assert
  for (const r of results) {
    assertEqual(r.actual, r.expected, r.label);
  }
}

/** Verifies that non-boolean values in boolean positions (skipInbox, markImportant) throw. */
function test_parsePositionalString_invalidBooleans() {
  // Arrange
  const cases = [
    {
      fn:    () => parsePositionalString('test10@example.com, Work, maybe, false'),
      label: 'maybe is not a valid boolean for skipInbox',
    },
    {
      fn:    () => parsePositionalString('test11@example.com, Work, true, notabool'),
      label: 'notabool is not a valid boolean for markImportant',
    },
  ];

  // Act + Assert
  // (assertThrows must act and assert together — the act is inside the lambda)
  for (const c of cases) {
    assertThrows(c.fn, c.label);
  }
}

// ─── parseLine ────────────────────────────────────────────────────────────────

/** Verifies that positional input (no colons) routes to parsePositionalString. */
function test_parseLine_positionalRouting() {
  // Arrange
  const input = 'test1@example.com, Work, true, false';

  // Act
  const result = parseLine(input);

  // Assert
  assertEqual(result.from,          'test1@example.com', 'from');
  assertEqual(result.label,         ['Work'],            'label normalized to array');
  assertEqual(result.skipInbox,     true,                'skipInbox');
  assertEqual(result.markImportant, false,               'markImportant');
}

/** Verifies that key:value input routes to parseKVString. */
function test_parseLine_kvRouting() {
  // Arrange
  const input = 'from:test1@example.com, label:Work, skipInbox:true';

  // Act
  const result = parseLine(input);

  // Assert
  assertEqual(result.from,      'test1@example.com', 'from');
  assertEqual(result.label,     ['Work'],            'label normalized to array');
  assertEqual(result.skipInbox, true,                'skipInbox');
}

/** Verifies that bracket multi-label syntax is handled correctly in key:value format. */
function test_parseLine_kvMultiLabel() {
  // Arrange
  const input = 'from:boss@work.com, label:[Work, Memes], skipInbox:true';

  // Act
  const result = parseLine(input);

  // Assert
  assertEqual(result.from,      'boss@work.com',    'from');
  assertEqual(result.label,     ['Work', 'Memes'],  'multi-label array');
  assertEqual(result.skipInbox, true,               'skipInbox');
}

/** Verifies that all supported criteria and action keys parse correctly in key:value format. */
function test_parseLine_kvAllKeys() {
  // Arrange
  const cases = [
    {
      input:    'from:boss@work.com, label:[Work, Memes], skipInbox:true, subject:Finances',
      expected: { from: 'boss@work.com', label: ['Work', 'Memes'], skipInbox: true, subject: 'Finances' },
      label:    'from, label (multi), skipInbox, subject',
    },
    {
      input:    'to:boss@work.com, subject:Finances, label:Work, markImportant:true',
      expected: { to: 'boss@work.com', label: ['Work'], markImportant: true, subject: 'Finances' },
      label:    'to, subject, label (single), markImportant',
    },
    {
      input:    'from:boss@work.com, query:Finances, hasAttachment:false, excludeChats:true',
      expected: { from: 'boss@work.com', query: 'Finances', hasAttachment: false, excludeChats: true },
      label:    'from, query, hasAttachment, excludeChats',
    },
    {
      input:    'from:boss@work.com, size:5000, sizeComparison:larger, neverMarkImportant:true',
      expected: { from: 'boss@work.com', size: 5000, sizeComparison: 'larger', neverMarkImportant: true },
      label:    'from, size (parsed as number), sizeComparison, neverMarkImportant',
    },
    {
      input:    'from:boss@work.com, neverSpam:true, category:promotions',
      expected: { from: 'boss@work.com', neverSpam: true, category: 'promotions' },
      label:    'from, neverSpam, category',
    },
    {
      input:    'from:boss@work.com, markAsRead:true, star:true, negatedQuery:unsubscribe',
      expected: { from: 'boss@work.com', markAsRead: true, star: true, negatedQuery: 'unsubscribe' },
      label:    'from, markAsRead, star, negatedQuery',
    },
    {
      input:    'from:boss@work.com, forwardTo:archive@myapp.com, delete:true',
      expected: { from: 'boss@work.com', forwardTo: 'archive@myapp.com', delete: true },
      label:    'from, forwardTo, delete',
    },
  ];

  // Act
  const results = cases.map(c => ({ ...c, actual: parseLine(c.input) }));

  // Assert
  for (const r of results) {
    assertEqual(r.actual, r.expected, r.label);
  }
}

/** Verifies that formatting variance and multi word strings are handled correctly. */
function test_parseLine_ignoreFormatting() {
  // Arrange
  const cases = [
    {
      input:    'from:boss@work.com, label:[Work,     Memes]',
      expected: { from: 'boss@work.com', label: ['Work', 'Memes'] },
      label:    'label (multi) with extra spaces',
    },
    {
      input:    'from:boss@work.com, label:[Work], skipInbox:true, skipInbox:true',
      expected: { from: 'boss@work.com', label: ['Work'], skipInbox: true },
      label:    'skipInbox:true appears twice --> ignore the second appearance',
    },
    {
      input:    'from:boss@work.com, query:Finances are Great, label:Cool Stuff, subject: Have you seen the muffin man?',
      expected: { from: 'boss@work.com', query: 'Finances are Great', label: ['Cool Stuff'], subject: 'Have you seen the muffin man?' },
      label:    'multi word query: label: and subject:',
    },
  ];

  // Act
  const results = cases.map(c => ({ ...c, actual: parseLine(c.input) }));

  // Assert
  for (const r of results) {
    assertEqual(r.actual, r.expected, r.label);
  }
}

/** Verifies that contradictory key assignments (e.g. skipInbox:true and skipInbox:false) throw. */
function test_parseLine_errorHandling() {
  // Arrange
  const input = {
    // the same logic here should apply to all keys that take boolean values
    fn:    () => parseLine('from:boss@work.com, skipInbox:true, skipInbox:false'),
    label: 'skipInbox cannot be assigned both true and false', // “It is impossible for the same thing to belong and not to belong at the same time to the same thing and in the same respect” — Aristotle
  };

  // Act + Assert
  // (assertThrows must act and assert together — the act is inside the lambda)
  assertThrows(input.fn, input.label);
}

/** Verifies that DEL lines are parsing correctly */
function test_parseLine_delRouting() {
  // Arrange
  const cases = [
    {
      input:    'DEL from:boss@work.com, label:Work, skipInbox:true',
      expected: { from: 'boss@work.com', label: ['Work'], skipInbox: true, _delete: true },
      label:    'DEL prefix stripped, _delete flag set (KV format)',
    },
    {
      input:    'DEL boss@work.com, Work, true, false',
      expected: { from: 'boss@work.com', label: ['Work'], skipInbox: true, markImportant: false, _delete: true },
      label:    'DEL prefix stripped, _delete flag set (positional format)',
    },
  ];

  // Act
  const results = cases.map(c => ({ ...c, actual: parseLine(c.input) }));

  // Assert
  for (const r of results) {
    assertEqual(r.actual, r.expected, r.label);
  }
}
