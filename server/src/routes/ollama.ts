import express from 'express';
import axios from 'axios';
import { supabase } from '../supabase';
import * as path from 'path';
import * as fs from 'fs-extra';
import { requireAuth } from '../middleware';

const router = express.Router();

// Environment variables
// Note: VITE_ prefixed vars are for frontend only - backend should use OLLAMA_API_KEY directly
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'https://ollama.com';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// Cloud-only models list: always hit ollama.com so we don't mix in local models (e.g. OLLAMA_BASE_URL=localhost)
const OLLAMA_CLOUD_API = 'https://ollama.com';

// Cloud models use the "-cloud" suffix (e.g. gpt-oss:120b-cloud). Filter so we only show cloud models.
function isCloudModel(name: string): boolean {
  return typeof name === 'string' && name.endsWith('-cloud');
}

// Get available models (cloud only). No auth required - list is not sensitive; server uses its own API key.
// Always uses Ollama cloud API so dropdowns never show locally hosted models.
router.get('/models', async (req, res) => {
  try {
    if (!OLLAMA_API_KEY) {
      return res.status(400).json({ error: 'Ollama API key not configured' });
    }

    const url = `${OLLAMA_CLOUD_API}/api/tags`;
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

    const cloudOnly = data.models.filter((m: { name?: string }) => isCloudModel(m?.name ?? ''));
    res.json({ models: cloudOnly });
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
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { model, messages, stream, options } = req.body;

    if (!OLLAMA_API_KEY) {
      return res.status(400).json({ error: 'Ollama API key not configured' });
    }

    if (!model || !messages) {
      return res.status(400).json({ error: 'Missing required fields: model and messages' });
    }

    if (stream) {
      // Handle streaming response
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

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

        response.data.on('data', (chunk: Buffer) => {
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
