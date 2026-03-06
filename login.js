document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const roleSelect = document.getElementById('role');
    const emailInput = document.getElementById('email');

    // Handle Login with AWS Cognito
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const role = roleSelect.value; // May not be needed if role is determined by Cognito
        const email = emailInput.value;
        const passwordInput = document.getElementById('password').value;

        // --- AWS COGNITO AUTHENTICATION FLOW ---
        // Replace this try/catch block with your actual AWS SDK or Amplify Auth.signIn code
        try {
            // Example Amplify Code:
            // const user = await Auth.signIn(email, passwordInput);
            // const idToken = user.signInUserSession.idToken.jwtToken;
            
            // 1. Get the actual token from AWS Cognito
            // const tokenFromCognito = ... 

            // 2. Store it securely so common.js can validate it on other pages
            // localStorage.setItem('idToken', tokenFromCognito);

            // 3. Optional: Store other user details retrieved from Cognito
            // localStorage.setItem('userEmail', email);

            // 4. Redirect based on the Cognito Group claims (example using the parseJwt helper from common.js)
            /*
            const payload = parseJwt(tokenFromCognito);
            const userGroups = payload['cognito:groups'] || [];

            if (userGroups.includes('Manager')) {
                window.location.href = 'manager.html';
            } else if (userGroups.includes('Employee')) {
                window.location.href = 'employee.html';
            } else {
                showToast('Unauthorized Role', 'error');
            }
            */

           // Placeholder alert to remind you to implement this:
           alert("Please insert your AWS SDK / Amplify authentication code here to obtain the real idToken.");

        } catch (error) {
            console.error('Login failed:', error);
            // Example: Documenting UI feedback for failed auth
            // showToast(error.message || 'Login failed', 'error');
        }
    });
});
