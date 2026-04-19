import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.tsx';
import './index.css';

// Mount React immediately — nothing blocks it
createRoot(document.getElementById('root')!).render(<App />);

// Analytics only on web, loaded async so they can never block or crash the app
if (!Capacitor.isNativePlatform()) {
  import('@vercel/speed-insights').then(m => m.injectSpeedInsights()).catch(() => {});

  const ldClientId = import.meta.env.VITE_LD_CLIENT_ID;
  if (ldClientId) {
    Promise.all([
      import('@launchdarkly/js-client-sdk'),
      import('@launchdarkly/observability'),
      import('@launchdarkly/session-replay'),
    ]).then(([{ createClient }, { default: Observability }, { default: SessionReplay }]) => {
      try {
        createClient(
          ldClientId,
          { kind: 'user', anonymous: true },
          {
            plugins: [
              new Observability({
                networkRecording: { enabled: true, recordHeadersAndBody: true },
                serviceName: 'forged-web',
              }),
              new SessionReplay({
                privacySetting: 'strict',
                serviceName: 'forged-web',
              }),
            ],
          }
        );
      } catch (_e) {}
    }).catch(() => {});
  }
}
