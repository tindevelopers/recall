# Set Up Google Calendar OAuth

## Problem

You're seeing "The OAuth client was not found" error because Google OAuth credentials are not configured.

## Solution

### Step 1: Create OAuth Credentials in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Navigate to **APIs & Services** → **Credentials**
4. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
5. If prompted, configure the OAuth consent screen first:
   - Choose **External** user type
   - Fill in required fields (App name, User support email, Developer contact)
   - Add scopes: `https://www.googleapis.com/auth/calendar.events.readonly` and `https://www.googleapis.com/auth/userinfo.email`
   - Save and continue
6. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: `Recall V2 Demo` (or any name)
   - Authorized redirect URIs: 
     - `https://recall-recall-production.up.railway.app/oauth-callback/google-calendar`
   - Click **Create**
7. Copy the **Client ID** and **Client Secret**

### Step 2: Set Environment Variables in Railway

Run these commands:

```bash
railway variables --set "GOOGLE_CALENDAR_OAUTH_CLIENT_ID=your-client-id-here" --service recall-recall
railway variables --set "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=your-client-secret-here" --service recall-recall
```

Replace `your-client-id-here` and `your-client-secret-here` with the actual values from Google Cloud Console.

### Step 3: Verify Redirect URI is Added

Make sure you added this redirect URI in Google Cloud Console:
- `https://recall-recall-production.up.railway.app/oauth-callback/google-calendar`

**Important:** The URI must match exactly (no trailing slash, correct protocol).

### Step 4: Redeploy

After setting the variables, redeploy:

```bash
railway up
```

### Step 5: Test

Try connecting Google Calendar again. The error should be resolved.

## Troubleshooting

**Error: "OAuth client was not found"**
- Verify `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` is set correctly
- Check that the Client ID exists in Google Cloud Console
- Ensure the redirect URI is added in Google Cloud Console

**Error: "redirect_uri_mismatch"**
- Verify the redirect URI in Google Cloud Console matches exactly:
  - `https://recall-recall-production.up.railway.app/oauth-callback/google-calendar`
- No trailing slash, correct protocol (https://)


