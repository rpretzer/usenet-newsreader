# Usenet Newsreader

A minimal text-only Usenet newsreader with a browser-based interface.

## Features

- Browse text-only Usenet newsgroups
- Read articles in a clean, minimal interface
- Post and reply to messages
- Username/password authentication support
- Search and filter newsgroups
- Connect to any NNTP server
- Terminal-inspired dark theme

## Quick Start

### Local Development

```bash
npm install
npm start
```

Then open your browser to `http://localhost:3000`

### Production Deployment

This app is ready to deploy:

- **Frontend**: GitHub Pages (see `DEPLOYMENT.md`)
- **Backend**: Railway (see `RAILWAY_SETUP.md`)

Quick deploy to Railway:
1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub
3. Select this repository
4. Done! Railway auto-detects and deploys

## Configuration

### Local Development
- Default server: `news.eternal-september.org` on port 119
- Change server in the UI

### Production
- Update `public/config.js` with your backend URL
- See `DEPLOYMENT.md` for full setup instructions

## Requirements

- Node.js 14+
- Access to an NNTP server (many public servers are available)

## Documentation

- `DEPLOYMENT.md` - Full deployment guide
- `RAILWAY_SETUP.md` - Railway-specific setup
- `RAILWAY_VS_RENDER.md` - Hosting comparison
- `CLOUDFLARE_DEPLOYMENT.md` - Cloudflare options

## License

MIT

