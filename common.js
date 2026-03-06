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

document.addEventListener('DOMContentLoaded', () => {
    // Handle Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
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
