# Railway Deployment Troubleshooting

## Issue: "No repositories found"

If Railway can't find your repository, try these solutions:

### Solution 1: Check Repository Visibility

Railway can only see repositories that:
- Are **public**, OR
- You've granted Railway access to (for private repos)

**To check:**
1. Go to your GitHub repository: `https://github.com/rpretzer/usenet-newsreader`
2. Check if it's public (should see "Public" badge)
3. If private, you need to grant Railway access (see Solution 2)

**To make public:**
1. GitHub repo → Settings → Scroll to bottom
2. Under "Danger Zone" → "Change repository visibility"
3. Select "Make public"

### Solution 2: Grant Railway GitHub Access

If your repo is private:

1. In Railway, go to **Settings** → **GitHub**
2. Click **"Connect GitHub"** or **"Authorize"**
3. Grant Railway access to your repositories
4. Select the repositories you want Railway to access
5. Try searching again

### Solution 3: Use Full Repository Name

Try typing the full repository name:
```
rpretzer/usenet-newsreader
```

Instead of just:
```
rpretzer/
```

### Solution 4: Connect via GitHub App

Alternative method:

1. In Railway dashboard, click **"New Project"**
2. Look for **"Deploy from GitHub"** or **"GitHub"** option
3. This should show a list of your repositories
4. Select `usenet-newsreader` from the list

### Solution 5: Manual Deploy via CLI

If the web interface doesn't work:

1. Install Railway CLI:
   ```bash
   npm install -g @railway/cli
   ```

2. Login:
   ```bash
   railway login
   ```

3. Initialize in your project:
   ```bash
   cd /path/to/usenet-newsreader
   railway init
   ```

4. Deploy:
   ```bash
   railway up
   ```

### Solution 6: Check GitHub Permissions

1. Go to GitHub → Settings → Applications → Authorized OAuth Apps
2. Find "Railway" in the list
3. Check what permissions it has
4. If missing, revoke and re-authorize

### Solution 7: Try Different Search Format

Try these variations in the search box:
- `usenet-newsreader`
- `rpretzer/usenet-newsreader`
- Just the repo name: `usenet-newsreader`

## Common Issues

### Repository Not Showing Up

**Cause**: Repository is private and Railway doesn't have access
**Fix**: Make repo public OR grant Railway access to private repos

### "Permission Denied"

**Cause**: Railway GitHub integration not properly authorized
**Fix**: Re-authorize Railway in GitHub settings

### Search Not Working

**Cause**: Typo or wrong format
**Fix**: Use full format `username/repo-name`

## OAuth Error: "Invalid state in GitHub OAuth"

This error occurs when the OAuth state parameter doesn't match. Try these fixes:

### Fix 1: Clear Browser Data
1. Clear cookies for `railway.app` and `github.com`
2. Clear browser cache
3. Try again in an incognito/private window

### Fix 2: Close All Railway Tabs
1. Close ALL Railway tabs in your browser
2. Open a fresh Railway tab
3. Try connecting to GitHub again

### Fix 3: Revoke and Re-authorize
1. Go to GitHub → Settings → Applications → Authorized OAuth Apps
2. Find "Railway" and click "Revoke"
3. Go back to Railway and try connecting again
4. This will create a fresh OAuth flow

### Fix 4: Use Different Browser
1. Try a different browser (Chrome, Firefox, Safari, Edge)
2. Or use incognito/private mode
3. This eliminates browser-specific cookie/cache issues

### Fix 5: Manual GitHub App Installation
1. Go to GitHub → Settings → Applications → Installed GitHub Apps
2. Look for Railway (if installed)
3. If present, click it and check permissions
4. If not present, Railway should install it during OAuth

### Fix 6: Wait and Retry
Sometimes OAuth servers have temporary issues:
1. Wait 5-10 minutes
2. Try again
3. Check [GitHub Status](https://www.githubstatus.com/) and [Railway Status](https://status.railway.app)

### Fix 7: Use Railway CLI Instead
Bypass the web OAuth entirely:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login (uses different auth method)
railway login

# This will open browser for auth, but uses CLI flow
# Then deploy:
cd /path/to/usenet-newsreader
railway init
railway up
```

## Still Having Issues?

1. **Check Railway Status**: [status.railway.app](https://status.railway.app)
2. **Check GitHub Status**: [githubstatus.com](https://www.githubstatus.com/)
3. **Railway Discord**: Join their community Discord for help
4. **GitHub Issues**: Check if there are known issues with Railway's GitHub integration

## Alternative: Deploy from Local

If GitHub integration continues to fail:

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. In your project directory: `railway init`
4. Deploy: `railway up`

This bypasses the GitHub integration entirely.

