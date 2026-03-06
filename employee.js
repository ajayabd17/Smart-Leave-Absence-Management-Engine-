document.addEventListener('DOMContentLoaded', () => {
    // Check Authorization using Cognito Token Check
    // We restrict access to users having the 'Employee' group or role in Cognito
    const payload = checkCognitoAuth(['Employee']);
    if (!payload) return; // checkCognitoAuth handles the redirect to login

    // Set User Profile from Cognito token data (falling back to mock storage for demo)
    const userEmail = payload.email || localStorage.getItem('userEmail');
    if (userEmail) {
        window.apiService.getUserProfile(userEmail).then(response => {
            if (response.success && response.data) {
                document.getElementById('user-name').textContent = response.data.name;
                document.getElementById('user-role').textContent = response.data.role;

                // Fetch basic data after user is loaded
                loadEmployeeData(response.data.id);
            }
        });
    }

    // Function to load dashboard data
    function loadEmployeeData(employeeId) {
        // Load Balances
        window.apiService.getBalances(employeeId).then(response => {
            if (response.success && response.data) {
                const balances = response.data;
                document.getElementById('annual-used').innerHTML = `${balances.annual.used}<span>d</span>`;
                document.getElementById('annual-total').innerHTML = `/ ${balances.annual.total}`;

                document.getElementById('sick-used').innerHTML = `${balances.sick.used}<span>d</span>`;
                document.getElementById('sick-total').innerHTML = `/ ${balances.sick.total}`;

                document.getElementById('casual-used').innerHTML = `${balances.casual.used}<span>d</span>`;
                document.getElementById('casual-total').innerHTML = `/ ${balances.casual.total}`;
            }
        });

        // Load History
        window.apiService.getHistory(employeeId).then(response => {
            if (response.success && response.data) {
                const historyBody = document.getElementById('leave-history-body');
                historyBody.innerHTML = ''; // Clear existing

                response.data.forEach(record => {
                    // Determine color classes
                    let typeColor = 'blue';
                    if (record.type === 'Annual') typeColor = 'green';
                    if (record.type === 'Sick') typeColor = 'red';

                    let statusClass = record.status === 'Approved' ? 'approved' : 'rejected';

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><span class="type-indicator ${typeColor}"></span> ${record.type}</td>
                        <td>${record.duration} day${record.duration > 1 ? 's' : ''}</td>
                        <td>${record.dates}</td>
                        <td><span class="status-badge ${statusClass}">${record.status}</span></td>
                    `;
                    historyBody.appendChild(tr);
                });
            }
        });
    }

    // Employee Apply Leave API Integration
    const applyLeaveForm = document.getElementById('apply-leave-form');
    if (applyLeaveForm) {
        applyLeaveForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Store original button state to revert later
            const submitBtn = applyLeaveForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;
            submitBtn.textContent = 'Submitting...';
            submitBtn.disabled = true;

            const leaveType = document.getElementById('leave-type').value.toUpperCase();
            const startDate = document.getElementById('date-from').value;
            const endDate = document.getElementById('date-to').value;
            const reason = document.getElementById('leave-reason').value;

            // Prepare payload matching the API schema
            const payload = {
                employee_id: "EMP001", // Hardcoded employee ID for demo purposes
                leave_type: leaveType,
                start_date: startDate,
                end_date: endDate,
                reason: reason
            };

            try {
                // Send POST request to AWS API Gateway
                const response = await fetch('https://vq8p7y4koa.execute-api.ap-south-1.amazonaws.com/default/applyLeaveLambda', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    showToast('Leave request submitted successfully!', 'success');
                    applyLeaveForm.reset();
                } else {
                    const errorData = await response.json();
                    showToast(errorData.message || 'Failed to submit request', 'error');
                }
            } catch (error) {
                console.error("Error submitting leave:", error);
                showToast('An error occurred. Please try again.', 'error');
            } finally {
                // Restore button state
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
            }
        });
    }
});
