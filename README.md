# GitLab MR Viewer

A note: This project was created as an experiment with agentic code tools to explore and test the current state of agent mode and AI-assisted development.

A lightweight, client-side web app for advanced filtering and viewing of GitLab merge requests. Built with Next.js and designed with privacy in mind - your API token never leaves your browser.

## Features

✨ **Advanced Filtering**: Filter merge requests by state, author, assignee, reviewer, labels, branches, dates, and more  
🔒 **Client-Side Only**: All API calls are made directly from your browser to GitLab - no server-side processing  
🔐 **Privacy Focused**: Your GitLab API token is stored only in your browser's memory  
🎨 **Clean Interface**: Modern, responsive design that works in light and dark mode  
⚡ **Fast & Lightweight**: Built on static export - can be deployed anywhere  
🔍 **Rich Display**: View merge request details, pipeline status, comments, labels, and more

## Getting Started

### Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Production Build

For static hosting (GitHub Pages, Netlify, etc.):
```bash
npm run build:static
```

For regular Next.js deployment:
```bash
npm run build
```

The app is configured to export as static files, so the `out/` directory can be deployed to any static hosting service.

## Deployment to GitHub Pages

This app is configured for automatic deployment to GitHub Pages:

1. **Fork or clone this repository** to your GitHub account

2. **Enable GitHub Pages**:
   - Go to your repository Settings → Pages
   - Set Source to "GitHub Actions"

3. **Push to main branch**:
   - The GitHub Actions workflow will automatically build and deploy
   - Your app will be available at `https://yourusername.github.io/gitlab-mr-viewer/`

4. **Manual deployment** (if needed):
   ```bash
   npm run build:static
   # Upload the contents of the `out/` directory to your hosting service
   ```

### Repository Setup

The following files enable GitHub Pages deployment:
- `.github/workflows/deploy.yml` - Automated build and deployment
- `next.config.ts` - Configured for static export
- `public/.nojekyll` - Ensures GitHub Pages serves all files correctly

## Usage

1. **Configure GitLab Connection**:
   - Enter your GitLab instance URL (e.g., `https://gitlab.com`)
   - Create a Personal Access Token with `api` and `read_user` scopes
   - The connection is tested before proceeding

2. **Select a Project**:
   - Choose from your accessible GitLab projects
   - Search functionality helps find projects quickly

3. **Filter Merge Requests**:
   - Use the comprehensive filter panel to narrow down results
   - Filters include: state, author, assignee, reviewer, labels, branches, dates, draft status, and title search

4. **View Results**:
   - Browse merge requests with rich information display
   - Click titles to open merge requests in GitLab
   - See pipeline status, assignees, reviewers, labels, and more

## Security & Privacy

- 🔒 **No Server Processing**: All GitLab API calls are made client-side
- 🚫 **No Data Storage**: Your API token and data are never sent to our servers
- 💾 **Local Storage Only**: Token is stored in your browsers local storage
- 🌐 **Direct Connection**: Your browser connects directly to GitLab's API
- 📦 **Static Deployment**: Can be self-hosted on any static hosting service

## Technology Stack

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS 4
- **Language**: TypeScript
- **Export**: Static site generation
- **API**: GitLab REST API v4

## GitLab API Token Setup

1. Go to your GitLab instance (e.g., gitlab.com)
2. Navigate to: **Settings** → **Access Tokens** → **Personal Access Tokens**
3. Create a new token with these scopes:
   - `api` - Full API access
   - `read_user` - Read user information
4. Copy the token and paste it into the app

## Supported GitLab Instances

- GitLab.com (gitlab.com)
- Self-managed GitLab instances
- GitLab Enterprise

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Deployment

Since this is a static export, you can deploy to:

- **Vercel**: Push to GitHub and connect to Vercel
- **Netlify**: Drag and drop the `out/` folder
- **GitHub Pages**: Use the static files from `out/`
- **Any Static Host**: Upload the contents of `out/`
- **Self-hosted**: Serve the `out/` directory with any web server

The app works entirely client-side, so no server configuration is needed.
