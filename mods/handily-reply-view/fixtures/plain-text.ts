export const REVIEW_MESSAGE =
  'basicly consumer proof in terminal (test_basicly_pin_matches_the_installed_harness): design in 3 lines. It does not narrow the test; drift becomes impossible by construction.\n1. One source: BASICLY_REF is read from .basicly/state/install.json (basicly_version, refused by name unless it matches ^\\d+\\.\\d+\\.\\d+$). In a clone it reads the file in place. For the uvx entry, a build_py step in a small setup.py copies install.json into the package as terminal_setup/_harness.json, because the installed package does not contain .basicly/. configs.py then holds no version literal.\n2. The test asserts the derivation, not a second copy: BASICLY_REF == "v" + install.json\'s version; the built wheel holds _harness.json equal to install.json; and configs.py has no hand-written pin. So a basicly install moves the pin with it (the "bump BASICLY_REF with every install" step goes away), and the consumer proof passes, because the pin follows the candidate harness.\n3. Risk: in the proof sandbox the pin names the unreleased candidate. That is harmless, because the proof only runs tests and never runs setup against GitHub. A real terminal release can only carry a released version, because install.json changes only by a committed basicly install of a published wheel. Cost: a setup.py build hook, which is a build-config change; it fails if setuptools skips build_py for the archive build (I prove it with a uvx --no-cache probe from outside the repo).\nAlternative, not recommended: the proof passes its candidate version in an environment variable and the test compares against it. That adds a test exception, so it needs a council.\nI build it as its own record after A2 lands, before B, when you say go.'

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
  { rule: 'review', text: REVIEW_MESSAGE },
]
