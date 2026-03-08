document.addEventListener('DOMContentLoaded', () => {
    // Check Authorization using Cognito Token Check
    // We restrict access to users having the 'Employee' group or role in Cognito
    const payload = checkCognitoAuth(['Employee']);
    if (!payload) return; // checkCognitoAuth handles the redirect to login

    // Set User Profile from Cognito token data
    const userEmail = payload.email || localStorage.getItem('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = localStorage.getItem('role') || 'Employee';
        
        // Fetch basic data after user is loaded
        loadEmployeeData();
    }

    // Function to load dashboard data
    function loadEmployeeData() {
        // Load Balances
        apiRequest('/leave/balance').then(data => {
            if (data) {
                // Assuming data returns { annual: { used, total }, sick: ... } 
                // Adjust this mapping if backend returns differently
                document.getElementById('annual-used').innerHTML = `${data.annual?.used || 0}<span>d</span>`;
                document.getElementById('annual-total').innerHTML = `/ ${data.annual?.total || 0}`;

                document.getElementById('sick-used').innerHTML = `${data.sick?.used || 0}<span>d</span>`;
                document.getElementById('sick-total').innerHTML = `/ ${data.sick?.total || 0}`;

                document.getElementById('casual-used').innerHTML = `${data.casual?.used || 0}<span>d</span>`;
                document.getElementById('casual-total').innerHTML = `/ ${data.casual?.total || 0}`;
            }
        }).catch(err => console.error("Balance Load Error", err));

        // Load History
        apiRequest('/leave/history').then(data => {
            if (data && Array.isArray(data)) {
                const historyBody = document.getElementById('leave-history-body');
                historyBody.innerHTML = ''; // Clear existing

                if (data.length === 0) {
                    historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">No leave history found.</td></tr>';
                    return;
                }

                data.forEach(record => {
                    // Normalize status text for CSS classes
                    const statusStr = (record.status || '').toUpperCase();
                    let statusClass = 'pending';
                    if (statusStr === 'APPROVED') statusClass = 'approved';
                    if (statusStr === 'REJECTED') statusClass = 'rejected';

                    // Determine color classes
                    const typeStr = (record.leave_type || '').toUpperCase();
                    let typeColor = 'blue'; // casual default
                    if (typeStr.includes('ANNUAL')) typeColor = 'green';
                    if (typeStr.includes('SICK')) typeColor = 'red';

                    const tr = document.createElement('tr');
                    
                    // The backend returns start_date, end_date, leave_type, status
                    tr.innerHTML = `
                        <td><span class="type-indicator ${typeColor}"></span> ${record.leave_type || 'Unknown'}</td>
                        <td>${record.start_date} to ${record.end_date}</td>
                        <td>${record.start_date}</td>
                        <td><span class="status-badge ${statusClass}">${record.status}</span></td>
                    `;
                    historyBody.appendChild(tr);
                });
            }
        }).catch(err => console.error("History Load Error", err));
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
                leave_type: leaveType,
                start_date: startDate,
                end_date: endDate,
                reason: reason
            };

            try {
                // Send POST request to API gateway via apiRequest helper
                const responseData = await apiRequest('/leave/request', 'POST', payload);
                showToast('Leave request submitted successfully!', 'success');
                applyLeaveForm.reset();
                
                // Refresh data to show pending status
                loadEmployeeData();
            } catch (error) {
                console.error("Error submitting leave:", error);
                // apiRequest helper handles the toast error message internally.
            } finally {
                // Restore button state
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
            }
        });
    }
});
