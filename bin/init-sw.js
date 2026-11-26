#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SDK_ROOT = path.resolve(__dirname, '..');

const START_MARKER = '// >>> VIDEXPULSE PUSH SDK START';
const END_MARKER = '// <<< VIDEXPULSE PUSH SDK END';

const SW_SNIPPET = `${START_MARKER}
self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const notif = payload.notification || payload;
  const title = notif.title || payload.title || 'Notification';
  const body = notif.body || payload.body || '';
  const icon = notif.icon || notif.image || payload.imageUrl || undefined;
  const clickUrl = payload.fcmOptions?.link || notif.click_action || payload.data?.clickUrl || payload.clickUrl || '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      data: { ...payload, clickUrl }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const extra = data.data && typeof data.data === 'object' ? data.data : data;
  const targetUrl = data.clickUrl || extra.clickUrl || '/';
  const trackingClickUrl = extra.trackingClickUrl || data.trackingClickUrl || '';
  const notificationId = extra.notificationId || data.notificationId || '';
  const appId = extra.appId || data.appId || '';
  const deviceId = extra.deviceId || data.deviceId || '';

  const tasks = [];
  if (trackingClickUrl && notificationId) {
    tasks.push(
      fetch(trackingClickUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          notificationId,
          deviceId,
          platform: 'web',
          clickUrl: targetUrl
        }),
        keepalive: true
      }).catch(() => {})
    );
  }
  tasks.push(self.clients.openWindow(targetUrl));
  event.waitUntil(Promise.all(tasks));
});
${END_MARKER}
`;

const NEXT_TOKEN_ROUTE_TS = `import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const baseUrl = String(process.env.VIDEXPULSE_URL || '').trim().replace(/\\/+$/, '');
  const appId = String(process.env.VIDEXPULSE_APP_ID || '').trim();
  const apiKey = String(process.env.VIDEXPULSE_API_KEY || '').trim();
  const secretKey = String(process.env.VIDEXPULSE_SECRET_KEY || '').trim();

  if (!baseUrl || !appId || !apiKey || !secretKey) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  try {
    const res = await fetch(\`\${baseUrl}/api/apps/\${encodeURIComponent(appId)}/sdk-token\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-videxpulse-api-key': apiKey,
        'x-videxpulse-secret-key': secretKey
      },
      body: JSON.stringify({ platform: 'web', capabilities: ['register', 'unregister'] }),
      cache: 'no-store'
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error || 'Failed to mint Videxpulse token', status: res.status },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      configured: true,
      baseUrl,
      appId,
      publishToken: data.publishToken || data.token || ''
    });
  } catch {
    return NextResponse.json({ error: 'Videxpulse unreachable' }, { status: 502 });
  }
}
`;

const NEXT_PUSH_COMPONENT_TSX = `'use client';

import { useEffect } from 'react';
import { mountVidexpulsePrompt } from '@videxpulse/web-sdk';

export default function VidexpulsePushInit() {
  useEffect(() => {
    mountVidexpulsePrompt({ tokenEndpoint: '/api/videxpulse/token' });
  }, []);

  return null;
}
`;

