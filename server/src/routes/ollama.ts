import express from 'express';
import axios from 'axios';

const router = express.Router();

// Ollama Cloud API configuration
const OLLAMA_BASE_URL = 'https://ollama.com';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// Get available models
router.get('/models', async (req, res) => {
  try {
    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: {
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching Ollama models:', error);
    res.status(500).json({ 
      error: 'Failed to fetch models',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Check if Ollama is available
router.get('/health', async (req, res) => {
  try {
    if (!OLLAMA_API_KEY) {
      return res.json({ 
        available: false, 
        error: 'Ollama API key not configured'
      });
    }

    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: {
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    res.json({ 
      available: true, 
      models: response.data.models?.length || 0 
    });
  } catch (error) {
    console.error('Ollama health check failed:', error);
    res.json({ 
      available: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { model, messages, stream = false, options = {} } = req.body;

    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        error: 'Missing required fields: model and messages' 
      });
    }

    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const requestData = {
      model,
      messages,
      stream,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        ...options
      }
    };

    if (stream) {
      // Handle streaming response
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream',
          timeout: 300000 // 5 minutes timeout for long responses
        }
      );

      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            res.write(line + '\n');
          }
        }
      });

      response.data.on('end', () => {
        res.end();
      });

      response.data.on('error', (error: Error) => {
        console.error('Streaming error:', error);
        res.status(500).json({ error: 'Streaming error occurred' });
      });

    } else {
      // Handle non-streaming response
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 300000 // 5 minutes timeout
        }
      );

      res.json(response.data);
    }

  } catch (error) {
    console.error('Error in Ollama chat:', error);
    
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        res.status(503).json({ 
          error: 'Ollama service unavailable',
          details: 'Make sure Ollama is running on localhost:11434'
        });
      } else if (error.response) {
        res.status(error.response.status).json({
          error: 'Ollama API error',
          details: error.response.data
        });
      } else {
        res.status(500).json({
          error: 'Network error',
          details: error.message
        });
      }
    } else {
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Generate embeddings
router.post('/embeddings', async (req, res) => {
  try {
    const { model, prompt } = req.body;

    if (!model || !prompt) {
      return res.status(400).json({ 
        error: 'Missing required fields: model and prompt' 
      });
    }

    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/embeddings`,
      { model, prompt },
      {
        headers: {
          'Authorization': `Bearer ${OLLAMA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 1 minute timeout
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error generating embeddings:', error);
    res.status(500).json({ 
      error: 'Failed to generate embeddings',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Pull a model
router.post('/pull', async (req, res) => {
  try {
    const { name, stream = false } = req.body;

    if (!name) {
      return res.status(400).json({ 
        error: 'Missing required field: name' 
      });
    }

    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/pull`,
      { name, stream },
      {
        headers: {
          'Authorization': `Bearer ${OLLAMA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 1800000 // 30 minutes timeout for model downloads
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error pulling model:', error);
    res.status(500).json({ 
      error: 'Failed to pull model',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
