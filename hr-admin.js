document.addEventListener('DOMContentLoaded', () => {
    const payload = checkCognitoAuth(['HR_Admin', 'hr_admin', 'HR Admin', 'hr admin']);
    if (!payload) return;

    const userEmail = payload.email || localStorage.getItem('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = 'HR Admin';
    }

    function getRequestId(req) {
        return req.request_id || req.leave_id || req.id;
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
        const listContainer = document.getElementById('approval-list-container');
        listContainer.innerHTML = '<li style="padding:20px; text-align:center;">Loading pending approvals...</li>';
        const response = await apiRequest('/leave/pending', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);

        document.getElementById('stat-pending').textContent = Array.isArray(rows) ? rows.length : 0;
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
            await refreshHrDashboard();
        } catch (error) {
            console.error('HR decision failed', error);
        } finally {
            setButtonLoading(button, false);
        }
    }

    async function loadCalendar() {
        clearCalendarMarkers();
        const response = await apiRequest('/leave/calendar', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);

        if (!Array.isArray(rows) || rows.length === 0) {
            document.getElementById('stat-out').textContent = '0';
            document.getElementById('stat-total').textContent = '0';
            return;
        }

        const today = new Date();
        let outTodayCount = 0;
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

    async function refreshHrDashboard() {
        try {
            await Promise.all([loadPendingApprovals(), loadCalendar()]);
        } catch (error) {
            console.error('HR dashboard load failed', error);
        }
    }

    const quotaForm = document.getElementById('allot-leave-form');
    if (quotaForm) {
        quotaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = quotaForm.querySelector('button[type="submit"]');
            setButtonLoading(submitBtn, true, 'Allocating...');
            try {
                await apiRequest('/leave/update-quota', 'POST', {
                    employee_id: document.getElementById('allot-emp-id').value.trim(),
                    leave_type: document.getElementById('allot-leave-type').value.toUpperCase(),
                    new_quota: parseInt(document.getElementById('allot-days').value, 10)
                });
                showToast('Leave quota updated successfully.', 'success');
                quotaForm.reset();
            } catch (error) {
                console.error('Quota update failed', error);
            } finally {
                setButtonLoading(submitBtn, false);
            }
        });
    }

    const configForm = document.getElementById('config-update-form');
    if (configForm) {
        configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = configForm.querySelector('button[type="submit"]');
            setButtonLoading(submitBtn, true, 'Updating...');
            try {
                await apiRequest('/leave/config/update', 'POST', {
                    leave_type: document.getElementById('config-leave-type').value.toUpperCase(),
                    annual_quota: parseInt(document.getElementById('config-annual-quota').value, 10)
                });
                showToast('Leave configuration updated successfully.', 'success');
                configForm.reset();
            } catch (error) {
                console.error('Config update failed', error);
            } finally {
                setButtonLoading(submitBtn, false);
            }
        });
    }

    async function downloadReport(format) {
        const token = localStorage.getItem('idToken');
        const response = await fetch(`${API_BASE_URL}/leave/report?format=${format}`, {
            headers: { Authorization: `Bearer ${token}` }
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

    refreshHrDashboard();
});
