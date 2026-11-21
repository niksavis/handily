export const RULE_SAMPLES: readonly { rule: string; text: string }[] = [
  { rule: 'markdown', text: '## Plan\n\n- one\n- **two**' },
  {
    rule: 'log',
    text: '2026-11-21T10:40:28Z start\n2026-11-21T10:40:29Z read a.ts\n2026-11-21T10:40:30Z done',
  },
  { rule: 'lines', text: 'The next window opens at 16:00 UTC.\nAsk before you push.' },
  { rule: 'groups', text: 'The build passed. Then push main and wait for CI.' },
  { rule: 'items', text: 'Ask the owner: (1) a screenshot of the rows, (2) which session it was.' },
  { rule: 'label', text: 'Cause: seven test files had no stored time.' },
  { rule: 'warning', text: 'On any red run: stop and report; never move a pushed tag.' },
  { rule: 'note', text: 'Recommended: go on the whole sequence.' },
  {
    rule: 'tokens',
    text: 'Tag handily-reply-view--v0.30.0 on ba5a82b closes handily-15iquz, see https://example.com/run/1.',
  },
  { rule: 'escapes', text: 'Keep *stars*, _lines_ and a # mark as text.' },
]
