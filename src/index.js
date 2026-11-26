const DEFAULT_CONFIG = {
  baseUrl: '',
  appId: '',
  serviceWorkerUrl: '/push-sw.js',
  serviceWorkerScope: '/',
  vapidPublicKey: '',
  publishToken: '',
  publishTokenProvider: null,
  headers: {}
};

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeBaseUrl(value) {
  return normalizeText(value).replace(/\/+$/, '');
}

function requireBrowserApi(name, condition) {
  if (!condition) {
    throw new Error(`Videxpulse web SDK requires ${name}.`);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const normalized = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = globalThis.atob(normalized);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function createJsonHeaders(extraHeaders = {}) {
  return {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
}

function getSubscriptionPayload(subscription) {
  if (!subscription) {
    return null;
  }

  if (typeof subscription.toJSON === 'function') {
    return subscription.toJSON();
  }

  return {
    endpoint: subscription.endpoint || '',
    keys: subscription.keys || {},
    expirationTime: subscription.expirationTime || null
  };
}

function createVidexpulseWebSdk(initialConfig = {}) {
  let config = {
    ...DEFAULT_CONFIG,
    ...initialConfig,
    baseUrl: normalizeBaseUrl(initialConfig.baseUrl)
  };

  let publishToken = normalizeText(initialConfig.publishToken);

  function updateConfig(nextConfig = {}) {
    config = {
      ...config,
      ...nextConfig,
      baseUrl: normalizeBaseUrl(nextConfig.baseUrl ?? config.baseUrl)
    };

    if (nextConfig.publishToken !== undefined) {
      publishToken = normalizeText(nextConfig.publishToken);
    }

    return getConfig();
  }

  async function resolvePublishToken() {
    if (typeof config.publishTokenProvider === 'function') {
      const nextToken = await config.publishTokenProvider({
        appId: config.appId,
        baseUrl: config.baseUrl,
        platform: 'web'
      });

      if (nextToken) {
        publishToken = normalizeText(nextToken);
      }
    }

    if (!publishToken) {
      throw new Error('Videxpulse web SDK requires a publish token.');
    }

    return publishToken;
  }

  async function authorizedFetch(path, options = {}) {
    const token = await resolvePublishToken();
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: createJsonHeaders({
        ...(config.headers || {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      })
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : { error: await response.text() };

    if (!response.ok) {
      throw new Error(payload?.error || 'Videxpulse SDK request failed.');
    }

    return payload;
  }

  async function ensureNotificationPermission() {
    requireBrowserApi('the Notification API', typeof globalThis.Notification !== 'undefined');

    if (globalThis.Notification.permission === 'granted') {
      return 'granted';
    }

    if (globalThis.Notification.permission === 'denied') {
      return 'denied';
    }

    return globalThis.Notification.requestPermission();
  }

  async function ensureServiceWorkerRegistration() {
    requireBrowserApi('service workers', typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
    return navigator.serviceWorker.register(config.serviceWorkerUrl, { scope: config.serviceWorkerScope });
  }

  async function getPushSubscription() {
    const registration = await ensureServiceWorkerRegistration();

    if (!registration.pushManager) {
      throw new Error('PushManager is not available in this browser.');
    }

    return registration.pushManager.getSubscription();
  }

  async function ensurePushSubscription() {
    const permission = await ensureNotificationPermission();

    if (permission !== 'granted') {
      throw new Error('Notification permission was not granted.');
    }

    const registration = await ensureServiceWorkerRegistration();
    const existing = await registration.pushManager.getSubscription();

    if (existing) {
      return existing;
    }

    if (!config.vapidPublicKey) {
      const envVapid =
        globalThis?.process?.env?.VIDEXPULSE_VAPID_PUBLIC_KEY ||
        globalThis?.process?.env?.NEXT_PUBLIC_VIDEXPULSE_VAPID_PUBLIC_KEY ||
        globalThis?.process?.env?.VITE_VIDEXPULSE_VAPID_PUBLIC_KEY ||
        globalThis?.VIDEXPULSE_VAPID_PUBLIC_KEY ||
        '';
      if (envVapid) {
        config.vapidPublicKey = normalizeText(envVapid);
      } else if (config.baseUrl && config.appId) {
        const sdkCfg = await authorizedFetch(`/api/sdk/config?appId=${encodeURIComponent(config.appId)}`, {
          method: 'GET'
        });
        if (sdkCfg?.vapidPublicKey) {
          config.vapidPublicKey = normalizeText(sdkCfg.vapidPublicKey);
        }
      }
    }

    if (!config.vapidPublicKey) {
      throw new Error('A VAPID public key is required (pass via env or configure it in Videxpulse Settings).');
    }

    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
    });
  }

  async function registerDevice(options = {}) {
    const subscription = options.subscription || await ensurePushSubscription();
    const subscriptionPayload = getSubscriptionPayload(subscription);

    return authorizedFetch('/api/devices/register', {
      method: 'POST',
      body: JSON.stringify({
        appId: config.appId,
        platform: 'web',
        provider: 'webpush',
        deviceId: options.deviceId || '',
        userId: options.userId || '',
        endpointOrToken: options.endpointOrToken || subscriptionPayload?.endpoint || subscription.endpoint || '',
        authMetadata: options.authMetadata || subscriptionPayload?.keys || {},
        subscription: subscriptionPayload
      })
    });
  }

  async function refreshDevice(options = {}) {
    const subscription = options.subscription || await getPushSubscription();

    if (!subscription) {
      return registerDevice(options);
    }

    return registerDevice({
      ...options,
      subscription
    });
  }

  async function unsubscribeDevice(options = {}) {
    let subscription = options.subscription || await getPushSubscription();

    if (subscription && typeof subscription.unsubscribe === 'function') {
      await subscription.unsubscribe();
    }

    const subscriptionPayload = getSubscriptionPayload(subscription);

    return authorizedFetch('/api/devices/unregister', {
      method: 'POST',
      body: JSON.stringify({
        appId: config.appId,
        deviceId: options.deviceId || '',
        endpointOrToken: options.endpointOrToken || subscriptionPayload?.endpoint || '',
        status: 'unsubscribed'
      })
    });
  }

  async function publishNotification(payload = {}) {
    return authorizedFetch('/api/notifications', {
      method: 'POST',
      body: JSON.stringify({
        appId: config.appId,
        ...payload
      })
    });
  }

  async function fetchSdkConfig() {
    if (!config.baseUrl || !config.appId) {
      return null;
    }
    return authorizedFetch(`/api/sdk/config?appId=${encodeURIComponent(config.appId)}`, {
      method: 'GET'
    });
  }

  return {
    initialize: updateConfig,
    getConfig,
    fetchSdkConfig,
    setPublishToken(token) {
      publishToken = normalizeText(token);
      return publishToken;
    },
    getPublishToken() {
      return publishToken;
    },
    requestPermission: ensureNotificationPermission,
    ensureServiceWorkerRegistration,
    getPushSubscription,
    ensurePushSubscription,
    registerDevice,
    refreshDevice,
    unsubscribeDevice,
    publishNotification,
    sendNotification: publishNotification,
    subscribe: registerDevice,
    refresh: refreshDevice,
    unsubscribe: unsubscribeDevice
  };

  function getConfig() {
    return {
      ...config,
      publishToken: publishToken ? '[set]' : ''
    };
  }
}

const DEFAULT_BELL_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const DISMISS_STORAGE_KEY = 'videxpulse_prompt_dismissed_until';

function renderBellVisual(promptCfg) {
  if (promptCfg.iconMode === 'custom' && promptCfg.iconDataUrl) {
    const img = document.createElement('img');
    img.src = promptCfg.iconDataUrl;
    img.alt = 'Notifications';
    Object.assign(img.style, {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      objectFit: 'cover',
      display: 'block'
    });
    return img;
  }
  const wrap = document.createElement('span');
  wrap.innerHTML = DEFAULT_BELL_SVG;
  Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
  return wrap;
}

async function mountVidexpulsePrompt(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return;
  }

  const tokenEndpoint = options.tokenEndpoint || '/api/videxpulse/token';
  const userId = options.userId || '';
  const serviceWorkerUrl = options.serviceWorkerUrl || '/push-sw.js';

  let sdk = null;
  let promptCfg = {
    iconMode: 'bell',
    iconDataUrl: '',
    bellPosition: 'bottom-right',
    bellBehavior: 'auto-hide',
    bellAccentColor: '#e14d43',
    bellCustomCss: '',
    customPromptEnabled: true,
    promptText: 'We would like to show you notifications for the latest news and updates.',
    allowButtonText: 'Allow',
    allowButtonColor: '#1677ff',
    cancelButtonText: 'Cancel',
    cancelButtonColor: '#64748b',
    ...(options.promptConfig || {})
  };

  async function ensureSdkReady() {
    if (sdk) return sdk;
    const res = await fetch(tokenEndpoint, { cache: 'no-store' });
    if (!res.ok) return null;
    const cfg = await res.json();
    if (!cfg?.baseUrl || !cfg?.appId || !cfg?.publishToken) {
      return null;
    }

    sdk = createVidexpulseWebSdk({
      baseUrl: cfg.baseUrl,
      appId: cfg.appId,
      vapidPublicKey: cfg.vapidPublicKey || '',
      serviceWorkerUrl,
      publishToken: cfg.publishToken
    });

    if (!cfg.vapidPublicKey || !options.promptConfig) {
      try {
        const remote = await sdk.fetchSdkConfig();
        if (remote?.pushEnabled === false || (remote?.webpushEnabled === false && !remote?.firebaseEnabled)) {
          return null;
        }
        if (remote?.vapidPublicKey) {
          sdk.initialize({ vapidPublicKey: remote.vapidPublicKey });
        }
        if (remote?.promptConfig && !options.promptConfig) {
          promptCfg = { ...promptCfg, ...remote.promptConfig };
        }
      } catch (e) {
        // Fallback to defaults if config fetch fails
      }
    }
    return sdk;
  }

  const readySdk = await ensureSdkReady();
  if (!readySdk) {
    return;
  }

  let isSubscribed = false;
  try {
    const existingSub = Notification.permission === 'granted' ? await readySdk.getPushSubscription() : null;
    isSubscribed = Boolean(existingSub);
  } catch (e) {
    isSubscribed = false;
  }

  // If already subscribed and behavior is auto-hide, do not show bell
  if (isSubscribed && promptCfg.bellBehavior !== 'always') {
    return;
  }

  const existingBell = document.getElementById('videxpulse-bell-root');
  if (existingBell) {
    return;
  }

  // Build floating bell button
  const bellRoot = document.createElement('div');
  bellRoot.id = 'videxpulse-bell-root';
  const isLeft = promptCfg.bellPosition === 'bottom-left';
  Object.assign(bellRoot.style, {
    position: 'fixed',
    bottom: '20px',
    [isLeft ? 'left' : 'right']: '20px',
    zIndex: '9998',
    display: 'flex',
    flexDirection: 'column',
    alignItems: isLeft ? 'flex-start' : 'flex-end',
    gap: '10px',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  });

  const bellBtn = document.createElement('button');
  bellBtn.id = 'videxpulse-optin-btn';
  bellBtn.type = 'button';
  bellBtn.title = isSubscribed ? 'Manage notifications' : 'Enable notifications';
  bellBtn.setAttribute('aria-label', bellBtn.title);
  Object.assign(bellBtn.style, {
    width: '48px',
    height: '48px',
    borderRadius: '999px',
    border: 'none',
    background: promptCfg.bellAccentColor || '#e14d43',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.25)',
    transition: 'transform 0.15s ease, opacity 0.25s ease'
  });
  if (promptCfg.bellCustomCss) {
    bellBtn.style.cssText += `;${promptCfg.bellCustomCss}`;
  }
  bellBtn.appendChild(renderBellVisual(promptCfg));
  bellRoot.appendChild(bellBtn);
  document.body.appendChild(bellRoot);

  function removePromptModal() {
    document.getElementById('videxpulse-slide-prompt')?.remove();
  }

  function showSubscribedBadgeAndHide() {
    removePromptModal();
    if (promptCfg.bellBehavior === 'always') {
      return;
    }
    bellBtn.innerHTML = '';
    bellBtn.textContent = 'Subscribed ✓';
    Object.assign(bellBtn.style, {
      width: 'auto',
      padding: '0 14px',
      fontSize: '13px',
      fontWeight: '600',
      background: '#16a34a'
    });
    setTimeout(() => {
      bellRoot.style.opacity = '0';
      setTimeout(() => bellRoot.remove(), 300);
    }, 1800);
  }

  let popoverEl = null;
  function togglePopover() {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
      return;
    }
    popoverEl = document.createElement('div');
    Object.assign(popoverEl.style, {
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '14px',
      width: '250px',
      boxShadow: '0 14px 36px rgba(15, 23, 42, 0.18)',
      color: '#0f172a',
      fontSize: '13px'
    });

    const isBlocked = Notification.permission === 'denied';
    const statusLine = document.createElement('div');
    statusLine.style.fontWeight = '600';
    statusLine.style.marginBottom = '4px';
    statusLine.textContent = isBlocked
      ? 'Notifications blocked'
      : isSubscribed
        ? 'Subscribed to notifications'
        : 'Get push notifications';

    const subText = document.createElement('div');
    subText.style.fontSize = '12px';
    subText.style.color = isBlocked ? '#dc2626' : '#64748b';
    subText.style.marginBottom = isBlocked ? '0' : '10px';
    subText.textContent = isBlocked
      ? 'Notification is blocked in browser settings. Reset the browser settings for this site and reload.'
      : isSubscribed
        ? 'You are receiving push updates from this site.'
        : 'Click below to subscribe for updates.';

    popoverEl.appendChild(statusLine);
    popoverEl.appendChild(subText);

    if (!isBlocked) {
      const errorText = document.createElement('div');
      errorText.style.fontSize = '11px';
      errorText.style.color = '#dc2626';
      errorText.style.marginTop = '6px';
      errorText.style.display = 'none';

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.textContent = isSubscribed ? 'Unsubscribe' : (promptCfg.allowButtonText || 'Subscribe');
      Object.assign(actionBtn.style, {
        width: '100%',
        padding: '8px 12px',
        borderRadius: '8px',
        border: 'none',
        background: isSubscribed ? '#ef4444' : (promptCfg.allowButtonColor || '#1677ff'),
        color: '#ffffff',
        fontWeight: '600',
        cursor: 'pointer'
      });

      actionBtn.addEventListener('click', async () => {
        if (!isSubscribed && promptCfg.customPromptEnabled !== false) {
          popoverEl?.remove();
          popoverEl = null;
          showCustomSlidePrompt(true);
          return;
        }

        actionBtn.disabled = true;
        errorText.style.display = 'none';
        actionBtn.textContent = isSubscribed ? 'Unsubscribing...' : 'Subscribing...';
        try {
          if (isSubscribed) {
            await readySdk.unsubscribeDevice();
            isSubscribed = false;
            bellBtn.title = 'Enable notifications';
            bellBtn.setAttribute('aria-label', 'Enable notifications');
          } else {
            await readySdk.subscribe({ userId });
            isSubscribed = true;
            bellBtn.title = 'Manage notifications';
            bellBtn.setAttribute('aria-label', 'Manage notifications');
          }
          popoverEl?.remove();
          popoverEl = null;
          if (isSubscribed && promptCfg.bellBehavior !== 'always') {
            showSubscribedBadgeAndHide();
          }
        } catch (e) {
          actionBtn.disabled = false;
          actionBtn.textContent = isSubscribed ? 'Unsubscribe' : (promptCfg.allowButtonText || 'Subscribe');
          errorText.textContent = e?.message || 'Subscription failed.';
          errorText.style.display = 'block';
        }
      });

      popoverEl.appendChild(actionBtn);
      popoverEl.appendChild(errorText);
    }

    bellRoot.insertBefore(popoverEl, bellBtn);
  }

  bellBtn.addEventListener('click', () => {
    removePromptModal();
    togglePopover();
  });

  function showCustomSlidePrompt(forceShow = false) {
    if (document.getElementById('videxpulse-slide-prompt')) {
      return;
    }
    if (Notification.permission === 'denied') {
      return;
    }
    const dismissedUntil = Number(localStorage.getItem(DISMISS_STORAGE_KEY) || 0);
    if (!forceShow && Date.now() <= dismissedUntil) {
      return;
    }

    const promptBox = document.createElement('div');
    promptBox.id = 'videxpulse-slide-prompt';
    Object.assign(promptBox.style, {
      position: 'fixed',
      top: '16px',
      left: '16px',
      zIndex: '9999',
      maxWidth: '380px',
      width: 'calc(100vw - 32px)',
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '16px',
      boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      color: '#1e293b'
    });

    const topRow = document.createElement('div');
    Object.assign(topRow.style, { display: 'flex', alignItems: 'flex-start', gap: '12px' });

    const iconCircle = document.createElement('div');
    Object.assign(iconCircle.style, {
      width: '40px',
      height: '40px',
      borderRadius: '999px',
      background: promptCfg.bellAccentColor || '#e14d43',
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0'
    });
    iconCircle.appendChild(renderBellVisual(promptCfg));

    const textEl = document.createElement('div');
    textEl.style.fontSize = '14px';
    textEl.style.lineHeight = '1.45';
    textEl.textContent = promptCfg.promptText;

    topRow.appendChild(iconCircle);
    topRow.appendChild(textEl);

    const promptErr = document.createElement('div');
    promptErr.style.fontSize = '12px';
    promptErr.style.color = '#dc2626';
    promptErr.style.display = 'none';

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', justifyContent: 'flex-end', gap: '10px' });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = promptCfg.cancelButtonText || 'Cancel';
    Object.assign(cancelBtn.style, {
      padding: '8px 14px',
      borderRadius: '8px',
      border: 'none',
      background: 'transparent',
      color: promptCfg.cancelButtonColor || '#64748b',
      fontWeight: '600',
      fontSize: '13px',
      cursor: 'pointer'
    });

    const allowBtn = document.createElement('button');
    allowBtn.type = 'button';
    allowBtn.textContent = promptCfg.allowButtonText || 'Allow';
    Object.assign(allowBtn.style, {
      padding: '8px 18px',
      borderRadius: '8px',
      border: 'none',
      background: promptCfg.allowButtonColor || '#1677ff',
      color: '#ffffff',
      fontWeight: '600',
      fontSize: '13px',
      cursor: 'pointer'
    });

    cancelBtn.addEventListener('click', () => {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
      promptBox.remove();
    });

    allowBtn.addEventListener('click', async () => {
      allowBtn.disabled = true;
      allowBtn.textContent = 'Subscribing...';
      promptErr.style.display = 'none';
      try {
        await readySdk.subscribe({ userId });
        isSubscribed = true;
        bellBtn.title = 'Manage notifications';
        bellBtn.setAttribute('aria-label', 'Manage notifications');
        showSubscribedBadgeAndHide();
      } catch (e) {
        if (Notification.permission === 'denied') {
          promptErr.textContent = 'Notification is blocked in browser settings. Reset the browser settings for this site.';
          promptErr.style.display = 'block';
          allowBtn.disabled = false;
          allowBtn.textContent = promptCfg.allowButtonText || 'Allow';
        } else {
          promptErr.textContent = e?.message || 'Subscription failed.';
          promptErr.style.display = 'block';
          allowBtn.disabled = false;
          allowBtn.textContent = promptCfg.allowButtonText || 'Allow';
        }
      }
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(allowBtn);
    promptBox.appendChild(topRow);
    promptBox.appendChild(promptErr);
    promptBox.appendChild(btnRow);
    document.body.appendChild(promptBox);
  }

  // Show PNFPB-style custom slide prompt when unsubscribed & permission is not blocked
  if (promptCfg.customPromptEnabled !== false && !isSubscribed) {
    showCustomSlidePrompt(false);
  }
}

export { createVidexpulseWebSdk, urlBase64ToUint8Array, mountVidexpulsePrompt };
