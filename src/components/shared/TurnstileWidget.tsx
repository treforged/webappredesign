import { useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    _forgentaTurnstileLoad?: () => void;
  }
}

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact' | 'flexible';
}

interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  resetKey?: number;
}

const SCRIPT_ID = 'cf-turnstile-script';

export function TurnstileWidget({ onToken, onError, onExpire, resetKey }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile) return;
    if (widgetId.current) {
      try { window.turnstile.remove(widgetId.current); } catch { /* ignore */ }
      widgetId.current = null;
    }
    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
      callback: onToken,
      'error-callback': onError,
      'expired-callback': onExpire,
      theme: 'dark',
      size: 'normal',
    });
  }, [onToken, onError, onExpire]);

  useEffect(() => {
    if (window.turnstile) {
      renderWidget();
      return () => {
        if (widgetId.current && window.turnstile) {
          try { window.turnstile.remove(widgetId.current); } catch { /* ignore */ }
          widgetId.current = null;
        }
      };
    }

    window._forgentaTurnstileLoad = renderWidget;

    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_forgentaTurnstileLoad&render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* ignore */ }
        widgetId.current = null;
      }
    };
  }, [renderWidget, resetKey]);

  return <div ref={containerRef} className="flex justify-center" />;
}
