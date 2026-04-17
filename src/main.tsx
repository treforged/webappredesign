import { createRoot } from 'react-dom/client';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { initialize } from 'launchdarkly-js-client-sdk';
import Observability from '@launchdarkly/observability';
import SessionReplay from '@launchdarkly/session-replay';
import App from './App.tsx';
import './index.css';

initialize(
  import.meta.env.VITE_LD_CLIENT_ID,
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

injectSpeedInsights();

createRoot(document.getElementById('root')!).render(<App />);
