# Mobile Browser Troubleshooting

## Issue: "Connection failed: load failed" on Mobile

This error typically occurs due to:

1. **Network connectivity issues**
2. **CORS configuration problems**
3. **Mobile browser privacy settings**
4. **API URL not accessible**

## Solutions

### 1. Check API URL is Accessible

Verify the backend is reachable from your mobile device:

- Open mobile browser
- Visit: `https://usenet-newsreader-production.up.railway.app/api/groups?server=news.eternal-september.org&port=119`
- You should see JSON data or an error message
- If you get "connection refused" or timeout, the backend might be down

### 2. Firefox Focus Specific Issues

Firefox Focus has strict privacy settings:

**Option A: Disable Tracking Protection Temporarily**
1. In Firefox Focus, tap the shield icon
2. Disable "Tracking Protection" for the site
3. Try again

**Option B: Use Standard Firefox**
- Firefox Focus blocks many requests by default
- Try using regular Firefox or Chrome on mobile

### 3. Check Network Connection

- Ensure you're on WiFi or have mobile data
- Try a different network
- Check if other websites load

### 4. Verify CORS Configuration

The backend now allows all origins, but if issues persist:

1. Check Railway logs: `railway logs`
2. Look for CORS errors
3. Verify the backend is running

### 5. Test API Directly

From your mobile browser, try accessing:

```
https://usenet-newsreader-production.up.railway.app/api/groups?server=news.eternal-september.org&port=119
```

If this works, the issue is with the frontend connection.
If this fails, the issue is with the backend or network.

### 6. Check Browser Console

On mobile, enable remote debugging:

**Android Chrome:**
1. Connect phone via USB
2. Enable USB debugging
3. Open Chrome on desktop: `chrome://inspect`
4. View console errors

**iOS Safari:**
1. Enable Web Inspector in Settings → Safari → Advanced
2. Connect to Mac
3. Open Safari → Develop → [Your Device] → [Page]
4. View console errors

### 7. Alternative: Use Desktop Browser

For testing, try:
- Desktop Chrome/Firefox
- Mobile Chrome (not Focus)
- Safari on iOS

## Common Mobile Browser Issues

### Firefox Focus
- **Issue**: Aggressive privacy blocking
- **Fix**: Disable tracking protection or use standard Firefox

### Safari iOS
- **Issue**: May block mixed content
- **Fix**: Ensure both frontend and backend use HTTPS

### Chrome Mobile
- **Issue**: May cache old API URLs
- **Fix**: Clear cache and hard refresh

## Debugging Steps

1. **Check API URL in config.js**
   - Should be: `https://usenet-newsreader-production.up.railway.app`
   - Verify it's correct

2. **Test backend directly**
   - Visit API URL in mobile browser
   - Should return JSON or error message

3. **Check Railway status**
   - Verify service is running
   - Check logs for errors

4. **Network inspection**
   - Use browser dev tools
   - Check Network tab for failed requests
   - Look for CORS errors

## Quick Fixes

### If backend is down:
```bash
railway logs
railway up  # Redeploy if needed
```

### If CORS issues:
- Backend now allows all origins
- Should work from any domain

### If network issues:
- Try different network
- Check firewall settings
- Verify mobile data/WiFi is working

## Still Not Working?

1. Check Railway dashboard - is service running?
2. Check Railway logs for errors
3. Try accessing backend URL directly from mobile
4. Test with different mobile browser
5. Check if issue is specific to Firefox Focus

