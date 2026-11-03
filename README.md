# Four Seasons Markets — public design preview

A redesigned market guide and integrated vendor workspace.

Public preview: https://cmcnosky.github.io/four-seasons-markets-preview/

The public preview is hosted on GitHub Pages. It is an independent design concept, not the organizer’s official website or a live booking service.

## What visitors can try

- Browse six sourced market listings, filter markets and vendors, open directions, save favorites, and download a calendar event.
- Plan a reservation request, select a booth size, review a fee estimate, and cancel a demo request.
- Create and edit a business profile, including a photo and shop links, then preview it in the directory.
- Draft, publish, edit, and archive demo offers with market and date restrictions.
- Save promotional campaigns, copy captions, and download square or story graphics.

All editable vendor data stays in that visitor’s browser. “Publish” displays a profile or offer only in that browser’s local directory. No vendor data is shared with other visitors, synchronized between devices, submitted to market staff, or imported from the original portal. Clearing site data removes saved work. Local storage is not an authenticated account: anyone using the same browser profile can see its saved work. Use sample information for this demo.

Reservations do not allocate real booths or collect payments. Promotion exports retain a draft / attendance-not-confirmed label. The market dates and public vendor information were researched on November 3, 2026; individual pages link to sources. Dates are a research snapshot, not a live schedule feed. Past occurrences cannot be requested.

## Source layout

- `docs/` contains the published static website and local assets.
- `src/vendor-state.ts` contains the shared domain schemas and rules.
- `src/preview-storage.ts` adapts those rules to browser storage.
- `docs/preview-storage.js` is the generated browser bundle.
- `tests/` checks persistence, validation, conflicts, storage failures, and directory visibility.

Build the storage bundle with `npm ci && npm run build`; run checks with `npm test`. The checked-in `docs/` directory can be served directly by a static web server. GitHub Pages is configured to publish `main:/docs`.

The separate database-backed private redesign is maintained independently; this repository contains only the public static preview.

## Brand and assets

This concept is not endorsed by Four Seasons Markets. Market photography and vendor imagery are credited by their source context and the site’s About page. These assets retain their respective owners’ rights. Brand and asset permissions, organizer-approved schedules, account migration, inventory, staff approval, payments, moderation, and operational testing would be needed for an official replacement.
