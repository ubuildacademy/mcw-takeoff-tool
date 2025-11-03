# Ollama API Setup

## Quick Setup for Railway

To enable Ollama AI features (chat, AI takeoff, sheet analysis), you need to add the Ollama API key to your Railway backend environment variables.

### Steps:

1. **Get your Ollama API key:**
   - Go to https://ollama.com/account/api-keys
   - Create a new API key or copy your existing one

2. **Add to Railway:**
   - Go to your Railway project dashboard
   - Select your backend service
   - Go to **Variables** tab
   - Click **+ New Variable**
   - Add:
     - **Variable Name:** `OLLAMA_API_KEY`
     - **Value:** Your API key from step 1
   - Click **Add**

3. **Redeploy:**
   - Railway will automatically redeploy when you add environment variables
   - Wait for the deployment to complete (usually 1-2 minutes)

4. **Verify it's working:**
   - Try using the chat feature in the app
   - Or check Railway logs for any Ollama-related errors

### Optional: Custom Base URL

If you're using a different Ollama endpoint, you can also set:
- **Variable Name:** `OLLAMA_BASE_URL`
- **Value:** Your custom endpoint (defaults to `https://ollama.com`)

### Features that require Ollama:
- ✅ Chat functionality
- ✅ AI Takeoff analysis
- ✅ Sheet/page analysis
- ✅ Visual AI detection (Qwen3-VL)
- ✅ YOLOv8 detection

Without the API key, these features will show "API key not configured" errors.

