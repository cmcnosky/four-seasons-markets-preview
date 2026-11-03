# Four Seasons Markets — public market guide

Public guide: https://cmcnosky.github.io/four-seasons-markets-preview/

Vendor workspace: https://four-seasons-vendor-hub.cmcnosky.chatgpt.site/index.html#workspace

The public guide and vendor workspace share the redesigned market experience. This is an independent project, not the organizer’s official reservation or payment system.

## Accounts and publication

The vendor workspace uses ChatGPT sign-in and account-scoped server storage. Saved profiles, offers, reservation plans, and promotions can be loaded from another device after signing in to the same account.

Vendors explicitly publish their business profiles. Customers can browse those profiles and current published offers without an account. Unpublished profiles, draft/archived offers, reservation notes, and campaign drafts are excluded from the public directory. Vendors can unpublish profiles and archive offers.

The GitHub Pages guide reads the public directory from the account service without credentials. Vendor routes open the same-design workspace on that service’s secure origin. Authentication and writes remain on the app host; no account token or private workspace API is exposed through GitHub Pages.

The earlier browser-local demo was replaced. It remains available in this repository’s Git history. Its saved local records are not automatically uploaded or published.

## Frontend source

`docs/` contains the served site and assets. `docs/platform-config.js` contains public service URLs, not secrets. GitHub Pages publishes `main:/docs`; no build is required for this frontend.

The account service is a separate Sites/Vinext application with D1 storage, owner checks, versioned writes, and a public directory projection. Its source is maintained separately from this static repository. The original private redesign was not repurposed or exposed.

## Market and operational limits

The market dates and researched vendor information were checked on November 3, 2026. The November 7–8 dates are a research snapshot, not a live schedule feed; pages link to their sources. A vendor-created profile is not organizer approval or a confirmed event appearance.

Reservation plans do not allocate real booths, collect payments, or update the original portal. Promotion tools save campaign details and generate graphics and captions; they do not post to social networks.

Market photography and vendor imagery retain their respective owners’ rights. Brand and asset permissions, organizer-approved schedules, inventory, staff approval, payments, and operational acceptance would be needed for an official replacement.
