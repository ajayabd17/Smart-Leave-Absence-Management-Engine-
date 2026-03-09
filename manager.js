document.addEventListener('DOMContentLoaded', () => {
    const payload = checkCognitoAuth(['Manager', 'HR_Admin']);
    if (!payload) return;

    const userEmail = payload.email || localStorage.getItem('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = localStorage.getItem('role') || 'Manager';
    }

    const role = localStorage.getItem('role');
    if (role === 'HR_Admin') {
        const hrSection = document.getElementById('hr-admin-section');
        if (hrSection) hrSection.style.display = 'block';
    }

    function getRequestId(req) {
        return req.request_id || req.leave_id || req.id;
    }

    function showPendingLoading() {
        const list = document.getElementById('approval-list-container');
        list.innerHTML = '<li style="padding:20px; text-align:center;">Loading pending approvals...</li>';
    }

    function clearCalendarMarkers() {
        document.querySelectorAll('.calendar-grid .day.has-leave').forEach((day) => {
            const dayNumber = day.id ? day.id.replace('cal-day-', '') : day.textContent.trim();
            day.classList.remove('has-leave');
            day.removeAttribute('title');
            day.innerHTML = dayNumber;
        });
    }

    async function loadPendingApprovals() {
        showPendingLoading();
        const response = await apiRequest('/leave/pending', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);

        document.getElementById('stat-pending').textContent = Array.isArray(rows) ? rows.length : 0;
        const listContainer = document.getElementById('approval-list-container');
        listContainer.innerHTML = '';

        if (!Array.isArray(rows) || rows.length === 0) {
            listContainer.innerHTML = '<li style="padding:20px; text-align:center;">No pending approvals.</li>';
            return;
        }

        rows.forEach((req) => {
            const requestId = getRequestId(req);
            const li = document.createElement('li');
            li.className = 'approval-item';
            li.innerHTML = `
                <div class="requester-info">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(req.employee_id || 'User')}&background=0D8ABC&color=fff" alt="Avatar">
                    <div>
                        <h4>${req.employee_id || '-'}</h4>
                        <p>${req.leave_type || '-'} (${req.total_days || 0} day${Number(req.total_days || 0) > 1 ? 's' : ''}) - ${req.start_date || '-'} to ${req.end_date || '-'}</p>
                    </div>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-primary approve-btn" data-request-id="${requestId}" style="padding: 5px 10px; font-size: 0.8rem; margin-right: 5px;">Approve</button>
                    <button class="btn btn-outline hover-red reject-btn" data-request-id="${requestId}" style="padding: 5px 10px; font-size: 0.8rem;">Reject</button>
                </div>
            `;
            listContainer.appendChild(li);
        });

        document.querySelectorAll('.approve-btn').forEach((btn) => {
            btn.addEventListener('click', () => handleDecision(btn, 'APPROVED'));
        });
        document.querySelectorAll('.reject-btn').forEach((btn) => {
            btn.addEventListener('click', () => handleDecision(btn, 'REJECTED'));
        });
    }

    async function handleDecision(button, decision) {
        const requestId = button.getAttribute('data-request-id');
        setButtonLoading(button, true, decision === 'APPROVED' ? 'Approving...' : 'Rejecting...');
        try {
            await apiRequest('/leave/approve', 'POST', {
                decision: decision,
                request_id: requestId
            });
            showToast(`Leave request ${decision.toLowerCase()} successfully.`, 'success');
            await refreshManagerDashboard();
        } catch (err) {
            console.error('Manager decision failed', err);
        } finally {
            setButtonLoading(button, false);
        }
    }

    async function loadCalendar() {
        clearCalendarMarkers();
        const response = await apiRequest('/leave/calendar', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);
        let outTodayCount = 0;

        if (!Array.isArray(rows) || rows.length === 0) {
            document.getElementById('stat-out').textContent = '0';
            return;
        }

        const today = new Date();
        rows.forEach((leave) => {
            if (!leave.start_date) return;
            const day = new Date(leave.start_date).getDate();
            const dayElement = document.getElementById(`cal-day-${day}`);
            if (!dayElement) return;

            dayElement.classList.add('has-leave');
            dayElement.setAttribute('title', `${leave.employee_id || 'Employee'} (${leave.leave_type || 'Leave'})`);

            let dotColor = 'blue';
            const type = String(leave.leave_type || '').toUpperCase();
            if (type === 'SICK') dotColor = 'red';
            if (type === 'CASUAL') dotColor = 'green';
            if (type === 'UNPAID') dotColor = 'orange';
            dayElement.innerHTML = `${day}<span class="dot ${dotColor}"></span>`;

            const leaveStart = new Date(leave.start_date);
            const leaveEnd = new Date(leave.end_date || leave.start_date);
            if (today >= leaveStart && today <= leaveEnd) outTodayCount += 1;
        });

        document.getElementById('stat-out').textContent = String(outTodayCount);
        document.getElementById('stat-total').textContent = String(rows.length);
    }

    async function refreshManagerDashboard() {
        try {
            await Promise.all([loadPendingApprovals(), loadCalendar()]);
        } catch (error) {
            console.error('Manager dashboard load failed', error);
        }
    }

    async function processSignedApprovalLink() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        const requestId = params.get('request_id');
        const decisionParam = String(params.get('decision') || '').toUpperCase();
        if (!token || !requestId || !decisionParam) return;

        const decision = decisionParam === 'REJECT' ? 'REJECTED' : 'APPROVED';
        try {
            await apiRequest('/leave/approve', 'POST', {
                request_id: requestId,
                decision: decision,
                signed_token: token
            });
            showToast(`Signed link processed: ${decision.toLowerCase()}`, 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
            await refreshManagerDashboard();
        } catch (error) {
            showToast('Signed approval link is invalid or expired.', 'error');
        }
    }

    async function downloadReport(format) {
        const token = localStorage.getItem('idToken');
        const response = await fetch(`${API_BASE_URL}/leave/report?format=${format}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`Failed to download ${format}`);
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

    const quotaForm = document.getElementById('quota-update-form');
    if (quotaForm) {
        quotaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = quotaForm.querySelector('button[type="submit"]');
            setButtonLoading(submitBtn, true, 'Updating...');
            try {
                await apiRequest('/leave/update-quota', 'POST', {
                    employee_id: document.getElementById('quota-emp-id').value.trim(),
                    leave_type: document.getElementById('quota-leave-type').value.toUpperCase(),
                    new_quota: parseInt(document.getElementById('quota-new-value').value, 10)
                });
                showToast('Quota updated successfully!', 'success');
                quotaForm.reset();
            } catch (err) {
                console.error('Quota update failed', err);
            } finally {
                setButtonLoading(submitBtn, false);
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

    processSignedApprovalLink();
    refreshManagerDashboard();
});
