import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-600.css';
import '@fontsource/open-sans/latin-700.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './style.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
