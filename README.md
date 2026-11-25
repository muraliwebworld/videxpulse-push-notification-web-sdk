# Videxpulse Web SDK

Browser-first SDK for registering push subscriptions and publishing notifications with a short-lived Videxpulse publish token.

## Installation from GitHub

Install directly from the public GitHub repository:

```bash
npm install git+https://github.com/muraliwebworld/videxpulse-push-notification-web-sdk.git
```

Or via HTTPS tarball (works in Docker/Alpine without `git`):

```bash
npm install https://github.com/muraliwebworld/videxpulse-push-notification-web-sdk/archive/refs/heads/main.tar.gz
```

On install, the package automatically runs `videxpulse-sw-init`:
- Detects your project's public root (`public/`, `static/`, `www/`, or project root) and creates or appends `push-sw.js` / `sw.js`.
- For **Next.js App Router** projects (`app/layout.tsx` or `src/app/layout.tsx`), it also automatically creates:
  - `api/videxpulse/token/route.ts` (reads `VIDEXPULSE_URL`, `VIDEXPULSE_APP_ID`, `VIDEXPULSE_API_KEY`, `VIDEXPULSE_SECRET_KEY` from runtime env)
  - `components/VidexpulsePushInit.tsx` and wires `<VidexpulsePushInit />` into `layout.tsx`.

You only need to set these 4 environment variables on your Next.js app (no manual code changes required):
- `VIDEXPULSE_URL` (e.g. `https://videxpulse.cloud`)
- `VIDEXPULSE_APP_ID`
- `VIDEXPULSE_API_KEY`
- `VIDEXPULSE_SECRET_KEY`

You can also run it manually at any time:

```bash
npx videxpulse-sw-init
# or target a specific file:
npx videxpulse-sw-init --target custom-sw.js
```

## What it does

- Requests browser notification permission.
- Registers or refreshes a web push subscription.
- Unsubscribes a browser subscription.
- Publishes notifications using a bearer publish token.
- Keeps topic APIs out of the web surface.

## Contract

- `apiKey` identifies the app.
- `publishToken` authorizes register, refresh, unsubscribe, and publish calls.
- Tokens expire after 120 minutes.
- Token minting happens server-side through `POST /api/apps/:id/sdk-token`.
- Do not expose the app secret key in browser code.

## Recommended initialization

```js
import { createVidexpulseWebSdk } from './src/index.js';

const sdk = createVidexpulseWebSdk({
  baseUrl: 'https://example.com',
  appId: 'app_123',
  // Optional: pass from env (VITE_VIDEXPULSE_VAPID_PUBLIC_KEY / NEXT_PUBLIC_VIDEXPULSE_VAPID_PUBLIC_KEY)
  // If omitted, the SDK automatically fetches vapidPublicKey from /api/sdk/config
  serviceWorkerUrl: '/push-sw.js',
  publishTokenProvider: async () => {
    const response = await fetch('/api/sdk/publish-token');
    const payload = await response.json();
    return payload.publishToken;
  }
});

await sdk.initialize();
await sdk.registerDevice({ userId: 'user_123' });
```

## Files

- `src/index.js` - main browser SDK entry point.
- `examples/basic.html` - example integration page.
- `examples/basic.js` - example browser app code.
- `examples/push-sw.js` - example service worker.