# Quick Deploy - Just 2 Steps!

I've prepared everything. You just need to:

## Step 1: Login (One-time, opens browser)

```bash
railway login
```

This will open your browser - just authorize Railway and you're done.

## Step 2: Run the deployment script

```bash
./deploy.sh
```

That's it! The script will:
- ✅ Check you're logged in
- ✅ Initialize the Railway project
- ✅ Deploy your app
- ✅ Show you the URL

## After Deployment

The script will show you your Railway URL. Then:

1. Edit `public/config.js` and set:
   ```javascript
   window.API_BASE_URL = 'https://your-railway-url.up.railway.app';
   ```

2. Commit and push:
   ```bash
   git add public/config.js
   git commit -m "Configure Railway backend URL"
   git push origin main
   ```

3. GitHub Pages will auto-deploy the frontend with the new backend URL!

## Or Do It Manually

If you prefer, you can run the commands directly:

```bash
railway login          # One-time browser auth
railway init          # Create project
railway up            # Deploy
```

The deployment script just automates steps 2 and 3 for you.

