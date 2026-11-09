# VKey Smart Switch Browser fork

Based on [phatMT97/VKey-Browser](https://github.com/phatMT97/VKey-Browser), GPL-3.0-only.

## Changes

The original extension stores the current VI/EN mode per hostname in `storage.session`. This fork additionally stores a mode keyed by Chromium tab ID in `tabModes`. The precedence is **hard English rule > tab choice > hostname session choice > existing VKey app preference**. Tabs on the same hostname can have independent VI/EN choices. Tab choices are cleared on tab close and session reset.

The native protocol remains version 2. It only provides the hostname for a mode-change event; the extension associates the hotkey with the last published active tab when the hostname matches. If there is no safe match, it falls back to hostname memory. It does not inspect page content or keystrokes. A stronger future protocol should include a host-confirmed window/tab correlation token for instant tab-switch race handling.

## Quick test

```bash
npm test
```

Full Windows E2E testing is still required. Experimental, not a stable release.
