document.addEventListener('DOMContentLoaded', () => {
    // Auth & Routing
    const authWrapper = document.getElementById('auth-wrapper');
    const appWrapper = document.getElementById('app-wrapper');
    const loginForm = document.getElementById('login-form');
    const roleSelect = document.getElementById('role');
    const userRoleText = document.getElementById('user-role');
    const userNameText = document.getElementById('user-name');

    const navEmployee = document.getElementById('nav-employee');
    const navManager = document.getElementById('nav-manager');
    const viewEmployee = document.getElementById('employee-view');
    const viewManager = document.getElementById('manager-view');
    const logoutBtn = document.getElementById('logout-btn');

    // Handle Login
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const role = roleSelect.value;
        userRoleText.textContent = role === 'manager' ? 'HR Manager' : 'Software Engineer';
        userNameText.textContent = role === 'manager' ? 'Alex Manager' : 'John Employee';

        // Hide auth, show app
        authWrapper.style.display = 'none';
        appWrapper.style.display = 'flex';

        // Setup Role UI
        if (role === 'employee') {
            navEmployee.style.display = 'block';
            navManager.style.display = 'none';
            navEmployee.classList.add('active');
            navManager.classList.remove('active');
            viewEmployee.classList.add('active');
            viewManager.classList.remove('active');
        } else {
            navEmployee.style.display = 'none';
            navManager.style.display = 'block';
            navManager.classList.add('active');
            navEmployee.classList.remove('active');
            viewManager.classList.add('active');
            viewEmployee.classList.remove('active');
        }
    });

    // Handle Logout
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            appWrapper.style.display = 'none';
            authWrapper.style.display = 'flex';
            loginForm.reset();
        });
    }

    // Tab switching logic
    const navLinks = document.querySelectorAll('.nav-links li');
    const viewSections = document.querySelectorAll('.view-section');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // Ignore if already active
            if (link.classList.contains('active')) return;

            // Remove active from all tabs
            navLinks.forEach(item => item.classList.remove('active'));
            viewSections.forEach(section => section.classList.remove('active'));

            // Set current active
            link.classList.add('active');

            // Show target section
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Dark mode toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
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

    // Toast
    const toast = document.getElementById('toast');
    const toastMessage = toast.querySelector('.toast-message');

    function showToast(message, type = 'success') {
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

    // Manager Action Buttons Simulate
    const actionButtons = document.querySelectorAll('.action-buttons .btn');
    actionButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const listItem = e.target.closest('.approval-item');
            const isApprove = e.target.closest('.btn-success') !== null;

            if (isApprove) {
                showToast('Leave request approved!', 'success');
            } else {
                showToast('Leave request rejected', 'error');
            }

            // Remove item with fade out
            listItem.style.opacity = '0';
            setTimeout(() => {
                listItem.remove();

                // Update counter mock
                const counter = document.querySelector('.manager-stats .number-stat');
                if (counter) {
                    let count = parseInt(counter.textContent);
                    if (count > 0) counter.textContent = count - 1;
                }
            }, 300);
        });
    });

    // Employee Apply Leave Simulate
    const applyLeaveForm = document.getElementById('apply-leave-form');
    if (applyLeaveForm) {
        applyLeaveForm.addEventListener('submit', (e) => {
            e.preventDefault();
            showToast('Leave request submitted successfully!', 'success');
            applyLeaveForm.reset();
        });
    }
});
