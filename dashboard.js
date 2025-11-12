// Dashboard JavaScript
// Detect base path for API calls (handles nginx proxy with path prefix)
const getBasePath = () => {
  const pathname = window.location.pathname;
  // If pathname includes /ringba-sync-dashboard, use it as base path
  if (pathname.includes('/ringba-sync-dashboard')) {
    return '/ringba-sync-dashboard';
  }
  return '';
};

const BASE_PATH = getBasePath();
const API_BASE_URL = window.location.origin + BASE_PATH;

// Debug logging
console.log('[Dashboard] Base path:', BASE_PATH);
console.log('[Dashboard] API base URL:', API_BASE_URL);
console.log('[Dashboard] Current pathname:', window.location.pathname);

// State
let autoRefreshInterval = null;
let lastUpdateTime = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    initializeDashboard();
    setupEventListeners();
    startAutoRefresh();
});

// Initialize dashboard
function initializeDashboard() {
    console.log('Initializing dashboard...');
    loadAllData();
}

// Setup event listeners
function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadAllData();
    });

    // Service filter
    document.getElementById('serviceFilter').addEventListener('change', () => {
        loadHistory();
    });

    // History limit
    document.getElementById('historyLimit').addEventListener('change', () => {
        loadHistory();
    });

    // Activity tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
}

// Switch activity tab
function switchTab(tab) {
    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        }
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tab}Tab`).classList.add('active');

    // Load data for active tab
    if (tab === 'calls') {
        loadActivity();
    } else if (tab === 'adjustments') {
        loadActivity();
    } else if (tab === 'sessions') {
        loadActivity();
    }
}

// Load all data
async function loadAllData() {
    try {
        updateStatus('Loading...', 'warning');
        
        // Load all data in parallel
        await Promise.all([
            loadHealth(),
            loadStats(),
            loadHistory(),
            loadActivity(),
            loadTopCallers()
        ]);

        updateStatus('Healthy', 'healthy');
        updateLastUpdated();
    } catch (error) {
        console.error('Error loading data:', error);
        updateStatus('Error', 'error');
    }
}

// Load health status
async function loadHealth() {
    try {
        const url = `${API_BASE_URL}/api/health`;
        console.log('[Dashboard] Fetching health from:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        if (data.status === 'healthy') {
            // Update service statuses
            updateServiceStatus('historical', data.services.historical);
            updateServiceStatus('current', data.services.current);
            updateServiceStatus('ringba', data.services.ringba);

            // Update success rate
            const successRateElement = document.getElementById('successRate');
            if (successRateElement) {
                successRateElement.textContent = `${data.successRate}%`;
            }
        }
    } catch (error) {
        console.error('[Dashboard] Error loading health:', error);
        updateStatus('Error: ' + error.message, 'error');
    }
}

// Update service status
function updateServiceStatus(service, serviceData) {
    const statusElement = document.getElementById(`${service}Status`);
    const timeElement = document.getElementById(`${service}Time`);

    if (statusElement && timeElement) {
        const status = serviceData.status || serviceData.lastStatus || 'unknown';
        const lastRun = serviceData.lastRun || '-';

        statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusElement.className = `health-status ${getStatusClass(status)}`;

        if (lastRun && lastRun !== '-') {
            const date = new Date(lastRun);
            timeElement.textContent = formatRelativeTime(date);
        } else {
            timeElement.textContent = 'Never';
        }
    }
}

// Get status class
function getStatusClass(status) {
    if (status === 'completed' || status === 'success') {
        return 'success';
    } else if (status === 'failed' || status === 'error') {
        return 'error';
    } else if (status === 'running' || status === 'pending') {
        return 'warning';
    }
    return '';
}

// Load statistics
async function loadStats() {
    try {
        const url = `${API_BASE_URL}/api/stats`;
        console.log('[Dashboard] Fetching stats from:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        // Update stat cards
        updateElement('totalCalls', formatNumber(data.totalCalls));
        updateElement('totalPayout', formatCurrency(data.totalPayout));
        updateElement('totalAdjustments', formatNumber(data.totalAdjustments));
        updateElement('callsToday', formatNumber(data.callsToday));
        updateElement('callsThisWeek', formatNumber(data.callsThisWeek));

        // Update Ringba stats
        updateElement('ringbaTotal', formatNumber(data.ringba.total));
        updateElement('ringbaSuccess', formatNumber(data.ringba.success));
        updateElement('ringbaFailed', formatNumber(data.ringba.failed));
        updateElement('ringbaPending', formatNumber(data.ringba.pending));
        updateElement('ringbaSuccessRate', `${data.ringba.successRate}%`);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load history
async function loadHistory() {
    try {
        const serviceFilter = document.getElementById('serviceFilter').value;
        const limit = document.getElementById('historyLimit').value;

        const url = new URL(`${API_BASE_URL}/api/history`);
        if (serviceFilter) {
            url.searchParams.append('service', serviceFilter);
        }
        url.searchParams.append('limit', limit);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        const tbody = document.getElementById('historyTableBody');
        if (data.sessions && data.sessions.length > 0) {
            tbody.innerHTML = data.sessions.map(session => {
                // Use serviceType from API if available, otherwise derive from session_id
                const service = session.serviceType 
                    ? (session.serviceType === 'historical' ? 'Historical' : 'Current Day')
                    : getServiceName(session.session_id);
                const status = session.status || 'unknown';
                return `
                    <tr>
                        <td>${truncate(session.session_id, 30)}</td>
                        <td>${service}</td>
                        <td>${formatDateTime(session.started_at)}</td>
                        <td>${session.completed_at ? formatDateTime(session.completed_at) : '-'}</td>
                        <td><span class="status-badge ${status}">${status}</span></td>
                        <td>${formatNumber(session.calls_scraped || 0)}</td>
                        <td>${formatNumber(session.adjustments_scraped || 0)}</td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">No history found</td></tr>';
        }
    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('historyTableBody').innerHTML = 
            '<tr><td colspan="7" class="loading">Error loading history</td></tr>';
    }
}

