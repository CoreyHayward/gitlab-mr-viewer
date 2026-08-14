# ReviewFlow / GitLab MR Viewer

ReviewFlow now has two modes:

- a native macOS review studio that uses the GitLab, Codex, and Claude Code CLIs already authenticated on your Mac;
- the original static, client-side GitLab workspace for finding merge requests, monitoring merge trains, and reviewing changed code in a browser.

This project began as an experiment with agentic development tools and remains a practical personal/team utility.

## Native macOS app

The desktop app provides a focused review-request dashboard, local filters, exact-ref managed worktrees, a guided semantic walkthrough, private notes and progress, repository-aware Q&A, and an optional automated pass that proposes evidence-backed candidate findings for human verification.

GitLab is implemented through a provider-neutral source-control adapter. The contracts, settings UI, review references, repository manager, and persistence layer already reserve GitHub as the next adapter; GitHub is visible but intentionally disabled until that implementation ships. See [the desktop architecture](docs/desktop-architecture.md).

Requirements:

- Apple Silicon Mac and Node.js 20 or newer for this unsigned MVP build;
- `glab` installed and authenticated for the GitLab host (`glab auth login --hostname gitlab.com`);
- Codex and/or Claude Code installed, with at least one authenticated (`codex login` or `claude auth login`).

Run the native app in development:

```bash
npm ci
npm run desktop:dev
```

Build an unsigned local `.app`:

```bash
npm run desktop:package
open release/mac-arm64/ReviewFlow.app
```

`desktop:package` creates an unpacked app for local use. `desktop:dist` creates unsigned DMG and ZIP artifacts. Signing, notarization, Intel builds, and distribution hardening are intentionally outside the MVP.

ReviewFlow creates repositories and detached worktrees only inside its own macOS application-data directory. It does not touch an existing checkout. Agent runs are constrained to read-only repository access, and the desktop MVP never posts comments, approves, merges, or edits code automatically.

## Web app capabilities

- Lists merge requests progressively across projects the current user belongs to, or within one or more selected projects, without relying on GitLab's expensive unfiltered instance-wide `scope=all` query.
- Loads paginated results on demand, preserves successful results when one GitLab request fails, and identifies partial data in the UI.
- Filters by state, approval state, author, exact project name/path, title inclusion/exclusion, draft status, and created/merged dates.
- Provides quick views for your open MRs, MRs needing approval, MRs you have not approved, and recently merged MRs.
- Lets you save named custom quick filters from the current URL state, then reuse or delete them from the quick-filter row.
- Shares the current project/filter/review location through the URL and supports manual or idle one-minute refresh.
- Monitors active merge trains for a separately saved set of projects, including a visible train-yard view.
- Opens a guided review that groups related files, tracks private notes and review status, highlights new commits, and exposes incomplete GitLab diffs instead of hiding them.
- Displays existing GitLab discussions and can post line/range comments and thread replies.
- Can approve an MR from the final review step. Approval intentionally remains available regardless of local review progress.
- Optionally uses an OpenAI-compatible provider to refine grouping or answer questions about a concept or selected diff range. Provider payloads are bounded; files omitted from an exceptionally large AI request remain represented by the local fallback review.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful checks:

```bash
npm run check
npm run build
npm run build:static
```

`build:static` writes the deployable site to `out/`.

### Live GitLab API benchmark

The normal test suite never contacts GitLab. To compare the current REST detail path with the combined GraphQL path against real data, create an ignored `.env.gitlab.local` file:

```dotenv
GITLAB_BENCHMARK_URL=https://gitlab.com
GITLAB_BENCHMARK_TOKEN=<temporary token with read_api scope>
GITLAB_BENCHMARK_AUTHORS=<comma-separated usernames>
```

Then run `npm run test:gitlab-api`. The benchmark verifies MR identities, project metadata, approval counts, approver usernames, and diff totals, but reports only aggregate timings and request counts. Delete the temporary credential file after the run.

## Connect to GitLab

1. Enter the base URL of GitLab, such as `https://gitlab.com`.
2. Create a personal access token with the `api` and `read_user` scopes.
3. Enter the token and let the app validate `/api/v4/user` before opening the workspace.

The `api` scope is needed for optional approval and discussion actions as well as reads. A self-managed GitLab instance must allow the deployed site’s origin through CORS.

The project selector scopes the API request itself. The **Specific Projects** advanced filter instead matches exact project names or full namespace paths within the merge-request pages you load.

## Guided review

Choose **Guided review** on an MR card. The workspace loads MR metadata, every available page from GitLab’s merge-request diffs endpoint, and every discussion page. It then:

- creates a local semantic outline (optionally refined by AI);
- preserves all files and all diff text returned by GitLab;
- previews long files in a focused view with a **Show all diff lines** action;
- saves notes and status after a short debounce;
- marks every affected concept stale when later commits touch its files;
- warns when GitLab marks files `collapsed` or `too_large`, or otherwise returns fewer files than reported.

GitLab can omit very large files at the API boundary. The warning links the decision back to GitLab; it does not disable approval.

Review progress, cached workspace data, discussions, and watched merge-train projects are scoped by GitLab instance and current user. Older local caches are migrated when they can be attributed to the active connection.

## Optional AI provider

The default is an editable `gpt-5-mini` model at `https://api.openai.com/v1`. A custom provider must implement the Chat Completions API and allow browser CORS requests.

The provider receives bounded portions of the MR title, description, changed paths, and diffs needed for the requested operation. Diff text is treated as untrusted input in the system prompt. The app does not send this data through an application server.

## Browser storage and privacy

- GitLab and optional AI calls go directly from the browser to the configured provider.
- Tokens remain in memory unless you choose to remember them in browser local storage.
- Saved review state and merge-train selections stay in browser local storage, namespaced by instance and user.
- Custom quick filters stay in browser local storage, scoped by GitLab instance and user.
- Disconnect clears saved GitLab and AI credentials; local review progress remains available for that same scoped account.
- This client-only model is best suited to a trusted device and restricted personal tokens.

## Deployment

The app uses Next.js static export and can be hosted on GitHub Pages, Netlify, Vercel static hosting, or any web server that serves `out/`.

For GitHub Pages:

1. Set **Settings → Pages → Source** to **GitHub Actions**.
2. Push to `main`.
3. The workflow type-checks, lints, and tests first, then builds and deploys with Pages-only permissions on the deploy job.

Pull requests run the quality job but never receive Pages or OIDC write permissions.

## Stack

- Next.js 15 and React 19
- TypeScript
- Tailwind CSS 4
- Vitest
- GitLab REST API v4 and GraphQL for batched project, approval, and diff details

## License

[MIT](LICENSE)
