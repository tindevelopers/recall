# Fix: AADSTS50194 - Multi-Tenant Configuration Error

## Problem
Error: "Application is not configured as a multi-tenant application. Usage of the /common endpoint is not supported."

## Solution: Configure App as Multi-Tenant

### Step 1: Go to Azure Portal
1. Navigate to [Azure Portal](https://portal.azure.com/)
2. Go to **Azure Active Directory** → **App registrations**
3. Find your app: **Recall V2 Demo** (ID: `c4ab4004-1aa3-4b65-bb4a-2d7c6ac39176`)

### Step 2: Change Account Type to Multi-Tenant
1. Click on your app registration
2. Go to **Authentication** in the left menu
3. Under **Supported account types**, click **Edit**
4. Select: **"Accounts in any organizational directory and personal Microsoft accounts"**
   - This enables multi-tenant support
5. Click **Save**

### Step 3: Wait for Propagation
- Azure changes can take 1-5 minutes to propagate
- Wait a few minutes before testing

### Step 4: Test Again
1. Go back to your app: https://recall-v2-demo-production.up.railway.app
2. Click **Connect** for Microsoft Outlook
3. Sign in with your Microsoft account
4. It should work now!

## Why This Happens

The v2-demo application uses the `/common` endpoint which supports:
- Users from any organization
- Personal Microsoft accounts
- Multiple tenants

But if your Azure app is configured as **single-tenant**, it only works for users in your specific organization, and Microsoft blocks the `/common` endpoint.

## Alternative: Use Tenant-Specific Endpoint (Not Recommended)

If you MUST keep it single-tenant, you'd need to:
1. Get your Azure Tenant ID
2. Change the code to use: `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/authorize`
3. This limits the app to only your organization's users

**Recommendation**: Use multi-tenant configuration (above) - it's simpler and more flexible.
