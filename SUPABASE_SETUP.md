# Supabase Setup Guide

## 1. Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up/Login and create a new project
3. Choose a name like "meridian-takeoff"
4. Set a strong database password
5. Choose a region close to you

## 2. Get Your Credentials

1. Go to your project dashboard
2. Click on "Settings" → "API"
3. Copy the following values:
   - **Project URL** (looks like: `https://your-project.supabase.co`)
   - **Anon/Public Key** (starts with `eyJ...`)

## 3. Set Up Environment Variables

Create a `.env.local` file in your project root with:

```env
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key-here
```

## 4. Create Database Tables

1. Go to your Supabase project dashboard
2. Click on "SQL Editor"
3. Copy and paste the contents of `supabase-schema.sql`
4. Click "Run" to create the tables

## 5. Test the Connection

The app will now use Supabase instead of localStorage for:
- ✅ Projects
- ✅ Conditions  
- ✅ Measurements

## Benefits of Supabase

- **Reliable Persistence**: Data never disappears
- **Real-time Updates**: Changes sync instantly
- **Scalability**: Handles thousands of measurements
- **Backup & Recovery**: Data is safely stored in the cloud
- **User Management**: Ready for multi-user features later

## Migration from localStorage

The app will automatically migrate from localStorage to Supabase once you:
1. Set up the environment variables
2. Create the database tables
3. Restart the development server

No data will be lost - the app will use Supabase for new data and can optionally import existing localStorage data.
