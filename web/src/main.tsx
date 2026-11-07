import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import { DataProvider } from './lib/data';
import { readTheme } from './components/Layout';
import './styles.css';

// apply the saved theme before the first paint, so light mode never flashes dark
document.documentElement.dataset.theme = readTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <DataProvider>
        <App />
      </DataProvider>
    </I18nProvider>
  </StrictMode>,
);
