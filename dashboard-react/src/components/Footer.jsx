import React from 'react';
import { formatDateTime } from '../utils/formatters';

const Footer = ({ lastUpdated }) => {
  return (
    <footer className="dashboard-footer">
      <p>Last updated: <span>{lastUpdated ? formatDateTime(lastUpdated) : '-'}</span></p>
      <p>Auto-refresh: <span>Enabled (30s)</span></p>
    </footer>
  );
};

export default Footer;

