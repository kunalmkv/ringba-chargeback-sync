# eLocal Dashboard - React Version

React-based dashboard for monitoring eLocal scraper services.

## Setup

1. Install dependencies:
```bash
cd dashboard-react
npm install
```

2. Development mode:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

The build output will be in `../dashboard-build/`

## Structure

```
dashboard-react/
├── src/
│   ├── components/      # React components
│   ├── hooks/          # Custom React hooks
│   ├── utils/          # Utility functions
│   ├── App.jsx         # Main app component
│   ├── main.jsx        # Entry point
│   └── index.css       # Styles
├── index.html          # HTML template
├── vite.config.js      # Vite configuration
└── package.json        # Dependencies
```

## Components

- **Header**: Dashboard header with refresh button and status
- **HealthStatus**: Service health monitoring cards
- **Statistics**: Overview statistics cards
- **RingbaStatus**: Ringba sync status
- **ServiceHistory**: Service execution history table
- **RecentActivity**: Recent calls, adjustments, and sessions
- **TopCallers**: Top 10 callers by count

## Features

- ✅ Real-time data updates (auto-refresh every 30s)
- ✅ Service health monitoring
- ✅ Statistics overview
- ✅ Service history with filtering
- ✅ Recent activity tracking
- ✅ Top callers ranking
- ✅ Responsive design
- ✅ Error handling
- ✅ Loading states

## API Integration

The dashboard uses the same API endpoints as the original:
- `/api/health` - Service health status
- `/api/stats` - Statistics overview
- `/api/history` - Service history
- `/api/activity` - Recent activity
- `/api/ringba-logs` - Ringba sync logs

## Deployment

After building, the `dashboard-build` folder will be served by `dashboard-server.js`.

