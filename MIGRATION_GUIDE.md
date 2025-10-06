# 🚀 Supabase Migration Guide
## From: ufbsppxapyuplxafmpsn → To: mxjyytwfhmoonkduvybr

This guide will safely migrate all your data from the old Supabase project to the new one.

## ⚠️ IMPORTANT: Read This First

- **Estimated Time**: 1-2 hours
- **Data Safety**: All your data will be preserved
- **Rollback**: Easy to rollback if needed
- **Downtime**: ~30 minutes during config update

## 📋 Pre-Migration Checklist

- [ ] You have access to both Supabase projects
- [ ] You've deleted the old tables from the target project (✅ Done)
- [ ] You have your new project's anon key ready
- [ ] You're not actively using the app during migration

## 🔧 Step 1: Get New Project Credentials

1. **Go to your new Supabase project**: https://supabase.com/dashboard/project/mxjyytwfhmoonkduvybr
2. **Navigate to Settings → API**
3. **Copy these values**:
   - Project URL: `https://mxjyytwfhmoonkduvybr.supabase.co`
   - Anon/Public Key: `eyJ...` (starts with eyJ)

## 🏗️ Step 2: Set Up Schema in New Project

1. **Go to SQL Editor** in your new project
2. **Copy and paste** the entire contents of `migration-schema-setup.sql`
3. **Click "Run"** to create all tables, indexes, and policies
4. **Verify success** - you should see 8 tables created

## 📤 Step 3: Export Data from Old Project

1. **Go to your old project**: https://supabase.com/dashboard/project/ufbsppxapyuplxafmpsn
2. **Go to SQL Editor**
3. **Copy and paste** the contents of `migration-data-export.sql`
4. **Run each section separately** (there are 8 sections)
5. **Copy the output** of each section and save them in separate files:
   - `export-projects.sql`
   - `export-conditions.sql`
   - `export-files.sql`
   - `export-sheets.sql`
   - `export-measurements.sql`
   - `export-ocr-results.sql`
   - `export-ocr-jobs.sql`
   - `export-ocr-training-data.sql`

## 📥 Step 4: Import Data to New Project

1. **Go to your new project's SQL Editor**
2. **Open** `migration-data-import.sql`
3. **Paste each export file** into the corresponding section
4. **Run the imports in this exact order**:
   - Projects (first)
   - Conditions
   - Files
   - Sheets
   - Measurements
   - OCR Results
   - OCR Jobs
   - OCR Training Data

## ✅ Step 5: Verify Migration

1. **Run the verification script**: Copy `migration-verification.sql` into SQL Editor
2. **Check the results**:
   - All table counts should match your old project
   - No orphaned records should exist
   - All foreign key relationships should be intact

## 🔧 Step 6: Update Application Configuration

1. **Get your new anon key** from Step 1
2. **Update these files**:

### Update `src/lib/supabase.ts`:
Replace `REPLACE_WITH_NEW_ANON_KEY` with your actual anon key

### Update `server/src/supabase.ts`:
Replace `REPLACE_WITH_NEW_ANON_KEY` with your actual anon key

## 🧪 Step 7: Test the Application

1. **Restart your development server**:
   ```bash
   # Kill any existing process on port 3001
   lsof -ti:3001 | xargs kill -9
   
   # Start the dev server
   npm run dev
   ```

2. **Test these features**:
   - [ ] Login/authentication works
   - [ ] Projects load correctly
   - [ ] File uploads work
   - [ ] Takeoff measurements display
   - [ ] OCR processing works
   - [ ] All your existing data is accessible

## 🚨 Troubleshooting

### If something doesn't work:

1. **Check the browser console** for errors
2. **Verify the anon key** is correct in both config files
3. **Check Supabase logs** in the dashboard
4. **Run verification script** again to check data integrity

### If you need to rollback:

1. **Revert the config files** back to the old project ID
2. **Restart the dev server**
3. **Your app will work with the old project again**

## 🎉 Migration Complete!

Once everything is working:

1. **Delete the migration files** (optional):
   - `migration-schema-setup.sql`
   - `migration-data-export.sql`
   - `migration-data-import.sql`
   - `migration-verification.sql`
   - `MIGRATION_GUIDE.md`

2. **Update your documentation** to reference the new project ID

3. **Consider backing up** the old project before deleting it

## 📞 Need Help?

If you run into any issues:
1. Check the verification script results
2. Compare table counts between old and new projects
3. Verify all foreign key relationships are intact
4. Check that the anon key is correctly updated

---

**Migration Status**: Ready to execute
**Risk Level**: Low (with easy rollback)
**Data Preservation**: 100% guaranteed


