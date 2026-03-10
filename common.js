// --- Runtime App Configuration ---
const DEFAULT_APP_CONFIG = {
    API_BASE_URL: 'https://ivktwzvx88.execute-api.ap-south-1.amazonaws.com',
    AWS_REGION: 'ap-south-1',
    COGNITO_APP_CLIENT_ID: ''
};

function getAppConfig() {
    let stored = {};
    try {
        stored = JSON.parse(localStorage.getItem('smartleave_config') || '{}');
    } catch (e) {
        stored = {};
    }
    const runtime = (window.SMARTLEAVE_CONFIG && typeof window.SMARTLEAVE_CONFIG === 'object')
        ? window.SMARTLEAVE_CONFIG
        : {};
    return { ...DEFAULT_APP_CONFIG, ...stored, ...runtime };
}

function setAppConfig(partialConfig) {
    const current = getAppConfig();
    const merged = { ...current, ...(partialConfig || {}) };
    localStorage.setItem('smartleave_config', JSON.stringify(merged));
    return merged;
}

const APP_CONFIG = getAppConfig();
const API_BASE_URL = APP_CONFIG.API_BASE_URL;
window.setSmartLeaveConfig = setAppConfig;

const AUTH_KEYS = ['idToken', 'role', 'userEmail', 'userRole'];

function getAuthValue(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
}

function setAuthValue(key, value) {
    sessionStorage.setItem(key, value);
}

function clearAuth() {
    AUTH_KEYS.forEach((key) => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
    });
}

window.authStorage = {
    get: getAuthValue,
    set: setAuthValue,
    clear: clearAuth
};

/**
 * Reusable helper method to make all calls to AWS Serverless API.
 * Automatically injects the Cognito JWT token into headers and handles status codes.
 * @param {string} endpoint 
 * @param {string} method 
 * @param {object|null} body 
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
    const token = getAuthValue('idToken');

    const headers = {
        'Content-Type': 'application/json'
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    } else {
        console.warn('No authentication token found! API request may fail.');
    }

    const config = {
        method: method,
        headers: headers
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    try {
        const url = `${API_BASE_URL}${endpoint}`;
        console.log(`[API] ${method} ${url}`, body || '');
        const response = await fetch(url, config);
        const responseText = await response.text();
        let responseData = {};

        if (responseText) {
            try {
                responseData = JSON.parse(responseText);
            } catch (err) {
                responseData = { raw: responseText };
            }
        }

        console.log(`[API] ${method} ${url} -> ${response.status}`, responseData);

        // Handle specific error codes gracefully
        if (response.status === 401) {
            showToast('Session expired. Please log in again.', 'error');
            clearAuth();
            setTimeout(() => window.location.href = 'index.html', 1500);
            throw new Error('Unauthorized');
        }

        if (response.status === 403) {
            const forbiddenMessage = responseData.message || responseData.error || 'You do not have permission to perform this action.';
            showToast(forbiddenMessage, 'error');
            throw new Error(forbiddenMessage);
        }

        if (response.status >= 500) {
            const serverMessage = responseData.message || responseData.error || 'Server error occurred. Please try again later.';
            showToast(serverMessage, 'error');
            throw new Error(serverMessage);
        }

        if (!response.ok) {
            const errorMessage = responseData.message || responseData.error || 'Request failed';
            showToast(errorMessage, 'error');
            throw new Error(errorMessage);
        }

        return responseData;
    } catch (error) {
        if (error && error.message !== 'Unauthorized' && error.message !== 'Forbidden' && error.message !== 'Server Error') {
            showToast('Network/API error. Please check your connection and try again.', 'error');
        }
        console.error('API Request Error:', error);
        throw error;
    }
}

async function resolveUserRoleFromBackend(token) {
    const roleEndpoints = ['/identity/me', '/leave/identity', '/leave/me'];
    for (const endpoint of roleEndpoints) {
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) continue;
            const data = await response.json();
            const backendRole = data.role || data.user_role || data.group || data.assigned_role;
            if (backendRole) return backendRole;
            if (Array.isArray(data.groups) && data.groups.length > 0) return data.groups[0];
        } catch (err) {
            console.warn(`Role resolution failed on ${endpoint}`);
        }
    }
    return null;
}

// Global helper for toast notifications
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    const toastMessage = toast.querySelector('.toast-message');
    toastMessage.textContent = message;

    if (type === 'error') {
        toast.style.backgroundColor = '#EF4444'; // Red for error
        toast.querySelector('i').className = 'fa-solid fa-circle-exclamation';
    } else {
        toast.style.backgroundColor = '#10B981'; // Green for success
        toast.querySelector('i').className = 'fa-solid fa-circle-check';
    }

    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function setButtonLoading(button, isLoading, loadingText = 'Loading...') {
    if (!button) return;
    if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
    }
    button.textContent = isLoading ? loadingText : button.dataset.originalText;
    button.disabled = isLoading;
}

// --- AWS Cognito JWT Authorization Helpers ---

/**
 * Decodes a JWT and returns its payload
 * @param {string} token 
 * @returns {object|null}
 */
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

