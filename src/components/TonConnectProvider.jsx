import React, { useEffect, useState } from 'react';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { config } from '../config';

export function TonConnectProvider({ children }) {
  const [manifestUrl, setManifestUrl] = useState(null);

  useEffect(() => {
    // Создаем manifest URL динамически
    const createManifestBlob = () => {
      const manifest = config.manifest;
      const blob = new Blob([JSON.stringify(manifest, null, 2)], {
        type: 'application/json'
      });
      return URL.createObjectURL(blob);
    };

    // Используем статический файл если домен не localhost, иначе blob
    if (config.appDomain.includes('localhost')) {
      setManifestUrl(createManifestBlob());
    } else {
      setManifestUrl(config.manifestUrl);
    }
  }, []);

  if (!manifestUrl) {
    return <div>Loading TON Connect...</div>;
  }

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      {children}
    </TonConnectUIProvider>
  );
}
