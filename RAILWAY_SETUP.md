# Railway Deployment Setup

This repository is ready to deploy to Railway! Follow these steps:

## Quick Deploy (5 minutes)

### Step 1: Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Sign up/login with your GitHub account
3. Click **"New Project"**
4. Select **"Deploy from GitHub repo"**
5. Choose `rpretzer/usenet-newsreader`
6. Railway will automatically:
   - Detect it's a Node.js project
   - Install dependencies (`npm install`)
   - Start the server (`npm start`)
   - Assign a public URL

### Step 2: Get Your Backend URL

1. In Railway dashboard, click on your service
2. Go to **"Settings"** tab
3. Under **"Domains"**, you'll see your Railway URL:
   - Example: `https://usenet-newsreader-production.up.railway.app`
4. Copy this URL

### Step 3: Configure Frontend

1. Update `public/config.js`:
   ```javascript
   window.API_BASE_URL = 'https://your-app.up.railway.app';
   ```
   (Replace with your actual Railway URL)

2. Commit and push:
   ```bash
   git add public/config.js
   git commit -m "Configure Railway backend URL"
   git push origin main
   ```

3. GitHub Pages will auto-deploy the frontend

### Step 4: Set Up Custom Domain (Optional)

If you want `api.usenet.rspmgmt.com`:

1. In Railway dashboard → **Settings** → **Domains**
2. Click **"Custom Domain"**
3. Enter: `api.usenet.rspmgmt.com`
4. Railway will provide DNS instructions
5. Add CNAME record in Cloudflare:
   - Type: CNAME
   - Name: api
   - Target: (Railway will provide this)
6. Update `public/config.js` to use the custom domain

## Environment Variables

Railway automatically provides:
- `PORT` - Railway sets this automatically, no action needed

If you need custom environment variables:
1. Railway dashboard → Your service → **Variables** tab
2. Add any variables you need
3. They'll be available as `process.env.VARIABLE_NAME`

## Monitoring

- **Logs**: Railway dashboard → Your service → **Deployments** → Click deployment → **View Logs**
- **Metrics**: Railway dashboard shows CPU, memory, and network usage
- **Health**: Railway automatically restarts on failures

## Troubleshooting

### Service won't start
- Check logs in Railway dashboard
- Verify `package.json` has correct `start` script
- Ensure `server.js` listens on `process.env.PORT || 3000`

### Can't connect from frontend
- Verify `API_BASE_URL` in `config.js` matches Railway URL
- Check CORS settings in `server.js`
- Check Railway service is running (not paused)

### High costs
- Railway gives $5/month free credit
- Monitor usage in Railway dashboard
- Consider upgrading to paid plan if needed

## Files Included for Railway

- ✅ `railway.json` - Railway configuration
- ✅ `Procfile` - Process definition (backup)
- ✅ `package.json` - Has correct start script
- ✅ `server.js` - Uses `process.env.PORT`

## Next Steps

1. Deploy to Railway (Step 1 above)
2. Update frontend config (Step 3 above)
3. Test the connection
4. Set up custom domain if desired

That's it! Your app should be live. 🚀

