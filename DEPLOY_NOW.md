# Deploy to Railway - Quick Steps

Railway CLI is now installed! Follow these steps to deploy:

## Step 1: Login to Railway

```bash
railway login
```

This will:
- Open your browser
- Ask you to authorize Railway
- Complete authentication

## Step 2: Initialize Project

```bash
cd /home/rpretzer/usenet-newsreader
railway init
```

This will:
- Create a new Railway project
- Link it to your current directory
- Set up the deployment configuration

## Step 3: Deploy

```bash
railway up
```

This will:
- Build your application
- Deploy to Railway
- Give you a public URL

## Step 4: Get Your URL

After deployment, Railway will show you a URL like:
```
https://usenet-newsreader-production.up.railway.app
```

## Step 5: Update Frontend Config

1. Copy the Railway URL
2. Edit `public/config.js`:
   ```javascript
   window.API_BASE_URL = 'https://your-railway-url.up.railway.app';
   ```
3. Commit and push:
   ```bash
   git add public/config.js
   git commit -m "Configure Railway backend URL"
   git push origin main
   ```

## Step 6: Set Custom Domain (Optional)

If you want `api.usenet.rspmgmt.com`:

1. In Railway dashboard → Your service → Settings → Domains
2. Click "Custom Domain"
3. Enter: `api.usenet.rspmgmt.com`
4. Follow DNS instructions
5. Update `public/config.js` with the custom domain

## Troubleshooting

### If `railway login` fails:
- Make sure you're connected to the internet
- Try again - sometimes OAuth needs a retry

### If deployment fails:
- Check logs: `railway logs`
- Verify `package.json` has correct start script
- Ensure all dependencies are in `package.json`

### To view logs:
```bash
railway logs
```

### To check status:
```bash
railway status
```

## All Commands in One Go

```bash
cd /home/rpretzer/usenet-newsreader
railway login
railway init
railway up
```

That's it! Your backend will be live. 🚀

