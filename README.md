# Four Seasons Markets

Public website: https://cmcnosky.github.io/four-seasons-markets-preview/

One frontend contains the market guide, vendor directory, profiles, offers, reservation planning, and promotion studio. Email/password and Google sign-in use Firebase Authentication; authenticated saves and the public directory use the hosted API configured in `docs/platform-config.js`.

GitHub Pages serves `main:/docs`. It does not host a database. The API stores vendor work in D1, enforces account ownership, and exposes only published profile fields and current offers. Browser-local customer favorites and checklists are separate from account data.

The social share card is `docs/assets/social-preview.png` (1200×630), referenced by static Open Graph and Twitter metadata in `docs/index.html`.

This is an independent redesign. Research was checked November 3, 2026. Reservation plans do not confirm booths or collect payments. Promotion tools create content for vendors to share; they do not automatically post to social networks. This repository does not replace the organizer's operating systems or establish approval to operate its service.
