document.addEventListener('DOMContentLoaded', () => {
    const payload = checkCognitoAuth(['HR_Admin', 'hr_admin', 'HR Admin', 'hr admin']);
    if (!payload) return;

    const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
    const today = new Date();
    const todayKey = formatDateKey(today);

    const calendarGrid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('calendar-month-label');
    const prevBtn = document.getElementById('calendar-prev-btn');
    const nextBtn = document.getElementById('calendar-next-btn');

    let activeMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    let calendarRows = [];

    const userEmail = payload.email || authStorage.get('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = 'HR Admin';
    }

    prevBtn?.addEventListener('click', () => {
        activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1);
        renderCalendar();
        updateCalendarStats();
    });

    nextBtn?.addEventListener('click', () => {
        activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1);
        renderCalendar();
        updateCalendarStats();
    });

    bindQuotaForm();
    bindConfigForm();
    bindReportButtons();
    loadLeaveTypeOptions();
    refreshHrDashboard();

    function parseIsoDate(value) {
        if (!value) return null;
        const parts = String(value).split('-').map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function formatDateKey(value) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function dateInRange(day, start, end) {
        return day.getTime() >= start.getTime() && day.getTime() <= end.getTime();
    }

    function getTypeColor(type) {
        const key = String(type || '').toUpperCase();
        if (key === 'SICK') return 'red';
        if (key === 'CASUAL') return 'green';
        if (key === 'UNPAID') return 'orange';
        return 'blue';
    }

    function buildMonthLeaveMap() {
        const map = new Map();
        const monthStart = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
        const monthEnd = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 0);

        calendarRows.forEach((leave) => {
            const start = parseIsoDate(leave.start_date);
            const end = parseIsoDate(leave.end_date || leave.start_date);
            if (!start || !end || end < monthStart || start > monthEnd) return;

            const iterStart = new Date(Math.max(start.getTime(), monthStart.getTime()));
            const iterEnd = new Date(Math.min(end.getTime(), monthEnd.getTime()));

            for (let d = new Date(iterStart); d <= iterEnd; d.setDate(d.getDate() + 1)) {
                const key = formatDateKey(d);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(leave);
            }
        });

        return map;
    }

    function renderCalendar() {
        if (!calendarGrid) return;
        monthLabel.textContent = monthFormatter.format(activeMonth);
        calendarGrid.innerHTML = '';

        dayLabels.forEach((name) => {
            const cell = document.createElement('div');
            cell.className = 'day-name';
            cell.textContent = name;
            calendarGrid.appendChild(cell);
        });

        const firstWeekday = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1).getDay();
        const totalDays = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 0).getDate();
        const leaveMap = buildMonthLeaveMap();

        for (let i = 0; i < firstWeekday; i += 1) {
            const empty = document.createElement('div');
            empty.className = 'day empty';
            calendarGrid.appendChild(empty);
        }

        for (let dayNum = 1; dayNum <= totalDays; dayNum += 1) {
            const dayDate = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), dayNum);
            const key = formatDateKey(dayDate);
            const leaveItems = leaveMap.get(key) || [];

            const cell = document.createElement('div');
            const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
            const classes = ['day'];
            if (isWeekend) classes.push('weekend');
            if (leaveItems.length > 0) classes.push('has-leave');
            if (key === todayKey) classes.push('today');
            cell.className = classes.join(' ');

            let html = `${dayNum}`;
            if (leaveItems.length > 0) {
                html += `<span class="dot ${getTypeColor(leaveItems[0].leave_type)}"></span>`;
                const tip = leaveItems
                    .map((x) => `${x.employee_id || 'Employee'} (${x.leave_type || 'Leave'})`)
                    .slice(0, 4)
                    .join('\n');
                cell.setAttribute('title', tip + (leaveItems.length > 4 ? '\n...' : ''));
            }
            cell.innerHTML = html;
            calendarGrid.appendChild(cell);
        }
    }

    function updateCalendarStats() {
        const statOut = document.getElementById('stat-out');
        const statTotal = document.getElementById('stat-total');

        const monthStart = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
        const monthEnd = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 0);
        const monthRows = calendarRows.filter((leave) => {
            const start = parseIsoDate(leave.start_date);
            const end = parseIsoDate(leave.end_date || leave.start_date);
            return start && end && !(end < monthStart || start > monthEnd);
        });

        const outToday = new Set();
        calendarRows.forEach((leave) => {
            const start = parseIsoDate(leave.start_date);
            const end = parseIsoDate(leave.end_date || leave.start_date);
            if (!start || !end) return;
            if (dateInRange(today, start, end)) {
                outToday.add(leave.employee_id || leave.employee_email || leave.request_id || Math.random());
            }
        });

        if (statOut) statOut.textContent = String(outToday.size);
        if (statTotal) statTotal.textContent = String(monthRows.length);
    }

    function getRequestId(req) {
        return req.request_id || req.leave_id || req.id;
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
            const qs = new URLSearchParams({
                request_id: requestId,
                decision: decision
            }).toString();
            await apiRequest(`/leave/approve?${qs}`, 'GET');
            showToast(`Leave request ${decision.toLowerCase()} successfully.`, 'success');
            await refreshHrDashboard();
        } catch (error) {
            console.error('HR decision failed', error);
        } finally {
            setButtonLoading(button, false);
        }
    }

    async function loadCalendarData() {
        const response = await apiRequest('/leave/calendar', 'GET');
        calendarRows = Array.isArray(response) ? response : (response.items || response.data || []);
        renderCalendar();
        updateCalendarStats();
    }

    async function refreshHrDashboard() {
        try {
            await Promise.all([loadPendingApprovals(), loadCalendarData()]);
        } catch (error) {
            console.error('HR dashboard load failed', error);
        }
    }

    async function loadLeaveTypeOptions() {
        const quotaType = document.getElementById('allot-leave-type');
        const configType = document.getElementById('config-leave-type');
        try {
            const configResponse = await apiRequest('/leave/config', 'GET');
            const rows = Array.isArray(configResponse) ? configResponse : (configResponse.data || []);
            if (!Array.isArray(rows) || rows.length === 0) return;

            if (quotaType) quotaType.innerHTML = '';
            if (configType) configType.innerHTML = '';

            rows.forEach((item) => {
                const leaveType = String(item.leave_type || item.type || '').trim();
                if (!leaveType) return;
                const label = item.display_name || leaveType;
                if (quotaType) {
                    const opt = document.createElement('option');
                    opt.value = leaveType.toUpperCase();
                    opt.textContent = label;
                    quotaType.appendChild(opt);
                }
                if (configType) {
                    const opt2 = document.createElement('option');
                    opt2.value = leaveType.toUpperCase();
                    opt2.textContent = label;
                    configType.appendChild(opt2);
                }
            });
        } catch (e) {
            console.warn('Leave config unavailable for HR forms.');
        }
    }

    function bindQuotaForm() {
        const quotaForm = document.getElementById('allot-leave-form');
        if (!quotaForm) return;

        quotaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = quotaForm.querySelector('button[type="submit"]');
            setButtonLoading(submitBtn, true, 'Allocating...');
            try {
                await apiRequest('/leave/quota/update', 'PUT', {
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

    function bindConfigForm() {
        const configForm = document.getElementById('config-update-form');
        if (!configForm) return;

        configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = configForm.querySelector('button[type="submit"]');
            setButtonLoading(submitBtn, true, 'Updating...');
            try {
                await apiRequest('/leave/update', 'PUT', {
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

    function bindReportButtons() {
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
    }

    async function downloadReport(format) {
        const token = authStorage.get('idToken');
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

    const refreshMs = 45000;
    setInterval(() => {
        if (document.hidden) return;
        refreshHrDashboard();
    }, refreshMs);
});
