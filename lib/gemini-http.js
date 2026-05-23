import https from 'https';

const DEFAULT_HOST = 'generativelanguage.googleapis.com';

export function getApiKey() {
  return process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY || '';
}

/**
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.path - e.g. /v1beta/models/foo:batchGenerateContent
 * @param {object} [opts.body]
 * @param {string} [opts.apiKey]
 */
export function geminiRequest({ method, path, body, apiKey = getApiKey() }) {
  if (!apiKey) {
    return Promise.reject(new Error('GEMINI_IMAGE_API_KEY (or GEMINI_API_KEY) is not set'));
  }

  const payload = body ? JSON.stringify(body) : null;
  const headers = {
    'X-goog-api-key': apiKey,
  };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: DEFAULT_HOST, path, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = { raw: data };
          }
          if (res.statusCode >= 400) {
            const err = new Error(
              parsed?.error?.message || `HTTP ${res.statusCode}: ${data.slice(0, 500)}`
            );
            err.statusCode = res.statusCode;
            err.response = parsed;
            reject(err);
            return;
          }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** @param {object} response - GenerateContent or batch inline response */
export function extractPngBuffers(response) {
  const buffers = [];
  const parts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      buffers.push(Buffer.from(part.inlineData.data, 'base64'));
    }
  }
  return buffers;
}

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

export function defaultGenerationConfig() {
  return {
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
  };
}
