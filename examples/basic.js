import { createVidexpulseWebSdk } from '../src/index.js';

const statusElement = document.getElementById('status');
const registerButton = document.getElementById('register-button');
const sendButton = document.getElementById('send-button');
const unsubscribeButton = document.getElementById('unsubscribe-button');

const sdk = createVidexpulseWebSdk({
  baseUrl: window.location.origin,
  appId: 'app_123',
  // vapidPublicKey is automatically fetched from /api/sdk/config or read from env if omitted
  serviceWorkerUrl: './push-sw.js',
  publishTokenProvider: async () => {
    const response = await fetch('/api/sdk/publish-token');
    const payload = await response.json();
    return payload.publishToken;
  }
});

function setStatus(message) {
  statusElement.textContent = message;
}

registerButton.addEventListener('click', async () => {
  try {
    await sdk.initialize();
    const result = await sdk.registerDevice({ userId: 'user_123' });
    setStatus(`Registered device ${result.device.id}`);
  } catch (error) {
    setStatus(error.message);
  }
});

sendButton.addEventListener('click', async () => {
  try {
    await sdk.publishNotification({
      audienceType: 'broadcast',
      audienceValue: '',
      title: 'Browser SDK test',
      body: 'This notification was published from the Videxpulse web SDK.',
      clickUrl: window.location.origin
    });
    setStatus('Notification sent.');
  } catch (error) {
    setStatus(error.message);
  }
});

unsubscribeButton.addEventListener('click', async () => {
  try {
    await sdk.unsubscribeDevice();
    setStatus('Subscription removed.');
  } catch (error) {
    setStatus(error.message);
  }
});