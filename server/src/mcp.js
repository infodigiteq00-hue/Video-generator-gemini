// ChatGPT app (MCP Apps / Apps SDK): exposes video generation as tools,
// with an inline player widget that shows progress and the finished clip.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ASPECT_RATIOS, IMAGE_TYPES, RESOLUTIONS, UPLOADS_DIR, ValidationError, createJob, getJob, toPublic,
} from './jobs.js';

const WIDGET_URI = 'ui://digiteq/video-player-v1.html';
const WIDGET_MIME = 'text/html;profile=mcp-app';
const WIDGET_HTML = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'widget.html'), 'utf8');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function mountMcp(app) {
  const route = process.env.MCP_TOKEN ? `/mcp/${process.env.MCP_TOKEN}` : '/mcp';
  if (!process.env.MCP_TOKEN) console.warn('MCP_TOKEN not set: /mcp is open to anyone who can reach this server');

  app.post(route, express.json({ limit: '2mb' }), async (req, res) => {
    // Stateless: a fresh server per request, bound to the public origin it was reached on.
    const server = buildServer(publicOrigin(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp]', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  app.all(route, (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST' }));
}

function publicOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto']?.split(',')[0] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function buildServer(origin) {
  const server = new McpServer({ name: 'digiteq-studio', version: '1.0.0' });

  const jobPayload = (job) => {
    const pub = toPublic(job);
    return {
      job: {
        ...pub,
        videoUrl: pub.videoUrl && origin + pub.videoUrl,
        imageUrl: pub.imageUrl && origin + pub.imageUrl,
      },
      statusUrl: `${origin}/api/jobs/${job.id}`,
      studioUrl: origin,
    };
  };

  const widgetMeta = {
    ui: { resourceUri: WIDGET_URI },
    'openai/outputTemplate': WIDGET_URI,
    'openai/widgetAccessible': true,
  };

  server.registerResource(
    'video-player',
    WIDGET_URI,
    { title: 'Digiteq video player', mimeType: WIDGET_MIME },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: WIDGET_MIME,
          text: WIDGET_HTML,
          _meta: {
            ui: { prefersBorder: true, csp: { connectDomains: [origin], resourceDomains: [origin] } },
            'openai/widgetCSP': { connect_domains: [origin], resource_domains: [origin] },
            'openai/widgetDescription': 'Shows video generation progress, then plays the finished clip.',
          },
        },
      ],
    }),
  );

  server.registerTool(
    'generate_video',
    {
      title: 'Generate video',
      description:
        'Generate a short video (4, 6 or 8 seconds) with Google Gemini Omni Flash from a text prompt, optionally animating an image. ' +
        'If the user wants to animate an image from this conversation, pass it as `image`. ' +
        'Rendering takes 1-3 minutes; the player widget updates by itself, so call this once and do not poll.',
      inputSchema: {
        prompt: z.string().min(1).max(4000).describe('Detailed description of the video: subject, action, camera, style, audio'),
        negative_prompt: z.string().max(1000).optional().describe('Things to avoid in the video'),
        aspect_ratio: z.enum(ASPECT_RATIOS).optional().describe('16:9 landscape (default) or 9:16 portrait'),
        resolution: z.enum(RESOLUTIONS).optional().describe('720p (default, cheaper) or 1080p (requires 8 seconds)'),
        duration_seconds: z.union([z.literal(4), z.literal(6), z.literal(8)]).optional().describe('Clip length, default 8'),
        image: z
          .object({
            download_url: z.string(),
            file_id: z.string(),
            mime_type: z.string().optional(),
            file_name: z.string().optional(),
          })
          .optional()
          .describe('Image to animate (first frame)'),
        image_url: z.string().url().optional().describe('Public URL of an image to animate, if no file is available'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
      _meta: {
        ...widgetMeta,
        'openai/fileParams': ['image'],
        'openai/toolInvocation/invoking': 'Starting video render…',
        'openai/toolInvocation/invoked': 'Video render started',
      },
    },
    async (args) => {
      let image = null;
      try {
        const url = args.image?.download_url || args.image_url;
        if (url) image = await downloadImage(url, args.image?.mime_type);
        const job = createJob({
          prompt: args.prompt,
          negativePrompt: args.negative_prompt,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
          durationSeconds: args.duration_seconds,
          provider: process.env.MCP_PROVIDER,
          image,
        });
        const payload = jobPayload(job);
        return {
          structuredContent: payload,
          content: [
            {
              type: 'text',
              text:
                `Started video job ${job.id} (${job.durationSeconds}s, ${job.resolution}, ${job.aspectRatio}` +
                `${image ? ', animating the provided image' : ''}). Estimated cost $${job.estimatedCost.toFixed(2)}. ` +
                'It takes 1-3 minutes and the player shows it when ready; tell the user, and do not call again.',
            },
          ],
        };
      } catch (err) {
        if (image) fs.rmSync(image.path, { force: true });
        const message = err instanceof ValidationError || err.userFacing ? err.message : `Could not start video: ${err.message}`;
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    },
  );

  server.registerTool(
    'get_video_status',
    {
      title: 'Check video status',
      description: 'Check a video job started with generate_video. Only call this if the user asks about it.',
      inputSchema: { job_id: z.string().describe('Job id returned by generate_video') },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ...widgetMeta, 'openai/toolInvocation/invoking': 'Checking video…', 'openai/toolInvocation/invoked': 'Checked video' },
    },
    async ({ job_id }) => {
      const job = getJob(job_id);
      if (!job) return { isError: true, content: [{ type: 'text', text: `No video job with id ${job_id}` }] };
      const payload = jobPayload(job);
      const text = {
        queued: 'Queued.',
        running: `Still rendering (${payload.job.elapsedSeconds}s so far).`,
        succeeded: `Ready: ${payload.job.videoUrl}`,
        failed: `Failed: ${job.error}`,
      }[job.status];
      return { structuredContent: payload, content: [{ type: 'text', text }] };
    },
  );

  return server;
}

async function downloadImage(url, mimeHint) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw userError(`Could not download the image (HTTP ${res.status})`);
  const type = (res.headers.get('content-type') || mimeHint || '').split(';')[0].trim();
  if (!IMAGE_TYPES.includes(type)) throw userError(`Image must be PNG, JPEG or WebP (got ${type || 'unknown type'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw userError('Image must be under 10 MB');
  const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[type];
  const file = path.join(UPLOADS_DIR, `${crypto.randomUUID()}${ext}`);
  fs.writeFileSync(file, buf);
  return { path: file, mimetype: type };
}

function userError(message) {
  return Object.assign(new Error(message), { userFacing: true });
}
