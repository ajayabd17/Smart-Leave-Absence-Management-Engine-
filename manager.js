document.addEventListener('DOMContentLoaded', () => {
    // Check Authorization using Cognito Token Check
    // We restrict access to users having the 'Manager' or 'HR_Admin' group in Cognito
    const payload = checkCognitoAuth(['Manager', 'HR_Admin']);
    if (!payload) return; // checkCognitoAuth handles the redirect to login

    // Set User Profile from Cognito token data
    const userEmail = payload.email || localStorage.getItem('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = localStorage.getItem('role') || 'Manager';
        
        // Fetch basic data after user is loaded
        loadManagerData();
    }

    // HR Admin Check
    const userRole = localStorage.getItem('role');
    if (userRole === 'HR_Admin') {
        const HRSection = document.getElementById('hr-admin-section');
        if (HRSection) HRSection.style.display = 'block';
    }

    // Function to load dashboard data
    function loadManagerData() {
        // Load Stats (Optional based on your backend, keeping generic structure if it exists)
        apiRequest('/leave/pending').then(data => {
            // Count array length of pending items natively if no specific stat endpoint exists
            if (data && Array.isArray(data)) {
                 document.getElementById('stat-pending').textContent = data.length;
                 // Dummy data for missing endpoints as they were not in the requirement doc list:
                 document.getElementById('stat-out').textContent = '2'; 
                 document.getElementById('stat-total').textContent = '14'; 
            }
        }).catch(() => {
            document.getElementById('stat-pending').textContent = '0';
        });

        // Load Pending Approvals
        apiRequest('/leave/pending').then(data => {
            if (data && Array.isArray(data)) {
                const listContainer = document.getElementById('approval-list-container');
                listContainer.innerHTML = ''; // Clear existing

                if (data.length === 0) {
                    listContainer.innerHTML = '<li style="padding:20px; text-align:center;">No pending approvals.</li>';
                    return;
                }

                data.forEach(req => {
                    const li = document.createElement('li');
                    li.className = 'approval-item';
                    
                    // Backend returns: employee_id, leave_type, start_date, end_date, total_days, status
                    li.innerHTML = `
                         <div class="requester-info">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(req.employee_id || 'User')}&background=0D8ABC&color=fff" alt="Avatar">
                            <div>
                                <h4>${req.employee_id}</h4>
                                <p>${req.leave_type} (${req.total_days} day${req.total_days > 1 ? 's' : ''}) • ${req.start_date} to ${req.end_date}</p>
                            </div>
                        </div>
                        <div class="action-buttons" data-id="${req.id}">
                            <!-- Approvals via email for backend, so buttons just show message or hide -->
                            <p style="font-size: 0.8em; color: gray;">Action in Email</p>
                        </div>
                    `;
                    listContainer.appendChild(li);
                });
            }
        }).catch(err => console.error("Pending Load Error", err));

        // Load Calendar Data
        apiRequest('/leave/calendar').then(data => {
            if (data && Array.isArray(data)) {
                data.forEach(leave => {
                    // Extracting day logic - simplistic example, modify based on exact backend ISO format
                    const dayMatch = leave.start_date ? new Date(leave.start_date).getDate() : null;
                    
                    if (dayMatch) {
                        const dayElement = document.getElementById(`cal-day-${dayMatch}`);
                        if (dayElement) {
                            dayElement.classList.add('has-leave');
                            dayElement.setAttribute('title', `${leave.employee_id} (${leave.leave_type})`);

                            let dotColor = 'blue'; // Annual default
                            if (leave.leave_type && leave.leave_type.toUpperCase() === 'SICK') dotColor = 'red';
                            if (leave.leave_type && leave.leave_type.toUpperCase() === 'CASUAL') dotColor = 'green';

                            dayElement.innerHTML = `${dayMatch}<span class="dot ${dotColor}"></span>`;
                        }
                    }
                });
            }
        }).catch(err => console.error("Calendar Load Error", err));
    }

    // HR Admin Quota Form Integration
    const quotaForm = document.getElementById('quota-update-form');
    if (quotaForm) {
        quotaForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = quotaForm.querySelector('button[type="submit"]');
            const ogText = submitBtn.textContent;
            submitBtn.textContent = 'Updating...';
            submitBtn.disabled = true;

            const payload = {
                employee_id: document.getElementById('quota-emp-id').value,
                leave_type: document.getElementById('quota-leave-type').value.toUpperCase(),
                new_quota: parseInt(document.getElementById('quota-new-value').value)
            };

            try {
                await apiRequest('/leave/quota/update', 'PUT', payload);
                showToast('Quota updated successfully!', 'success');
                quotaForm.reset();
            } catch (error) {
                 // apiRequest handles toast UI on error automatically
            } finally {
                submitBtn.textContent = ogText;
                submitBtn.disabled = false;
            }
        });
    }
});
