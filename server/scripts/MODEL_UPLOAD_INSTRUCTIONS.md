# Model Upload Instructions

## Quick Start

1. **Upload the model to Supabase Storage:**
   ```bash
   cd server
   npx ts-node scripts/upload_model_to_supabase.ts
   ```

2. **Verify upload:**
   - Check Supabase Dashboard → Storage → `project-files` bucket
   - Look for `models/floor_plan_cubicasa5k_resnet50.pth`

3. **Deploy to Railway:**
   - The model will automatically download on first server start
   - No manual steps needed!

## How It Works

- **Local Development:** Model downloads automatically if missing
- **Railway Deployment:** Model downloads on server startup if missing
- **Model Updates:** Just run the upload script again (overwrites existing)

## Manual Download (if needed)

```bash
cd server
npx ts-node scripts/download_model_from_supabase.ts
```

## Storage Location

- **Supabase Storage:** `project-files/models/floor_plan_cubicasa5k_resnet50.pth`
- **Local Path:** `server/models/floor_plan_cubicasa5k_resnet50.pth`

## Environment Variables Required

- `SUPABASE_URL` (or uses default)
- `SUPABASE_SERVICE_ROLE_KEY`

These should already be set in your Railway environment variables.

