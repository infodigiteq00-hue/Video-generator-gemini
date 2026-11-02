import React from 'react';
import ReactDOM from 'react-dom/client';
import { Gate } from './Gate';
import { APP_NAME } from './config';
import './index.css';

document.title = APP_NAME;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate />
  </React.StrictMode>,
);

// Installable app (PWA). Only in production builds, so it never caches the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`));
}
