# OAuth Troubleshooting Guide

## Error: invalid_grant (AADSTS9002313)

This error typically means one of these issues:

### 1. Redirect URI Mismatch (Most Common)

**Problem**: The redirect URI in Azure doesn't match exactly what the app is using.

**Solution**:
1. Go to Azure Portal → Your App Registration → **Authentication**
2. Check the redirect URI is exactly:
   ```
   https://recall-recall-production.up.railway.app/oauth-callback/microsoft-outlook
   ```
3. Make sure:
   - No trailing slash
   - Exact match (case-sensitive)
   - Platform is set to **Web**
   - HTTPS (not HTTP)

### 2. Authorization Code Expired

**Problem**: Authorization codes expire quickly (usually within 5-10 minutes).

**Solution**: Try connecting again immediately after clicking "Connect".

### 3. Code Already Used

**Problem**: Authorization codes can only be used once.

**Solution**: If you refresh the callback page or try again, you need to start fresh by clicking "Connect" again.

### 4. Missing Code Parameter

**Problem**: The callback URL doesn't include the `code` parameter.

**Check**: Look at the browser URL when redirected back. It should look like:
```
https://recall-recall-production.up.railway.app/oauth-callback/microsoft-outlook?code=...&state=...
```

If the `code` parameter is missing, check:
- Redirect URI configuration in Azure
- Network/firewall issues
- Browser blocking redirects

## Debugging Steps

1. **Check Railway Logs**:
   ```bash
   railway logs --tail 50
   ```
   Look for: "Received microsoft oauth callback" - check if code is undefined

2. **Verify Environment Variables**:
   ```bash
   railway variables | grep MICROSOFT
   ```
   Ensure both CLIENT_ID and CLIENT_SECRET are set

3. **Check Azure Configuration**:
   - Redirect URI matches exactly
   - API permissions are granted
   - Admin consent is granted (if required)

4. **Test the Flow**:
   - Clear browser cache/cookies
   - Try connecting again
   - Check the full callback URL in browser address bar

## Common Fixes

### Fix 1: Update Redirect URI in Azure
1. Azure Portal → App Registration → Authentication
2. Remove old redirect URI
3. Add new one: `https://recall-recall-production.up.railway.app/oauth-callback/microsoft-outlook`
4. Save

### Fix 2: Verify Environment Variables
```bash
railway variables --set "MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID=your-id"
railway variables --set "MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET=your-secret"
```

### Fix 3: Redeploy
After changing environment variables or Azure settings:
```bash
railway up
```
