# FounderOS

FounderOS is a private workspace for founder tasks, commitments, projects, and an append-only activity record. The web app uses Next.js and the Firebase browser SDK; Firestore Security Rules are the authorization boundary for all persisted workspace data.

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
4. Create the Cloud Firestore database.
5. Set the Web App configuration as build-time environment variables using the names in `.env.example`. Set `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false` or leave it unset in production. `NEXT_PUBLIC_*` values are embedded in the browser bundle at build time, so configure them in the deployment provider before building.
6. Restrict the Firebase API key to the required APIs and application domains in Google Cloud. Firebase Web configuration is public client configuration; never put a service-account key or Admin SDK credential in this app or in a `NEXT_PUBLIC_*` variable.
7. Deploy the Firestore rules and indexes to the intended project:

```powershell
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_FIREBASE_PROJECT_ID
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
- `teams/{teamId}/tasks`, `commitments`, and `projects` store operating records.
- `teams/{teamId}/activity` is readable by members and append-only through the client rules.
- `teams/{teamId}/invites/{token}` stores expiring, single-use team invitations.
- `teams/{teamId}/tasks/{taskId}/comments/{commentId}` stores threaded task discussions.

Every workspace read requires membership. Team invites are random 256-bit links, bound to a verified email address, single-use, and expire after seven days. Owners can assign Admin, Member, or Viewer; Admins can assign Member or Viewer. Owners/Admins manage membership and invites within those limits. Members can contribute and discuss; Viewers are read-only. Firestore rules enforce these permissions, invite acceptance, and immutable discussion history. FounderOS generates a copyable invite link; the team owner shares it with the invitee. Automatic email delivery requires an email provider and is not configured yet.

Task descriptions can be added at creation or edited later. Each task has a live discussion thread with replies. Scheduling a meeting requests Calendar permission, creates an event in the acting user's primary Google Calendar, emails attendees through Google Calendar, and requests a Google Meet conference link.

Before enabling meeting scheduling in production, enable the Google Calendar API in the Google Cloud project used by Firebase Authentication, configure the OAuth consent screen and authorized domains, and publish/verify the `https://www.googleapis.com/auth/calendar.events` scope as required for the audience. Each organizer must grant Calendar access. Cloud Firestore backups, alerting, and production OAuth domains must also be configured before launch.

## Current product scope

The current release includes Google sign-in, multiple team workspaces per user, role-based team management, email-bound invitation links, task descriptions and threaded discussions, Google Calendar meeting scheduling, commitments, projects, activity history, and a dashboard. Reminder delivery, weekly reviews, and analytics are not yet implemented.
