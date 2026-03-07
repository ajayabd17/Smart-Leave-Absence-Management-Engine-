document.addEventListener('DOMContentLoaded', () => {
    // Login Form Elements
    const loginForm = document.getElementById('login-form');
    const roleSelect = document.getElementById('role');
    const emailInput = document.getElementById('email');

    // Change Password Elements
    const loginCard = document.querySelector('.auth-card:not(#change-password-card)');
    const changePwdCard = document.getElementById('change-password-card');
    const changePwdForm = document.getElementById('change-password-form');
    const cancelChangeBtn = document.getElementById('cancel-change-btn');
    const newPasswordInput = document.getElementById('new-password');
    const sessionTokenInput = document.getElementById('cognito-session-token');
    const usernameInput = document.getElementById('cognito-username');

    // AWS Config
    AWS.config.region = 'ap-south-1'; // Replace with your region
    const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
    const APP_CLIENT_ID = '2a98a6f4c48ogvpcmcsgugv3rm';

    // Handle Login with AWS Cognito
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault(); // Stop page from reloading
        const email = emailInput.value;
        const passwordInput = document.getElementById('password').value;

        // --- AWS COGNITO AUTHENTICATION FLOW (v2) ---
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = 'Signing In...';
        submitBtn.disabled = true;

        // 1. Prepare the Request
        const params = {
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: APP_CLIENT_ID,
            AuthParameters: {
                USERNAME: email,
                PASSWORD: passwordInput,
            }
        };

        // 3. Send Request to AWS Cognito
        cognitoidentityserviceprovider.initiateAuth(params, function(err, data) {
            if (err) {
                console.error('Login failed:', err);
                showToast(err.message || 'Login failed Check Credentials', 'error');
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                return;
            }

            // 3. Handle Cognito Challenges (NEW_PASSWORD_REQUIRED)
            if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
                showToast(`Action Required: Please set a permanent password.`, 'error');
                
                // Switch UI to Change Password Mode
                loginCard.style.display = 'none';
                changePwdCard.style.display = 'block';
                
                // Store required details for the next API call
                sessionTokenInput.value = data.Session;
                usernameInput.value = email;

                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                return;
            } else if (data.ChallengeName) {
                 console.warn("Unhandled Cognito Login Challenge:", data.ChallengeName);
                 showToast(`Unhandled challenge: ${data.ChallengeName}. Check AWS.`, 'error');
                 submitBtn.innerHTML = originalText;
                 submitBtn.disabled = false;
                 return;
            }

            // 5. Extract and Validate the Token
            if (!data.AuthenticationResult || !data.AuthenticationResult.IdToken) {
                showToast("Login failed: No Token returned from AWS.", 'error');
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                return;
            }

            const idToken = data.AuthenticationResult.IdToken;

            // 6. Store the Token
            localStorage.setItem('idToken', idToken);
            localStorage.setItem('userEmail', email);

            // 7. Decode token and redirect
            const payload = parseJwt(idToken); // Helper in common.js
            const userGroups = payload['cognito:groups'] || [];

            let assignedRole = null;

            if (userGroups.includes('HR_Admin')) {
                assignedRole = 'HR_Admin';
                window.location.href = 'manager.html';
            } else if (userGroups.includes('Manager')) {
                assignedRole = 'Manager';
                window.location.href = 'manager.html';
            } else if (userGroups.includes('Employee')) {
                assignedRole = 'Employee';
                window.location.href = 'employee.html';
            } else {
                showToast('Unauthorized Role: No valid group assigned.', 'error');
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                return;
            }

            if (assignedRole) {
                localStorage.setItem('role', assignedRole);
            }
        });
    });

    // Handle AWS Cognito Change Password Submission
    changePwdForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const newPassword = newPasswordInput.value;
        const session = sessionTokenInput.value;
        const username = usernameInput.value;

        const submitBtn = changePwdForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = 'Updating...';
        submitBtn.disabled = true;

        const challengeParams = {
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            ClientId: APP_CLIENT_ID,
            ChallengeResponses: {
                USERNAME: username,
                NEW_PASSWORD: newPassword,
            },
            Session: session
        };

        cognitoidentityserviceprovider.respondToAuthChallenge(challengeParams, function(err, data) {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;

            if (err) {
                console.error('Password change failed:', err);
                showToast(err.message || 'Failed to update password. Check requirements.', 'error');
                return;
            }

            // If successful, AWS usually returns the AuthenticationResult directly!
            if (data.AuthenticationResult && data.AuthenticationResult.IdToken) {
                showToast("Password updated successfully! Logging you in...", "success");
                
                const idToken = data.AuthenticationResult.IdToken;
                localStorage.setItem('idToken', idToken);
                localStorage.setItem('userEmail', username);

                // Decode token and redirect
                const payload = parseJwt(idToken);
                const userGroups = payload['cognito:groups'] || [];
                let assignedRole = null;

                if (userGroups.includes('HR_Admin')) {
                    assignedRole = 'HR_Admin';
                    window.location.href = 'manager.html';
                } else if (userGroups.includes('Manager')) {
                    assignedRole = 'Manager';
                    window.location.href = 'manager.html';
                } else if (userGroups.includes('Employee')) {
                    assignedRole = 'Employee';
                    window.location.href = 'employee.html';
                } else {
                    showToast('Password changed, but you have no valid groups assigned.', 'error');
                }

                if (assignedRole) {
                    localStorage.setItem('role', assignedRole);
                }
            } else {
                // Edge case: Changed password but requires re-authentication
                showToast("Password updated. Please log in again.", "success");
                cancelChangeBtn.click(); // Reset UI
            }
        });
    });

    // Handle Cancel Password Change
    cancelChangeBtn.addEventListener('click', () => {
        changePwdForm.reset();
        changePwdCard.style.display = 'none';
        loginCard.style.display = 'block';
    });
});
