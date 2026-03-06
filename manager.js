document.addEventListener('DOMContentLoaded', () => {
    // Check Authorization
    const role = localStorage.getItem('userRole');
    if (role !== 'manager') {
        window.location.href = 'index.html'; // Redirect to login
        return;
    }

    // Set User Profile from demo login (using mock API)
    const userEmail = localStorage.getItem('userEmail');
    if (userEmail) {
        window.apiService.getUserProfile(userEmail).then(response => {
            if (response.success && response.data) {
                document.getElementById('user-name').textContent = response.data.name;
                document.getElementById('user-role').textContent = response.data.role;

                // Fetch basic data after user is loaded
                loadManagerData();
            }
        });
    }

    // Function to load dashboard data
    function loadManagerData() {
        // Load Stats
        window.apiService.getManagerStats().then(response => {
            if (response.success && response.data) {
                const stats = response.data;
                document.getElementById('stat-pending').textContent = stats.pendingApprovals;
                document.getElementById('stat-out').textContent = stats.teamOutToday;
                document.getElementById('stat-total').textContent = stats.totalRequestsMonth;
            }
        });

        // Load Pending Approvals
        window.apiService.getPendingApprovals().then(response => {
            if (response.success && response.data) {
                const listContainer = document.getElementById('approval-list-container');
                listContainer.innerHTML = ''; // Clear existing

                response.data.forEach(req => {
                    const li = document.createElement('li');
                    li.className = 'approval-item';
                    li.innerHTML = `
                        <div class="requester-info">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(req.employeeName)}&background=${req.avatarColor}&color=fff" alt="Avatar">
                            <div>
                                <h4>${req.employeeName}</h4>
                                <p>${req.type} Leave (${req.duration} day${req.duration > 1 ? 's' : ''}) • ${req.dates}</p>
                            </div>
                        </div>
                        <div class="action-buttons" data-id="${req.id}">
                            <button class="btn btn-success btn-icon"><i class="fa-solid fa-check"></i></button>
                            <button class="btn btn-danger btn-icon"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `;
                    listContainer.appendChild(li);
                });

                // Re-bind action button events to newly created DOM elements
                bindActionButtons();
            }
        });

        // Load Calendar Data
        window.apiService.getCalendarData().then(response => {
            if (response.success && response.data) {
                response.data.forEach(leave => {
                    const dayElement = document.getElementById(`cal-day-${leave.day}`);
                    if (dayElement) {
                        dayElement.classList.add('has-leave');
                        dayElement.setAttribute('title', `${leave.name} (${leave.type})`);

                        let dotColor = 'blue'; // Annual default
                        if (leave.type === 'Sick') dotColor = 'red';
                        if (leave.type === 'Casual') dotColor = 'green';

                        dayElement.innerHTML = `${leave.day}<span class="dot ${dotColor}"></span>`;
                    }
                });
            }
        });
    }

    // Manager Action Buttons Simulate
    function bindActionButtons() {
        const actionButtons = document.querySelectorAll('.action-buttons .btn');
        actionButtons.forEach(btn => {
            // Remove old listener if exists to prevent duplicates
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', async (e) => {
                const actionContainer = e.target.closest('.action-buttons');
                const requestId = actionContainer.getAttribute('data-id');
                const listItem = e.target.closest('.approval-item');
                const isApprove = e.target.closest('.btn-success') !== null;
                const actionStr = isApprove ? 'approv' : 'reject';

                // Change button state
                const originalHtml = newBtn.innerHTML;
                newBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                newBtn.disabled = true;

                try {
                    const response = await window.apiService.processLeaveRequest(requestId, actionStr);

                    if (response.success) {
                        showToast(`Leave request ${actionStr}ed successfully!`, 'success');

                        // Remove item with fade out
                        listItem.style.opacity = '0';
                        setTimeout(() => {
                            listItem.remove();

                            // Update counter mock
                            const counter = document.getElementById('stat-pending');
                            if (counter && counter.textContent !== '-') {
                                let count = parseInt(counter.textContent);
                                if (count > 0) counter.textContent = count - 1;
                            }
                        }, 300);
                    }
                } catch (error) {
                    showToast('Action failed', 'error');
                    newBtn.innerHTML = originalHtml;
                    newBtn.disabled = false;
                }
            });
        });
    }
});
