document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const roleSelect = document.getElementById('role');
    const emailInput = document.getElementById('email');

    // Handle Login
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const role = roleSelect.value;
        const email = emailInput.value;

        // In a real app, you'd send credentials to a backend here and get a token.
        // For this demo, we'll store role in localStorage to bypass real auth.
        localStorage.setItem('userRole', role);
        localStorage.setItem('userEmail', email);

        if (role === 'employee') {
            window.location.href = 'employee.html';
        } else {
            window.location.href = 'manager.html';
        }
    });
});
