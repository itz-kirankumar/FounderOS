<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Deploy Configuration (configured by /setup-deploy)

- Platform: Vercel
- Production URL: https://wisentry-founder-os.vercel.app
- Deploy workflow: Vercel Git integration for branch previews; production deployments use `vercel deploy --prod` from the linked `founder-os` project
- Deploy status command: `vercel inspect https://wisentry-founder-os.vercel.app`
- Merge method: pull request
- Project type: Next.js web app
- Post-deploy health check: https://wisentry-founder-os.vercel.app

### Custom deploy hooks

- Pre-merge: `npm run check` and `npm run build`
- Deploy trigger: `vercel deploy --prod`
- Deploy status: `vercel inspect https://wisentry-founder-os.vercel.app`
- Health check: verify the production URL returns HTTP 200 and the Firebase sign-in screen no longer reports missing configuration
