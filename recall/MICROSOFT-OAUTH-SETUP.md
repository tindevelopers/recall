# Microsoft Outlook OAuth Setup Guide

## Step 1: Create Azure App Registration

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **"+ New registration"**
4. Fill in:
   - **Name**: `Recall V2 Demo` (or any name)
   - **Supported account types**: **IMPORTANT** - Select:
     - ✅ **"Accounts in any organizational directory and personal Microsoft accounts"** (Multi-tenant)
     - ❌ Do NOT select "Accounts in this organizational directory only" (Single-tenant)
   - **Redirect URI**: 
     - Platform: **Web**
     - URI: `https://recall-recall-production.up.railway.app/oauth-callback/microsoft-outlook`
5. Click **Register**

**⚠️ CRITICAL**: If you already created the app as single-tenant, you need to change it:
1. Go to **Authentication** in your app registration
2. Under **Supported account types**, click **Edit**
3. Change to **"Accounts in any organizational directory and personal Microsoft accounts"**
4. Click **Save**

## Step 2: Get Client ID and Secret

### Get Client ID:
1. After registration, you'll see the **Overview** page
2. Copy the **Application (client) ID** - this is your `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID`

### Create Client Secret:
1. Go to **Certificates & secrets** in the left menu
2. Click **"+ New client secret"**
3. Add a description (e.g., "Railway Production")
4. Choose expiration (12 months, 24 months, or never)
5. Click **Add**
6. **IMPORTANT**: Copy the **Value** immediately (you won't see it again!)
   - This is your `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET`

## Step 3: Configure API Permissions

1. Go to **API permissions** in the left menu
2. Click **"+ Add a permission"**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Add these permissions:
   - `offline_access` (for refresh tokens)
   - `Calendars.Read` (to read calendar events)
   - `openid` (for authentication)
   - `email` (to get user email)
6. Click **Add permissions**
7. Click **Grant admin consent** (if you're an admin) or users will need to consent

## Step 4: Set Environment Variables in Railway

Run these commands (replace with your actual values):

```bash
railway variables --set "MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID=your-client-id-here"
railway variables --set "MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET=your-client-secret-here"
```

Or set them in Railway dashboard:
1. Go to your Railway project
2. Select the service
3. Go to **Variables** tab
4. Add:
   - `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` = your client ID
   - `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` = your client secret

## Step 5: Verify Redirect URI

Make sure the redirect URI in Azure matches exactly:
```
https://recall-recall-production.up.railway.app/oauth-callback/microsoft-outlook
```

## Step 6: Redeploy (if needed)

Railway should automatically redeploy when you set environment variables. If not:

```bash
railway up
```

## Troubleshooting

**Error: Application not found**
- Verify `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` is set correctly
- Check for typos in the client ID

**Error: Invalid redirect URI**
- Ensure redirect URI in Azure matches exactly: `https://recall-recall-production.up.railway.app/oauth-callback/microsoft-outlook`
- No trailing slash
- Must be HTTPS (not HTTP)

**Error: Invalid client secret**
- Verify `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` is set correctly
- If secret expired, create a new one in Azure

**Error: Insufficient permissions**
- Make sure API permissions are added
- Grant admin consent if required

**Error: AADSTS50194 - Not configured as multi-tenant**
- This means your app is set to single-tenant but the code uses `/common` endpoint
- **Fix**: Go to Azure Portal → Your App → **Authentication**
- Under **Supported account types**, change to **"Accounts in any organizational directory and personal Microsoft accounts"**
- Click **Save**
- Wait a few minutes for changes to propagate
- Try connecting again
