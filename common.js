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
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

/**
 * Validates Cognito JWT and checks if user has allowed role/hierarchy
 * @param {Array<string>} allowedGroups - Array of allowed Cognito groups (e.g. ['Employee', 'Manager'])
 * @returns {object|boolean} - Returns decoded payload if valid, false otherwise
 */
function checkCognitoAuth(allowedGroups) {
    // 1. Get the Cognito IdToken from localStorage
    const token = localStorage.getItem('idToken');
    
    if (!token) {
        console.warn('No token found, redirecting to login');
        window.location.href = 'index.html';
        return false;
    }

    // 2. Decode the token
    const payload = parseJwt(token);
    if (!payload) {
        console.warn('Invalid token format, redirecting to login');
        localStorage.removeItem('idToken');
        window.location.href = 'index.html';
        return false;
    }

    // 3. Check Token Expiry (exp is in seconds)
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < currentTime) {
        console.warn('Token expired, redirecting to login');
        localStorage.removeItem('idToken');
        window.location.href = 'index.html';
        return false;
    }

    // 4. Hierarchy Check: 
    // AWS Cognito typically adds groups to the "cognito:groups" claim
    // Alternatively, you might be using a custom attribute like "custom:role"
    const userGroups = payload['cognito:groups'] || [];
    const customRole = payload['custom:role']; // If you use an attribute instead of groups

    // Logic: check against allowed groups or a specific custom role
    const hasGroupAccess = allowedGroups.some(group => userGroups.includes(group));
    const hasCustomRoleAccess = allowedGroups.includes(customRole);

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
            localStorage.removeItem('idToken'); // Clear Cognito Token
            localStorage.removeItem('userRole');
            localStorage.removeItem('userEmail');
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
