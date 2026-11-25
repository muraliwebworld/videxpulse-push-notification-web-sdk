export interface VidexpulseWebSdkConfig {
  baseUrl?: string;
  appId?: string;
  serviceWorkerUrl?: string;
  serviceWorkerScope?: string;
  vapidPublicKey?: string;
  publishToken?: string;
  publishTokenProvider?: (ctx: {
    appId: string;
    baseUrl: string;
    platform: 'web';
  }) => Promise<string> | string;
  headers?: Record<string, string>;
}

export interface VidexpulseRegisterOptions {
  subscription?: PushSubscription;
  deviceId?: string;
  userId?: string;
  endpointOrToken?: string;
  authMetadata?: Record<string, unknown>;
}

export interface VidexpulsePublishPayload {
  audienceType: 'broadcast' | 'user' | 'group';
  audienceValue?: string;
  title: string;
  body: string;
  imageUrl?: string;
  clickUrl?: string;
  customData?: Record<string, unknown>;
  scheduledFor?: string;
}

export interface VidexpulseWebSdk {
  initialize: (nextConfig?: VidexpulseWebSdkConfig) => VidexpulseWebSdkConfig;
  getConfig: () => VidexpulseWebSdkConfig;
  setPublishToken: (token: string) => string;
  getPublishToken: () => string;
  requestPermission: () => Promise<NotificationPermission>;
  ensureServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration>;
  getPushSubscription: () => Promise<PushSubscription | null>;
  ensurePushSubscription: () => Promise<PushSubscription>;
  registerDevice: (options?: VidexpulseRegisterOptions) => Promise<unknown>;
  refreshDevice: (options?: VidexpulseRegisterOptions) => Promise<unknown>;
  unsubscribeDevice: (options?: VidexpulseRegisterOptions) => Promise<unknown>;
  publishNotification: (payload?: VidexpulsePublishPayload) => Promise<unknown>;
  sendNotification: (payload?: VidexpulsePublishPayload) => Promise<unknown>;
  subscribe: (options?: VidexpulseRegisterOptions) => Promise<unknown>;
  refresh: (options?: VidexpulseRegisterOptions) => Promise<unknown>;
  unsubscribe: (options?: VidexpulseRegisterOptions) => Promise<unknown>;
}

export interface VidexpulsePromptConfig {
  iconMode?: 'bell' | 'custom';
  iconDataUrl?: string;
  bellPosition?: 'bottom-right' | 'bottom-left';
  bellBehavior?: 'auto-hide' | 'always';
  bellAccentColor?: string;
  bellCustomCss?: string;
  customPromptEnabled?: boolean;
  promptText?: string;
  allowButtonText?: string;
  allowButtonColor?: string;
  cancelButtonText?: string;
  cancelButtonColor?: string;
}

export interface VidexpulsePromptOptions {
  tokenEndpoint?: string;
  userId?: string;
  serviceWorkerUrl?: string;
  buttonText?: string;
  promptConfig?: VidexpulsePromptConfig;
}

export function createVidexpulseWebSdk(initialConfig?: VidexpulseWebSdkConfig): VidexpulseWebSdk;
export function urlBase64ToUint8Array(base64String: string): Uint8Array;
export function mountVidexpulsePrompt(options?: VidexpulsePromptOptions): Promise<void>;
