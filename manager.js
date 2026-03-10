document.addEventListener('DOMContentLoaded', () => {
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

    init();

    async function init() {
        const handledSignedLink = await processSignedApprovalLink();
        if (handledSignedLink) return;
        initDashboard();
    }

    async function processSignedApprovalLink() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        const requestId = params.get('request_id');
        const decisionParam = String(params.get('decision') || '').toUpperCase();
        if (!token || !requestId || !decisionParam) return false;

        const decision = decisionParam === 'REJECT' ? 'REJECTED' : 'APPROVED';
        try {
            const qs = new URLSearchParams({
                request_id: requestId,
                decision: decision,
                token: token
            }).toString();
            await apiRequest(`/leave/approve?${qs}`, 'GET');
            showToast(`Signed link processed: ${decision.toLowerCase()}`, 'success');
        } catch (error) {
            showToast('Signed approval link is invalid or expired.', 'error');
        }

        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1200);
        return true;
    }

    function initDashboard() {
        const payload = checkCognitoAuth(['Manager', 'HR_Admin']);
        if (!payload) return;

        const userEmail = payload.email || authStorage.get('userEmail');
        if (userEmail) {
            document.getElementById('user-name').textContent = userEmail.split('@')[0];
            document.getElementById('user-role').textContent = authStorage.get('role') || 'Manager';
        }

        const role = authStorage.get('role');
        if (role === 'HR_Admin') {
            const hrSection = document.getElementById('hr-admin-section');
            if (hrSection) hrSection.style.display = 'block';
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

        bindQuotaUpdate();
        bindReportButtons();
        loadLeaveTypeOptions();
        refreshManagerDashboard();
    }

    async function loadLeaveTypeOptions() {
        const select = document.getElementById('quota-leave-type');
        if (!select) return;
        try {
            const configResponse = await apiRequest('/leave/config', 'GET');
            const rows = Array.isArray(configResponse) ? configResponse : (configResponse.data || []);
            if (!Array.isArray(rows) || rows.length === 0) return;
            select.innerHTML = '';
            rows.forEach((item) => {
                const leaveType = String(item.leave_type || item.type || '').trim();
                if (!leaveType) return;
                const option = document.createElement('option');
                option.value = leaveType.toUpperCase();
                option.textContent = item.display_name || leaveType;
                select.appendChild(option);
            });
        } catch (e) {
            console.warn('Leave config unavailable for quota form.');
        }
    }

    function bindQuotaUpdate() {
        const quotaForm = document.getElementById('quota-update-form');
        if (!quotaForm) return;

        quotaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = quotaForm.querySelector('button[type="submit"]');
            setButtonLoading(submitBtn, true, 'Updating...');
            try {
                await apiRequest('/leave/quota/update', 'PUT', {
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

    function getTypeColor(type) {
        const key = String(type || '').toUpperCase();
        if (key === 'SICK') return 'red';
        if (key === 'CASUAL') return 'green';
        if (key === 'UNPAID') return 'orange';
        return 'blue';
    }

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

    async function loadPendingApprovals() {
        const list = document.getElementById('approval-list-container');
        if (list) list.innerHTML = '<li style="padding:20px; text-align:center;">Loading pending approvals...</li>';

        const response = await apiRequest('/leave/pending', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);
        document.getElementById('stat-pending').textContent = Array.isArray(rows) ? rows.length : 0;

        if (!list) return;
        list.innerHTML = '';
        if (!Array.isArray(rows) || rows.length === 0) {
            list.innerHTML = '<li style="padding:20px; text-align:center;">No pending approvals.</li>';
            return;
        }

        rows.forEach((req) => {
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
                    <span style="font-size: 0.8rem; color: #64748b;">Approve/Reject via signed email link</span>
                </div>
            `;
            list.appendChild(li);
        });
    }

    async function loadCalendarData() {
        const response = await apiRequest('/leave/calendar', 'GET');
        calendarRows = Array.isArray(response) ? response : (response.items || response.data || []);
        renderCalendar();
        updateCalendarStats();
    }

    async function refreshManagerDashboard() {
        try {
            await Promise.all([loadPendingApprovals(), loadCalendarData()]);
        } catch (error) {
            console.error('Manager dashboard load failed', error);
        }
    }

    async function downloadReport(format) {
        const token = authStorage.get('idToken');
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

    const refreshMs = 45000;
    setInterval(() => {
        if (document.hidden) return;
        refreshManagerDashboard();
    }, refreshMs);
});
