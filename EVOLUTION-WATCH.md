# NovaCore Evolution Watch

Evolution Watch is a local-only monitor for the NovaCore workspace. It checks the current viewport, device motion and pointer preferences, bundled guidance, and source text pasted into the active workspace. A read-only application diagnostics scan also checks a fixed list of required files and features and runs Node.js syntax checks on the bundled JavaScript. It does not fetch live trends, upload source, execute project code, or edit application files.

The signal monitor runs when a workspace is open, performs a bounded scan every 60 seconds while the page is visible, and can also be started manually. Application diagnostics run on workspace entry and every five minutes while visible, or can be started manually. A scan may suggest one of four predefined CSS-token adjustments: compact, balanced, or spacious card padding, or stronger keyboard-focus contrast when accessibility-related text is present.

Suggestions are previews only. Applying one requires an explicit confirmation in the review dialog, changes only this browser, and can be undone. No application source code is auto-repaired or self-updated. Scan state and an approved tune are stored in the signed-in account's local IndexedDB settings.

## Validation

- JavaScript syntax checked with Node.js.
- Browser-tested scan, preview, apply, undo, session restoration, and sign-out cleanup.
- Confirmed Evolution Watch makes no external requests; live searches run only after session opt-in and explicit submission. Direct website addresses navigate only when submitted.
- Confirmed no horizontal overflow at a 360px viewport.
- Confirmed the “Created by Nihad” footer remains present.
