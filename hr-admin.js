document.addEventListener('DOMContentLoaded', () => {
    const payload = checkCognitoAuth(['HR_Admin', 'hr_admin', 'HR Admin', 'hr admin']);
    if (!payload) return;

    function getRequestId(req) {
        return req.request_id || req.leave_id || req.id;
    }

    async function downloadReport(format) {
        const token = localStorage.getItem('idToken');
        const response = await fetch(`${API_BASE_URL}/leave/report?format=${format}`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = `leave-report-${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(href);
    }

    const userEmail = payload.email || localStorage.getItem('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = 'HR Admin';
        loadHrData();
    }

    function loadHrData() {
        apiRequest('/leave/pending').then(data => {
            if (Array.isArray(data)) {
                document.getElementById('stat-pending').textContent = data.length;
                document.getElementById('stat-out').textContent = '2';
                document.getElementById('stat-total').textContent = '14';

                const listContainer = document.getElementById('approval-list-container');
                listContainer.innerHTML = '';
                if (data.length === 0) {
                    listContainer.innerHTML = '<li style="padding:20px; text-align:center;">No pending approvals.</li>';
                    return;
                }

                data.forEach(req => {
                    const requestId = getRequestId(req);
                    const li = document.createElement('li');
                    li.className = 'approval-item';
                    li.innerHTML = `
                        <div class="requester-info">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(req.employee_id || 'User')}&background=0D8ABC&color=fff" alt="Avatar">
                            <div>
                                <h4>${req.employee_id}</h4>
                                <p>${req.leave_type} (${req.total_days} day${req.total_days > 1 ? 's' : ''}) - ${req.start_date} to ${req.end_date}</p>
                            </div>
                        </div>
                        <div class="action-buttons" data-id="${requestId}">
                            <button class="btn btn-primary approve-btn" data-id="${requestId}" style="padding: 5px 10px; font-size: 0.8rem; margin-right: 5px;">Approve</button>
                            <button class="btn btn-outline hover-red reject-btn" data-id="${requestId}" style="padding: 5px 10px; font-size: 0.8rem;">Reject</button>
                        </div>
                    `;
                    listContainer.appendChild(li);
                });

                document.querySelectorAll('.approve-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => handleDecision(e.target.getAttribute('data-id'), 'Approve'));
                });
                document.querySelectorAll('.reject-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => handleDecision(e.target.getAttribute('data-id'), 'Reject'));
                });
            }
        }).catch(() => {
            document.getElementById('stat-pending').textContent = '0';
        });

        apiRequest('/leave/calendar').then(data => {
            if (data && Array.isArray(data)) {
                data.forEach(leave => {
                    const dayMatch = leave.start_date ? new Date(leave.start_date).getDate() : null;
                    if (!dayMatch) return;
                    const dayElement = document.getElementById(`cal-day-${dayMatch}`);
                    if (!dayElement) return;

                    dayElement.classList.add('has-leave');
                    dayElement.setAttribute('title', `${leave.employee_id} (${leave.leave_type})`);
                    let dotColor = 'blue';
                    if (leave.leave_type && leave.leave_type.toUpperCase() === 'SICK') dotColor = 'red';
                    if (leave.leave_type && leave.leave_type.toUpperCase() === 'CASUAL') dotColor = 'green';
                    if (leave.leave_type && leave.leave_type.toUpperCase() === 'UNPAID') dotColor = 'orange';
                    dayElement.innerHTML = `${dayMatch}<span class="dot ${dotColor}"></span>`;
                });
            }
        });
    }

    async function handleDecision(leaveId, decision) {
        try {
            await apiRequest('/leave/approve', 'POST', {
                leave_id: leaveId,
                decision: decision
            });
            showToast(`Leave request ${decision.toLowerCase()}d successfully.`, 'success');
            loadHrData();
        } catch (error) {
            // errors handled in apiRequest
        }
    }

    const allotForm = document.getElementById('allot-leave-form');
    if (allotForm) {
        allotForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const btn = allotForm.querySelector('button[type="submit"]');
            const originalText = btn.textContent;
            btn.textContent = 'Allocating...';
            btn.disabled = true;

            const formPayload = {
                employee_id: document.getElementById('allot-emp-id').value,
                leave_type: document.getElementById('allot-leave-type').value.toUpperCase(),
                new_quota: parseInt(document.getElementById('allot-days').value, 10)
            };

            try {
                await apiRequest('/leave/update-quota', 'POST', formPayload);
                showToast('Leave quota allocated successfully.', 'success');
                allotForm.reset();
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });
    }

    const csvBtn = document.getElementById('download-csv-btn');
    if (csvBtn) {
        csvBtn.addEventListener('click', async () => {
            try {
                await downloadReport('csv');
                showToast('CSV report downloaded.', 'success');
            } catch (error) {
                showToast('Failed to download CSV report.', 'error');
            }
        });
    }

    const pdfBtn = document.getElementById('download-pdf-btn');
    if (pdfBtn) {
        pdfBtn.addEventListener('click', async () => {
            try {
                await downloadReport('pdf');
                showToast('PDF report downloaded.', 'success');
            } catch (error) {
                showToast('Failed to download PDF report.', 'error');
            }
        });
    }
});
