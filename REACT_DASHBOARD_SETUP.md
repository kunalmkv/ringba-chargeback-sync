# React Dashboard Setup Guide

## Overview

The dashboard has been converted from plain HTML/CSS/JS to a React application using Vite.

## Project Structure

```
dashboard-react/
├── src/
│   ├── components/      # React components
│   │   ├── Header.jsx
│   │   ├── HealthStatus.jsx
│   │   ├── Statistics.jsx
│   │   ├── RingbaStatus.jsx
│   │   ├── ServiceHistory.jsx
│   │   ├── RecentActivity.jsx
│   │   ├── TopCallers.jsx
│   │   └── Footer.jsx
│   ├── hooks/          # Custom React hooks
│   │   └── useDashboardData.js
│   ├── utils/          # Utility functions
│   │   ├── api.js
│   │   └── formatters.js
│   ├── App.jsx         # Main app component
│   ├── main.jsx        # Entry point
│   └── index.css       # Styles
├── index.html          # HTML template
├── vite.config.js      # Vite configuration
└── package.json        # Dependencies
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd dashboard-react
npm install
```

### 2. Build for Production

```bash
npm run build
```

Or from project root:
```bash
npm run dashboard:build
```

This will:
- Install React dependencies
- Build the React app
- Output to `../dashboard-build/`

### 3. Start Dashboard Server

```bash
npm run dashboard
```

The server will automatically:
- Serve React build from `dashboard-build/` if it exists
- Fall back to old HTML version if build doesn't exist

## Development Mode

For development with hot reload:

```bash
cd dashboard-react
npm run dev
```

Or from project root:
```bash
npm run dashboard:dev
```

This starts Vite dev server on `http://localhost:5173`

## Features

✅ All original functionality preserved
✅ Component-based architecture
✅ Custom hooks for data management
✅ Auto-refresh every 30 seconds
✅ Error handling and loading states
✅ Responsive design
✅ Same styling as original
✅ Works with nginx proxy path prefix

## Components

- **Header**: Dashboard header with refresh button and status indicator
- **HealthStatus**: Service health monitoring cards
- **Statistics**: Overview statistics cards
- **RingbaStatus**: Ringba sync status display
- **ServiceHistory**: Service execution history with filtering
- **RecentActivity**: Recent calls, adjustments, and sessions with tabs
- **TopCallers**: Top 10 callers by call count
- **Footer**: Footer with last updated timestamp

## API Integration

The dashboard uses the same API endpoints:
- `/api/health` - Service health status
- `/api/stats` - Statistics overview
- `/api/history` - Service history
- `/api/activity` - Recent activity
- `/api/ringba-logs` - Ringba sync logs

## Deployment

1. Build the React app: `npm run dashboard:build`
2. Start the server: `npm run dashboard`
3. Access at: `http://your-domain/ringba-sync-dashboard/`

The server automatically serves the React build if available, otherwise falls back to the old HTML version.
