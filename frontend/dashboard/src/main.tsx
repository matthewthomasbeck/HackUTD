import React from 'react';
import ReactDOM from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import App from './App';
import { dashboardConfigFromSearch } from './stdb/connection';
import { createConnectionBuilder } from './stdb/builder';
import { LiveSource } from './data/LiveSource';
import { ReplaySource } from './data/ReplaySource';
import './styles/app.css';
import './styles/board.css';

const config = dashboardConfigFromSearch(window.location.search, import.meta.env);
document.documentElement.dataset.theme = config.theme;
const builder = createConnectionBuilder(config);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpacetimeDBProvider connectionBuilder={builder}>
      <LiveSource config={config}>
        <ReplaySource config={config}>
          <App config={config} />
        </ReplaySource>
      </LiveSource>
    </SpacetimeDBProvider>
  </React.StrictMode>,
);
