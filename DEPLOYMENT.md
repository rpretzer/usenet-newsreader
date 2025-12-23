# Deployment Guide

This guide explains how to deploy the Usenet Newsreader to GitHub Pages with a custom domain.

## Architecture

The application consists of two parts:
1. **Frontend** (static files) - Deployed to GitHub Pages
2. **Backend** (Node.js server) - Needs to be deployed separately (see Backend Deployment)

## Frontend Deployment to GitHub Pages

### Step 1: Enable GitHub Pages

1. Go to your repository settings on GitHub
2. Navigate to **Pages** in the left sidebar
3. Under **Source**, select **GitHub Actions**
4. The workflow will automatically deploy when you push to `main`

### Step 2: Configure Custom Domain (usenet.rspmgmt.com)

1. In the same **Pages** settings, under **Custom domain**, enter: `usenet.rspmgmt.com`
2. Check **Enforce HTTPS** (recommended)

### Step 3: DNS Configuration

Add a CNAME record in your DNS provider:

```
Type: CNAME
Name: usenet
Value: rpretzer.github.io
TTL: 3600 (or your provider's default)
```

Or if using an A record:

```
Type: A
Name: usenet
Value: 185.199.108.153
Value: 185.199.109.153
Value: 185.199.110.153
Value: 185.199.111.153
```

### Step 4: Update API Configuration

Once your backend is deployed, update `public/config.js`:

```javascript
window.API_BASE_URL = 'https://your-backend-url.com';
```

Then commit and push:

```bash
git add public/config.js
git commit -m "Configure API URL for production"
git push origin main
```

## Backend Deployment

The backend needs to run on a server that supports Node.js. Here are some options:

### Option 1: Railway (Recommended - Easy)

1. Go to [railway.app](https://railway.app)
2. Create a new project
3. Connect your GitHub repository
4. Railway will auto-detect Node.js and deploy
5. Set environment variable `PORT` (Railway provides this automatically)
6. Your backend URL will be something like: `https://your-app.railway.app`

### Option 2: Render

1. Go to [render.com](https://render.com)
2. Create a new **Web Service**
3. Connect your GitHub repository
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Your backend URL will be: `https://your-app.onrender.com`

### Option 3: Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run: `fly launch`
3. Follow the prompts
4. Deploy: `fly deploy`

### Option 4: Your Own Server

If you have a VPS or server:

```bash
# Clone the repository
git clone https://github.com/rpretzer/usenet-newsreader.git
cd usenet-newsreader

# Install dependencies
npm install

# Set PORT environment variable (optional, defaults to 3000)
export PORT=3000

# Run with PM2 (recommended for production)
npm install -g pm2
pm2 start server.js --name usenet-newsreader
pm2 save
pm2 startup
```

## CORS Configuration (Important!)

If your frontend and backend are on different domains, you need to enable CORS in the backend.

Update `server.js` to add CORS headers:

```javascript
const express = require('express');
const cors = require('cors');

const app = express();

// Enable CORS for your frontend domain
app.use(cors({
  origin: 'https://usenet.rspmgmt.com',
  credentials: true
}));

// ... rest of your code
```

And install the cors package:

```bash
npm install cors
```

## Testing the Deployment

1. **Frontend**: Visit `https://usenet.rspmgmt.com` (or your GitHub Pages URL)
2. **Backend**: Test the API at `https://your-backend-url.com/api/groups`
3. **Integration**: Try connecting to a news server from the frontend

## Troubleshooting

### Frontend can't connect to backend

- Check that `API_BASE_URL` in `config.js` is correct
- Verify CORS is enabled on the backend
- Check browser console for errors
- Verify backend is running and accessible

### Custom domain not working

- Wait 24-48 hours for DNS propagation
- Verify DNS records are correct
- Check GitHub Pages settings show the custom domain
- Ensure HTTPS is enabled

### Backend connection issues

- Check backend logs
- Verify environment variables are set
- Check firewall rules allow incoming connections
- Test backend API directly with curl

## Security Notes

- Never commit `config.js` with production API URLs if the repo is public
- Consider using environment variables for sensitive configuration
- Use HTTPS for both frontend and backend
- Consider adding rate limiting to the backend API

