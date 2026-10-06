# FounderOS

FounderOS is a private company workspace for founder tasks, commitments, projects, milestones, threaded discussions, weekly reviews, team availability, and an append-only activity record. The web app uses Next.js and the Firebase browser SDK; Firestore Security Rules are the authorization boundary for persisted workspace data.

## Local development

Requirements: Node.js 20.9 or newer, npm 10 or newer, Java 21 or newer, and Firebase CLI 14 or newer.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run emulators
```

In a second terminal:

```powershell
npm run dev
```

Open `http://localhost:3000`. Choose **Continue with local demo** to use the Auth Emulator. The Firebase Emulator UI is at `http://localhost:4000`. Emulator data is local test data; it is not shared with a cloud Firebase project.

## Firebase project setup

1. Create a Firebase project and a Web App in the Firebase console.
2. Enable Google under **Authentication → Sign-in method**.
3. Add every production hostname under **Authentication → Settings → Authorized domains**.
4. Create the Cloud Firestore database and a Cloud Storage bucket.
5. Set the Web App configuration as build-time environment variables using the names in `.env.example`, including `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`. Set `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false` or leave it unset in production. `NEXT_PUBLIC_*` values are embedded in the browser bundle at build time, so configure them in the deployment provider before building. Optional `NEXT_PUBLIC_FIREBASE_DATABASE_URL` and `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` enable Realtime Database configuration and Firebase Analytics in production.
6. Restrict the Firebase API key to the required APIs and application domains in Google Cloud. Firebase Web configuration is public client configuration; never put a service-account key or Admin SDK credential in this app or in a `NEXT_PUBLIC_*` variable.
7. Deploy the Firestore rules, Storage rules, and indexes to the intended project:

```powershell
firebase deploy --only firestore:rules,firestore:indexes,storage --project YOUR_FIREBASE_PROJECT_ID
```

The checked-in `.firebaserc` deliberately points to the emulator demo project. Always pass the real project ID explicitly for cloud commands.

## Production build

```powershell
npm ci
npm run check
npm run build
npm start
```

Use a Node.js 22 deployment runtime. The app sends security headers, disables search indexing, and provides route-level error and not-found states. GitHub Actions runs type checking, formatting, a production build, and a production dependency audit on pushes and pull requests.

## Firestore data and access

- `users/{uid}` contains the user's profile and workspace pointer.
- `teams/{teamId}` stores workspace ownership and timezone.
- `teams/{teamId}/members/{uid}` stores membership and role.
- `teams/{teamId}/tasks`, `commitments`, `projects`, and `milestones` store operating records.
- `teams/{teamId}/weeklyReviews` stores member-owned weekly reviews and immutable prior versions.
- `teams/{teamId}/activity` is readable by members and append-only through the client rules.
- `teams/{teamId}/invites/{token}` stores expiring, single-use team invitations.
- `teams/{teamId}/tasks/{taskId}/comments/{commentId}` stores threaded task discussions.
- `teams/{teamId}/tasks/{taskId}/history/{eventId}` stores immutable status changes.
- `users/{uid}/notifications` stores private in-app assignment and task-reply notices.

Every workspace read requires membership. Team invites are random 256-bit links, bound to a verified email address, single-use, and expire after seven days. Owners can assign Admin, Member, or Viewer; Admins can assign Member or Viewer. Owners/Admins manage membership and invites within those limits. Members can contribute and discuss; Viewers are read-only. Firestore rules enforce these permissions, invite acceptance, and immutable discussion history. FounderOS generates a copyable invite link; the team owner shares it with the invitee. Automatic email delivery requires an email provider and is not configured yet.

Task descriptions can be added at creation or edited later. Each task has a live discussion thread with replies. Team members set their local workdays, hours, and availability; the common-time finder translates those windows across IANA timezones and avoids scheduled team meetings. Weekly reviews preserve previous versions. Scheduling a meeting requests Calendar permission, creates an event in the acting user's primary Google Calendar, emails attendees through Google Calendar, and requests a Google Meet conference link. In-app notifications cover new assignments and task discussion replies; email/WhatsApp reminders and scheduled digests need a delivery provider and are not configured.

The Google Calendar API is enabled in the Google Cloud project used by Firebase Authentication. Each organizer must grant Calendar access before creating a Google Meet link; configure the OAuth consent screen, authorized domains, and the `https://www.googleapis.com/auth/calendar.events` scope for the app's audience. Cloud Firestore backups, alerting, and production OAuth domains must also be configured before launch.

## Current product scope

The application code is prepared for a production build, but it is not live-cloud provisioned by this repository. Local development uses the Firebase Emulator demo project and placeholder web configuration. Before launch, provision a real Firebase project, authorized domains, OAuth client and Calendar consent, deploy Firestore/Storage rules and indexes, configure deployment environment variables and backups/monitoring, and verify the production Google sign-in and Calendar flows. Do not deploy `.env.local` or the emulator demo configuration. External email/WhatsApp reminder delivery and scheduled digests remain unimplemented; analytics dashboards are also outside the current release.
