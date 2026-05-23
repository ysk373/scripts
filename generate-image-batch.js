#!/usr/bin/env node
/**
 * Gemini Batch API wrapper for image generation (~50% cost vs sync generateContent).
 *
 * Usage:
 *   node generate-image-batch.js submit <manifest.json> [--state <path>]
 *   node generate-image-batch.js status <state.json>
 *   node generate-image-batch.js collect <state.json> [--wait] [--poll-interval=30]
 *
 * manifest.json:
 * {
 *   "displayName": "robot-papers-2026-05-29",
 *   "model": "gemini-3.1-flash-image-preview",
 *   "baseDir": "../../tech/robot",
 *   "items": [
 *     { "key": "slug-arch", "prompt": "...", "output": "diagrams/papers/slug/explain-architecture.png" }
 *   ]
 * }
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import {
  DEFAULT_IMAGE_MODEL,
  defaultGenerationConfig,
  extractPngBuffers,
  geminiRequest,
  getApiKey,
} from './lib/gemini-http.js';

const COMPLETED = new Set([
  'JOB_STATE_SUCCEEDED',
  'JOB_STATE_FAILED',
  'JOB_STATE_CANCELLED',
  'JOB_STATE_EXPIRED',
  'BATCH_STATE_SUCCEEDED',
  'BATCH_STATE_FAILED',
  'BATCH_STATE_CANCELLED',
  'BATCH_STATE_EXPIRED',
]);

function usage(exitCode = 1) {
  console.error(`Usage:
  node generate-image-batch.js submit <manifest.json> [--state <path>]
  node generate-image-batch.js status <state.json>
  node generate-image-batch.js collect <state.json> [--wait] [--poll-interval=30]`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!command) usage();

  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--state') flags.state = args[++i];
    else if (a === '--wait') flags.wait = true;
    else if (a.startsWith('--poll-interval=')) {
      flags.pollInterval = Number(a.split('=')[1]) * 1000;
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      usage();
    } else positional.push(a);
  }
  return { command, positional, flags };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function normalizeBatchState(batch) {
  return batch?.state?.name || batch?.state || batch?.metadata?.state || 'UNKNOWN';
}

function batchResourceName(batch) {
  if (batch?.name) return batch.name;
  if (batch?.batch?.name) return batch.batch.name;
  return null;
}

async function createBatch(manifest) {
  const model = manifest.model || DEFAULT_IMAGE_MODEL;
  const items = manifest.items || [];
  if (!items.length) throw new Error('manifest.items is empty');

  const requests = items.map((item) => ({
    request: {
      contents: [{ parts: [{ text: item.prompt }] }],
      generationConfig: defaultGenerationConfig(),
    },
    metadata: { key: item.key },
  }));

  const body = {
    batch: {
      display_name: manifest.displayName || `image-batch-${Date.now()}`,
      input_config: {
        requests: { requests },
      },
    },
  };

  const { body: response } = await geminiRequest({
    method: 'POST',
    path: `/v1beta/models/${model}:batchGenerateContent`,
    body,
  });

  const batch = response.batch || response;
  const name = batchResourceName(batch) || batchResourceName(response);
  if (!name) {
    throw new Error(`Unexpected create response: ${JSON.stringify(response).slice(0, 800)}`);
  }
  return { model, batchName: name, batch };
}

async function getBatch(batchName) {
  const resource = batchName.startsWith('batches/') ? batchName : `batches/${batchName}`;
  const { body } = await geminiRequest({
    method: 'GET',
    path: `/v1beta/${resource}`,
  });
  return body;
}

async function downloadResultFile(fileName) {
  const resource = fileName.startsWith('files/') ? fileName : `files/${fileName}`;
  const apiKey = getApiKey();
  return new Promise((resolve, reject) => {
    https
      .request(
        {
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/${resource}:download?alt=media`,
          method: 'GET',
          headers: { 'X-goog-api-key': apiKey },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if (res.statusCode >= 400) {
              reject(new Error(`Download failed HTTP ${res.statusCode}`));
              return;
            }
            resolve(Buffer.concat(chunks));
          });
        }
      )
      .on('error', reject)
      .end();
  });
}

function parseJsonl(buffer) {
  const lines = buffer.toString('utf8').split('\n').filter((l) => l.trim());
  return lines.map((line) => JSON.parse(line));
}

function resolveOutputPath(baseDir, output) {
  return path.isAbsolute(output) ? output : path.resolve(baseDir, output);
}

async function saveItemImage(item, buffers) {
  if (!buffers.length) {
    console.warn(`  [${item.key}] no image in response`);
    return false;
  }
  const dest = item._resolvedOutput || item.resolvedOutput || item.output;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffers[0]);
  console.log(`  笨・[${item.key}] -> ${dest}`);
  return true;
}

async function collectInline(batch, state) {
  const dest = batch.dest || batch.output || {};
  const responses =
    dest.inlinedResponses || dest.inlined_responses || batch.inlinedResponses || [];
  const keyToItem = new Map(state.items.map((it) => [it.key, it]));
  let saved = 0;

  for (const entry of responses) {
    const key =
      entry.metadata?.key ||
      entry.key ||
      entry.requestMetadata?.key ||
      entry.request_metadata?.key;
    const item = keyToItem.get(key);
    if (!item) {
      console.warn(`  unknown response key: ${key}`);
      continue;
    }
    if (entry.error) {
      console.warn(`  [${key}] error: ${JSON.stringify(entry.error)}`);
      continue;
    }
    const resp = entry.response || entry;
    if (await saveItemImage(item, extractPngBuffers(resp))) saved++;
  }
  return saved;
}

async function collectFromFile(batch, state) {
  const dest = batch.dest || batch.output || {};
  const fileName = dest.responsesFile || dest.responses_file || dest.fileName || dest.file_name;
  if (!fileName) return 0;

  const buf = await downloadResultFile(fileName);
  const lines = parseJsonl(buf);
  const keyToItem = new Map(state.items.map((it) => [it.key, it]));
  let saved = 0;

  for (const line of lines) {
    const key = line.key || line.metadata?.key;
    const item = keyToItem.get(key);
    if (!item) continue;
    if (line.error) {
      console.warn(`  [${key}] error: ${JSON.stringify(line.error)}`);
      continue;
    }
    const resp = line.response || line;
    if (await saveItemImage(item, extractPngBuffers(resp))) saved++;
  }
  return saved;
}

async function cmdSubmit(manifestPath, flags) {
  const manifest = readJson(manifestPath);
  const manifestDir = path.dirname(path.resolve(manifestPath));
  const baseDir = manifest.baseDir ? path.resolve(manifestDir, manifest.baseDir) : manifestDir;

  for (const item of manifest.items) {
    item._resolvedOutput = resolveOutputPath(baseDir, item.output);
  }

  console.log(`Submitting batch (${manifest.items.length} images)...`);
  const { model, batchName, batch } = await createBatch(manifest);
  const statePath =
    flags.state ||
    path.join(manifestDir, `${(manifest.displayName || 'image-batch').replace(/\s+/g, '-')}.state.json`);

  const state = {
    version: 1,
    api: 'batch',
    model,
    batchName,
    displayName: manifest.displayName || batchName,
    manifestPath: path.resolve(manifestPath),
    baseDir,
    createdAt: new Date().toISOString(),
    items: manifest.items.map(({ key, prompt, output, _resolvedOutput }) => ({
      key,
      prompt,
      output,
      resolvedOutput: _resolvedOutput,
    })),
    lastState: normalizeBatchState(batch),
  };

  writeJson(statePath, state);
  console.log(`Batch created: ${batchName}`);
  console.log(`State file: ${statePath}`);
  console.log(`Poll: node generate-image-batch.js status ${statePath}`);
  console.log(`Collect: node generate-image-batch.js collect ${statePath} --wait`);
}

async function cmdStatus(statePath) {
  const state = readJson(statePath);
  const batch = await getBatch(state.batchName);
  const current = normalizeBatchState(batch);
  state.lastState = current;
  state.lastCheckedAt = new Date().toISOString();
  writeJson(statePath, state);
  console.log(JSON.stringify({ batchName: state.batchName, state: current }, null, 2));
}

async function cmdCollect(statePath, flags) {
  const state = readJson(statePath);
  for (const item of state.items) {
    item._resolvedOutput = item.resolvedOutput || item.output;
  }

  const pollMs = flags.pollInterval || 30_000;
  let batch = await getBatch(state.batchName);
  let current = normalizeBatchState(batch);

  while (flags.wait && !COMPLETED.has(current)) {
    console.log(`Waiting (${current})... next poll in ${pollMs / 1000}s`);
    await new Promise((r) => setTimeout(r, pollMs));
    batch = await getBatch(state.batchName);
    current = normalizeBatchState(batch);
  }

  state.lastState = current;
  state.lastCheckedAt = new Date().toISOString();
  writeJson(statePath, state);

  const succeeded = current === 'JOB_STATE_SUCCEEDED' || current === 'BATCH_STATE_SUCCEEDED';
  if (!succeeded) {
    console.error(`Batch not succeeded (state=${current}). Use --wait or retry later.`);
    if (batch.error) console.error(batch.error);
    process.exit(current.includes('FAILED') || current.includes('EXPIRED') ? 1 : 2);
  }

  let saved = await collectInline(batch, state);
  if (saved === 0) saved = await collectFromFile(batch, state);

  state.collectedAt = new Date().toISOString();
  state.savedCount = saved;
  writeJson(statePath, state);
  console.log(`Saved ${saved}/${state.items.length} images.`);
  if (saved < state.items.length) process.exit(1);
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (command === 'submit') {
    if (!positional[0]) usage();
    await cmdSubmit(positional[0], flags);
    return;
  }
  if (command === 'status') {
    if (!positional[0]) usage();
    await cmdStatus(positional[0]);
    return;
  }
  if (command === 'collect') {
    if (!positional[0]) usage();
    await cmdCollect(positional[0], flags);
    return;
  }
  usage();
}

main().catch((err) => {
  console.error(err.message || err);
  if (err.response) console.error(JSON.stringify(err.response, null, 2));
  process.exit(1);
});
