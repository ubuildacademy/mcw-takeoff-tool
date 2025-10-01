# OCR Tables Setup Guide

## Problem
The OCR functionality is failing with a 500 error because the required database tables (`ocr_jobs` and `ocr_results`) don't exist in your Supabase database.

## Solution
You need to create the missing OCR tables in your Supabase database.

## Steps to Fix

### Option 1: Use the Supabase SQL Editor (Recommended)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project: `ufbsppxapyuplxafmpsn`

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Run the Creation Script**
   - Copy the entire contents of `create-ocr-tables.sql` (located in the root directory)
   - Paste it into the SQL editor
   - Click "Run" or press `Cmd/Ctrl + Enter`

4. **Verify Success**
   - You should see a success message
   - The tables `ocr_results` and `ocr_jobs` will now exist

### Option 2: Use the Complete Schema File

Alternatively, you can run the complete schema file if you want to ensure all tables are up to date:

1. Open the Supabase SQL Editor (same as above)
2. Copy the entire contents of `supabase-schema.sql`
3. Paste and run it in the SQL editor

This will create or update all tables including the OCR tables.

## Verification

After creating the tables, you can verify they exist by running this endpoint:

```bash
curl http://localhost:4000/api/ocr/test-tables
```

You should see:
```json
{
  "ocr_jobs": {
    "exists": true
  },
  "ocr_results": {
    "exists": true
  }
}
```

## What These Tables Do

### `ocr_results` Table
Stores the extracted text and metadata from processed PDF pages:
- `text_content`: The extracted text
- `confidence_score`: OCR confidence level
- `processing_method`: Which OCR method was used (direct_extraction, trocr, tesseract)
- `word_positions`: JSON array of individual word positions for highlighting

### `ocr_jobs` Table
Tracks the status of OCR processing jobs:
- `status`: Current job status (pending, processing, completed, failed)
- `progress`: Percentage complete
- `processed_pages` / `total_pages`: Progress tracking
- `error_message`: Any error details if the job fails

## Next Steps

Once the tables are created:

1. Restart your backend server (if needed)
2. Try running OCR on a document
3. The OCR dialog will now show real processing status
4. You can search the extracted text using the search tab

## Troubleshooting

If you still see errors after creating the tables:

1. **Check that the tables exist:**
   ```bash
   curl http://localhost:4000/api/ocr/test-tables
   ```

2. **Restart the backend server:**
   ```bash
   cd server
   npm run build
   npm run dev
   ```

3. **Check the server logs for any errors**

4. **Verify your Supabase connection** by checking that other tables (like `takeoff_projects`) are accessible

## Need Help?

If you encounter any issues:
- Check the server console for detailed error messages
- Verify your Supabase credentials in `server/src/supabase.ts`
- Make sure the `takeoff_projects` table exists (required for foreign key relationships)