// Load activity
async function loadActivity() {
    try {
        const url = `${API_BASE_URL}/api/activity?limit=20`;
        console.log('[Dashboard] Fetching activity from:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        // Update recent calls
        const callsBody = document.getElementById('recentCallsBody');
        if (data.calls && data.calls.length > 0) {
            callsBody.innerHTML = data.calls.map(call => `
                <tr>
                    <td>${formatDate(call.date_of_call)}</td>
                    <td>${call.caller_id || '-'}</td>
                    <td>${formatCurrency(call.payout || 0)}</td>
                    <td>${formatDateTime(call.created_at)}</td>
                </tr>
            `).join('');
        } else {
            callsBody.innerHTML = '<tr><td colspan="4" class="loading">No recent calls</td></tr>';
        }

        // Update recent adjustments
        const adjustmentsBody = document.getElementById('recentAdjustmentsBody');
        if (data.adjustments && data.adjustments.length > 0) {
            adjustmentsBody.innerHTML = data.adjustments.map(adj => `
                <tr>
                    <td>${formatDateTime(adj.time_of_call)}</td>
                    <td>${adj.caller_id || '-'}</td>
                    <td>${formatCurrency(adj.amount || 0)}</td>
                    <td>${formatDateTime(adj.created_at)}</td>
                </tr>
            `).join('');
        } else {
            adjustmentsBody.innerHTML = '<tr><td colspan="4" class="loading">No recent adjustments</td></tr>';
        }

        // Update recent sessions
        const sessionsBody = document.getElementById('recentSessionsBody');
        if (data.sessions && data.sessions.length > 0) {
            sessionsBody.innerHTML = data.sessions.map(session => `
                <tr>
                    <td>${truncate(session.session_id, 30)}</td>
                    <td><span class="status-badge ${session.status}">${session.status}</span></td>
                    <td>${formatDateTime(session.started_at)}</td>
                    <td>${formatNumber(session.calls_scraped || 0)}</td>
                    <td>${formatNumber(session.adjustments_scraped || 0)}</td>
                </tr>
            `).join('');
        } else {
            sessionsBody.innerHTML = '<tr><td colspan="5" class="loading">No recent sessions</td></tr>';
        }
    } catch (error) {
        console.error('Error loading activity:', error);
    }
}

// Load top callers
async function loadTopCallers() {
    try {
        const url = `${API_BASE_URL}/api/stats`;
        console.log('[Dashboard] Fetching stats (top callers) from:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        const tbody = document.getElementById('topCallersBody');
        if (data.topCallers && data.topCallers.length > 0) {
            tbody.innerHTML = data.topCallers.map((caller, index) => {
                const rank = index + 1;
                const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
                return `
                    <tr>
                        <td><span class="rank-badge ${rankClass}">${rank}</span></td>
                        <td>${caller.caller_id || '-'}</td>
                        <td>${formatNumber(caller.call_count || 0)}</td>
                        <td>${formatCurrency(caller.total_payout || 0)}</td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4" class="loading">No top callers found</td></tr>';
        }
    } catch (error) {
        console.error('Error loading top callers:', error);
    }
}

// Update status indicator
function updateStatus(status, type) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const statusDot = indicator.querySelector('.status-dot');

    statusText.textContent = status;
    statusDot.className = `status-dot ${type}`;
}

// Update element text
function updateElement(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
    }
}

// Update last updated time
function updateLastUpdated() {
    lastUpdateTime = new Date();
    const element = document.getElementById('lastUpdated');
    if (element) {
        element.textContent = formatDateTime(lastUpdateTime);
    }
}

// Start auto-refresh
function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    autoRefreshInterval = setInterval(() => {
        loadAllData();
    }, 30000); // Refresh every 30 seconds

    document.getElementById('autoRefreshStatus').textContent = 'Enabled (30s)';
}

// Stop auto-refresh
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    document.getElementById('autoRefreshStatus').textContent = 'Disabled';
}

// Utility functions
function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num || 0);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount || 0);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatRelativeTime(date) {
    if (!date) return '-';
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
        return 'Just now';
    }
}

function truncate(str, maxLength) {
    if (!str) return '-';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
}

function getServiceName(sessionId) {
    if (!sessionId) return 'Unknown';
    // Check if session_id starts with service type
    if (sessionId.startsWith('historical_')) return 'Historical';
    if (sessionId.startsWith('current_')) return 'Current Day';
    // Fallback: check if it contains the service type anywhere
    if (sessionId.includes('historical')) return 'Historical';
    if (sessionId.includes('current')) return 'Current Day';
    return 'Unknown';
}

