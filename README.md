# Four Seasons Markets

Public website: https://cmcnosky.github.io/four-seasons-markets-preview/

One frontend contains the market guide, customer saved places, vendor directory, profiles, offers, applications, booking workflows, promotion kit, and a role-scoped manager desk. Email/password and Google sign-in use Firebase Authentication. Authenticated saves and public listings use the hosted API configured in `docs/platform-config.js`.

GitHub Pages serves `main:/docs`; the hosted API stores account data in D1 and files in R2. The API enforces account ownership and staff roles. Published profiles and current offers appear to customers. Signed-in follows of markets and published vendors sync to account storage; researched-directory favorites and visitor checklists remain browser-local.

The social share card is `docs/assets/social-preview.png` (1200×630), referenced by static Open Graph and Twitter metadata. Market and researched-vendor share pages have dedicated metadata. Promotion tools produce downloadable square, story, and poster graphics with QR links; they do not automatically post to social networks.

This is an independent adoption proposal. Research was checked November 3, 2026. Official booking activation requires organizer authorization and approved operating policies. Payment execution, outgoing email/SMS, a final business domain, and production operating policies remain adoption-stage setup. Existing reservation plans remain archived separately from the new booking workflow. The website does not establish approval to operate the organizer's service.

Administrative collection views are bounded and labeled when older records are excluded; full pagination is not yet implemented. Database snapshots support integrity-checked restoration of missing records and are not an offsite backup service. Account closure hides public content but does not automatically cancel bookings or issue refunds.
