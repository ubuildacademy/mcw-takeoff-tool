import express from 'express';
import axios from 'axios';
import { aiChatBurstRateLimit, requireAuth } from '../middleware';
import { checkAndIncrementAiChatDailyQuota } from '../services/aiUsageService';
import { evaluateAiChatGuardrails } from '../services/aiGuardrails';

const router = express.Router();

// Environment variables
// Note: VITE_ prefixed vars are for frontend only - backend should use OLLAMA_API_KEY directly
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'https://ollama.com';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// Cloud-only models list: always hit ollama.com so we don't mix in local models (e.g. OLLAMA_BASE_URL=localhost)
const OLLAMA_CLOUD_API = 'https://ollama.com';

// Models endpoint hits Ollama Cloud (ollama.com/api/tags) only. API response is the source of truth.
router.get('/models', async (req, res) => {
  try {
    if (!OLLAMA_API_KEY) {
      return res.status(400).json({ error: 'Ollama API key not configured' });
    }

    // IMPORTANT: filter to cloud-only offerings so the UI doesn't show local-only registry models.
    // This matches the model list shown on https://ollama.com/search?c=cloud
    const url = `${OLLAMA_CLOUD_API}/api/tags?c=cloud`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000,
      validateStatus: () => true // accept any status so we can inspect and forward
    });

    if (response.status !== 200) {
      const body = response.data && typeof response.data === 'object'
        ? JSON.stringify(response.data)
        : String(response.data);
      console.warn('[Ollama /models] Upstream error:', response.status, body);
      return res.status(response.status).json({
        error: response.data?.error ?? `Ollama API returned ${response.status}`,
        models: [] // so client can still use fallback
      });
    }

    const data = response.data;
    if (!data || !Array.isArray(data.models)) {
      console.warn('[Ollama /models] Unexpected response shape:', typeof data);
      return res.status(200).json({ models: [] });
    }

    res.json({ models: data.models });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Ollama /models] Error fetching models:', error);
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const body = error.response.data;
      const errMsg = body && typeof body === 'object' ? (body.error ?? JSON.stringify(body)) : String(body);
      return res.status(status).json({ error: errMsg, models: [] });
    }
    return res.status(500).json({ error: message, models: [] });
  }
});

// Chat endpoint
router.post('/chat', requireAuth, aiChatBurstRateLimit, async (req, res) => {
  try {
    const { model, messages, stream, options } = req.body;

    if (!OLLAMA_API_KEY) {
      return res.status(400).json({ error: 'Ollama API key not configured' });
    }

    if (!model || !messages) {
      return res.status(400).json({ error: 'Missing required fields: model and messages' });
    }

    // Guardrails: restrict obvious off-domain usage before consuming upstream quota.
    const lastUser = Array.isArray(messages)
      ? [...messages].reverse().find((m: any) => m && m.role === 'user' && typeof m.content === 'string')
      : null;
    const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const guard = evaluateAiChatGuardrails(lastUserText);
    if (!guard.allowed) {
      return res.status(422).json({ error: guard.reason });
    }

    // Daily quota (request-count). Admins get a higher limit by default.
    const user = req.user!;
    const isAdmin = user.role === 'admin';
    const dailyLimit = isAdmin ? 200 : 40;
    const quota = await checkAndIncrementAiChatDailyQuota({
      userId: user.id,
      limitPerDay: dailyLimit,
      bypass: false,
    });

    res.setHeader('X-AI-Daily-Limit', quota.limit);
    res.setHeader('X-AI-Daily-Remaining', quota.remaining);
    res.setHeader('X-AI-Daily-Reset', quota.resetAtEpochSeconds);

    if (!quota.allowed) {
      res.setHeader('Retry-After', quota.retryAfterSeconds);
      return res.status(429).json({
        error: 'Daily AI chat limit reached. Please try again later.',
        retryAfter: quota.retryAfterSeconds,
      });
    }

    if (stream) {
      // Handle streaming response
      res.status(200);
      // Important: avoid res.writeHead() here so we don't clobber headers set by cors().
      // Ollama streams newline-delimited JSON (NDJSON).
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      // Some proxies buffer streaming responses unless explicitly disabled.
      res.setHeader('X-Accel-Buffering', 'no');
      // Explicitly opt out of compression for this streaming response.
      res.setHeader('Content-Encoding', 'identity');
      res.flushHeaders?.();

      try {
        const response = await axios.post(
          `${OLLAMA_BASE_URL}/api/chat`,
          {
            model,
            messages,
            stream: true,
            options: options || {}
          },
          {
            headers: {
              'Authorization': `Bearer ${OLLAMA_API_KEY}`,
              'Content-Type': 'application/json'
            },
            responseType: 'stream',
            timeout: 120000 // 2 minutes for streaming
          }
        );

        // If the client disconnects, stop reading from upstream.
        const abortController = new AbortController();
        req.on('close', () => {
          abortController.abort();
          try {
            response.data?.destroy?.();
          } catch {
            // ignore
          }
        });

        response.data.on('data', (chunk: Buffer) => {
          // Ensure immediate flush of streamed chunks
          res.write(chunk);
        });

        response.data.on('end', () => {
          res.end();
        });

        response.data.on('error', (error: Error) => {
          console.error('Streaming error:', error);
          res.end();
        });

      } catch (streamError) {
        console.error('Streaming request error:', streamError);
        res.end();
      }
    } else {
      // Handle non-streaming response
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        {
          model,
          messages,
          stream: false,
          options: options || {}
        },
        {
          headers: {
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 1 minute for non-streaming
        }
      );

      res.json(response.data);
    }
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    if (axios.isAxiosError(error)) {
      if (error.response) {
        res.status(error.response.status).json({ error: `Ollama API error: ${error.response.data}` });
      } else {
        res.status(500).json({ error: `Network error: ${error.message}` });
      }
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});


export default router;
