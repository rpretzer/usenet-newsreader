# Squarespace DNS Configuration

Since you're managing DNS with Squarespace Domains, here's how to set up the DNS records:

## Frontend (GitHub Pages) - usenet.rspmgmt.com

### Option 1: CNAME Record (Recommended)

1. Log into Squarespace Domains
2. Go to DNS Settings for `rspmgmt.com`
3. Add a CNAME record:
   - **Type**: CNAME
   - **Host**: `usenet`
   - **Points to**: `rpretzer.github.io`
   - **TTL**: 3600 (or default)

This will make `usenet.rspmgmt.com` point to your GitHub Pages site.

### Option 2: A Records (Alternative)

If CNAME doesn't work, use A records:

1. Add 4 A records:
   - **Type**: A
   - **Host**: `usenet`
   - **Points to**: `185.199.108.153`
   - **TTL**: 3600
   
   - **Type**: A
   - **Host**: `usenet`
   - **Points to**: `185.199.109.153`
   - **TTL**: 3600
   
   - **Type**: A
   - **Host**: `usenet`
   - **Points to**: `185.199.110.153`
   - **TTL**: 3600
   
   - **Type**: A
   - **Host**: `usenet`
   - **Points to**: `185.199.111.153`
   - **TTL**: 3600

## Backend (Railway) - api.usenet.rspmgmt.com (Optional)

If you want a custom domain for your backend:

1. **First, get Railway's domain target:**
   - In Railway dashboard → Your service → Settings → Domains
   - Click "Custom Domain"
   - Enter: `api.usenet.rspmgmt.com`
   - Railway will show you the target (usually something like `cname.railway.app` or an IP)

2. **Add CNAME in Squarespace:**
   - **Type**: CNAME
   - **Host**: `api.usenet` (or just `api` if Squarespace auto-adds the domain)
   - **Points to**: (The target Railway provides)
   - **TTL**: 3600

3. **Update frontend config:**
   - Edit `public/config.js`:
     ```javascript
     window.API_BASE_URL = 'https://api.usenet.rspmgmt.com';
     ```
   - Commit and push

## Current Setup

Right now, your setup is:
- **Frontend**: Will be at `usenet.rspmgmt.com` (once DNS propagates)
- **Backend**: `https://usenet-newsreader-production.up.railway.app`

The frontend config is already set to use the Railway URL, so it will work immediately.

## DNS Propagation

After adding DNS records:
- **CNAME records**: Usually propagate in 5-30 minutes
- **A records**: Can take up to 24-48 hours (usually much faster)
- You can check propagation: [whatsmydns.net](https://www.whatsmydns.net)

## Squarespace-Specific Notes

- Squarespace may auto-append the domain name, so:
  - If you enter `usenet` as host, it becomes `usenet.rspmgmt.com`
  - If you enter `api.usenet` as host, it becomes `api.usenet.rspmgmt.com`
- Check Squarespace's documentation for their exact format
- Some Squarespace plans have DNS management in different locations

## Testing

After DNS propagates:

1. **Test frontend**: Visit `https://usenet.rspmgmt.com`
2. **Test backend**: The frontend should automatically connect to Railway
3. **Check browser console**: Look for any CORS or connection errors

## Troubleshooting

### Frontend not loading
- Verify CNAME points to `rpretzer.github.io`
- Check GitHub Pages settings show the custom domain
- Wait for DNS propagation (can take up to 48 hours)

### Backend connection fails
- Verify Railway service is running
- Check CORS settings in `server.js` include your domain
- Check browser console for specific errors

### Squarespace DNS not updating
- Some Squarespace plans have limited DNS management
- You may need to use Squarespace's nameservers
- Contact Squarespace support if DNS options are limited

## Quick Reference

**For Frontend (usenet.rspmgmt.com):**
```
Type: CNAME
Host: usenet
Points to: rpretzer.github.io
```

**For Backend (api.usenet.rspmgmt.com) - Optional:**
```
Type: CNAME
Host: api.usenet (or api)
Points to: [Railway provides this]
```