function normalizeRoleValue(role) {
    const value = String(role || '').trim().toLowerCase();
    if (value === 'hr_admin' || value === 'hr admin' || value === 'hr-admin') return 'HR_Admin';
    if (value === 'manager') return 'Manager';
    if (value === 'employee') return 'Employee';
    return role;
}

/**
 * Validates Cognito JWT and checks if user has allowed role/hierarchy
 * @param {Array<string>} allowedGroups - Array of allowed Cognito groups (e.g. ['Employee', 'Manager'])
 * @returns {object|boolean} - Returns decoded payload if valid, false otherwise
 */
function checkCognitoAuth(allowedGroups) {
    // 1. Get the Cognito IdToken from localStorage
    const token = getAuthValue('idToken');

    if (!token) {
        console.warn('No token found, redirecting to login');
        window.location.href = 'index.html';
        return false;
    }

    // 2. Decode the token
    const payload = parseJwt(token);
    if (!payload) {
        console.warn('Invalid token format, redirecting to login');
        clearAuth();
        window.location.href = 'index.html';
        return false;
    }

    // 3. Check Token Expiry (exp is in seconds)
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < currentTime) {
        console.warn('Token expired, redirecting to login');
        clearAuth();
        window.location.href = 'index.html';
        return false;
    }

    // 4. Hierarchy Check: 
    // AWS Cognito typically adds groups to the "cognito:groups" claim
    // Alternatively, you might be using a custom attribute like "custom:role"
    const userGroups = (payload['cognito:groups'] || []).map(normalizeRoleValue);
    const customRole = normalizeRoleValue(payload['custom:role']); // If you use an attribute instead of groups
    const normalizedAllowed = (allowedGroups || []).map(normalizeRoleValue);

    // Logic: check against allowed groups or a specific custom role
    const hasGroupAccess = normalizedAllowed.some(group => userGroups.includes(group));
    const hasCustomRoleAccess = normalizedAllowed.includes(customRole);

    if (!hasGroupAccess && !hasCustomRoleAccess) {
        console.error('Unauthorized: User does not have access to this page');
        window.location.href = 'index.html';
        return false;
    }

    return payload; // Authentication passed, return info
}

document.addEventListener('DOMContentLoaded', () => {
    // Handle Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            clearAuth();
            window.location.href = 'index.html';
        });
    }

    // Dark mode toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        const themeIcon = themeToggleBtn.querySelector('i');

        // Check initial preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
            themeIcon.classList.replace('fa-moon', 'fa-sun');
        }

        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            let targetTheme = 'light';

            if (currentTheme === 'light' || !currentTheme) {
                targetTheme = 'dark';
                themeIcon.classList.replace('fa-moon', 'fa-sun');
            } else {
                targetTheme = 'light';
                themeIcon.classList.replace('fa-sun', 'fa-moon');
            }

            document.documentElement.setAttribute('data-theme', targetTheme);
        });
    }
});