function parseArgs(argv) {
  const args = { ifProject: false, target: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--if-project') {
      args.ifProject = true;
    } else if (argv[i] === '--target' && argv[i + 1]) {
      args.target = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function resolveProjectRoot() {
  const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : '';
  const cwd = path.resolve(process.cwd());
  return initCwd || cwd;
}

function resolvePublicDir(projectRoot) {
  for (const dirName of ['public', 'static', 'www']) {
    const candidate = path.join(projectRoot, dirName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return projectRoot;
}

function findTargetServiceWorker(publicDir, explicitTarget) {
  if (explicitTarget) {
    return path.resolve(publicDir, explicitTarget);
  }

  for (const existingName of ['push-sw.js', 'sw.js', 'service-worker.js']) {
    const candidate = path.join(publicDir, existingName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return path.join(publicDir, 'push-sw.js');
}

function setupServiceWorker(projectRoot, explicitTarget) {
  const publicDir = resolvePublicDir(projectRoot);
  const swPath = findTargetServiceWorker(publicDir, explicitTarget);

  if (fs.existsSync(swPath)) {
    const current = fs.readFileSync(swPath, 'utf8');
    if (current.includes(START_MARKER)) {
      console.log(`[videxpulse-sw] Videxpulse listeners already present in ${path.relative(projectRoot, swPath)}`);
      return;
    }
    const separator = current.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(swPath, `${current}${separator}${SW_SNIPPET}`, 'utf8');
    console.log(`[videxpulse-sw] Appended Videxpulse push listeners to existing ${path.relative(projectRoot, swPath)}`);
    return;
  }

  fs.mkdirSync(path.dirname(swPath), { recursive: true });
  fs.writeFileSync(swPath, SW_SNIPPET, 'utf8');
  console.log(`[videxpulse-sw] Created service worker at ${path.relative(projectRoot, swPath)}`);
}

function setupNextJsIntegration(projectRoot) {
  const baseSrc = fs.existsSync(path.join(projectRoot, 'src', 'app'))
    ? path.join(projectRoot, 'src')
    : fs.existsSync(path.join(projectRoot, 'app'))
      ? projectRoot
      : null;

  if (!baseSrc) {
    return;
  }

  const appDir = path.join(baseSrc, 'app');
  const layoutFile = ['layout.tsx', 'layout.jsx', 'layout.js']
    .map((name) => path.join(appDir, name))
    .find((file) => fs.existsSync(file));

  if (!layoutFile) {
    return;
  }

  const isTs = layoutFile.endsWith('.tsx');
  const tokenRoutePath = path.join(appDir, 'api', 'videxpulse', 'token', isTs ? 'route.ts' : 'route.js');
  if (!fs.existsSync(tokenRoutePath)) {
    fs.mkdirSync(path.dirname(tokenRoutePath), { recursive: true });
    fs.writeFileSync(tokenRoutePath, NEXT_TOKEN_ROUTE_TS, 'utf8');
    console.log(`[videxpulse-sw] Created Next.js token route at ${path.relative(projectRoot, tokenRoutePath)}`);
  }

  const compDir = path.join(baseSrc, 'components');
  const compPath = path.join(compDir, isTs ? 'VidexpulsePushInit.tsx' : 'VidexpulsePushInit.jsx');
  if (!fs.existsSync(compPath)) {
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(compPath, NEXT_PUSH_COMPONENT_TSX, 'utf8');
    console.log(`[videxpulse-sw] Created Next.js push component at ${path.relative(projectRoot, compPath)}`);
  }

  const layoutContent = fs.readFileSync(layoutFile, 'utf8');
  if (!layoutContent.includes('VidexpulsePushInit')) {
    const importLine = `import VidexpulsePushInit from '../components/VidexpulsePushInit';\n`;
    let updated = importLine + layoutContent;
    if (updated.includes('</body>')) {
      updated = updated.replace('</body>', '  <VidexpulsePushInit />\n      </body>');
    } else if (updated.includes('{children}')) {
      updated = updated.replace('{children}', '{children}\n        <VidexpulsePushInit />');
    }
    fs.writeFileSync(layoutFile, updated, 'utf8');
    console.log(`[videxpulse-sw] Wired <VidexpulsePushInit /> into ${path.relative(projectRoot, layoutFile)}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot();

  if (args.ifProject && (projectRoot === SDK_ROOT || projectRoot.startsWith(path.join(SDK_ROOT, path.sep)))) {
    return;
  }

  if (args.ifProject && !fs.existsSync(path.join(projectRoot, 'package.json'))) {
    return;
  }

  setupServiceWorker(projectRoot, args.target);
  setupNextJsIntegration(projectRoot);
}

try {
  main();
} catch (error) {
  console.warn('[videxpulse-sw] Could not auto-configure:', error?.message || error);
}
