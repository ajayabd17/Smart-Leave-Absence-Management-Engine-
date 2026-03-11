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
    let selectedDateKey = todayKey;
    let calendarRows = [];
    let managerNotificationItems = [];
    let managerNotificationTab = 'inbox';
    const managerNotificationState = { initialized: false };
    let currentManagerEmail = '';

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
        setupManagerNotifications(payload);

        const userEmail = payload.email || authStorage.get('userEmail');
        if (userEmail) {
            currentManagerEmail = String(userEmail).trim().toLowerCase();
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

    function normalizeValue(value) {
        return String(value || '').trim().toUpperCase();
    }

    function isManagerVisibleItem(row) {
        const stage = normalizeValue(row.approval_stage || row.stage);
        const status = normalizeValue(row.status);
        const assignedManagerEmail = String(
            row.manager_email ||
            row.managerEmail ||
            (row.manager && row.manager.email) ||
            ''
        ).trim().toLowerCase();

        // If backend includes manager assignment, restrict queue to logged-in manager only.
        if (assignedManagerEmail && currentManagerEmail && assignedManagerEmail !== currentManagerEmail) {
            return false;
        }
        const visibleStatuses = new Set([
            'PENDING',
            'MANAGER_APPROVED',
            'HR_APPROVED',
            'APPROVED',
            'REJECTED',
            'AUTO_REJECTED'
        ]);
        if (status && visibleStatuses.has(status)) return true;
        return stage === 'MANAGER' || stage === '';
    }

    function isManagerPendingItem(row) {
        return normalizeValue(row.status) === 'PENDING' && (normalizeValue(row.approval_stage || row.stage) === 'MANAGER' || normalizeValue(row.approval_stage || row.stage) === '');
    }

    function statusBadgeClass(status) {
        const key = normalizeValue(status);
        if (key === 'APPROVED' || key === 'HR_APPROVED' || key === 'MANAGER_APPROVED') return 'approved';
        if (key === 'REJECTED' || key === 'AUTO_REJECTED') return 'rejected';
        return 'pending';
    }

    function statusLabel(status) {
        const key = normalizeValue(status);
        if (key === 'MANAGER_APPROVED') return 'MANAGER APPROVED';
        if (key === 'HR_APPROVED') return 'HR APPROVED';
        if (key === 'AUTO_REJECTED') return 'AUTO REJECTED';
        return key || 'PENDING';
    }

    function safeText(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function isCalendarApprovedItem(row) {
        const stage = normalizeValue(row.approval_stage || row.stage);
        const status = normalizeValue(row.status);
        if (!status) return true;
        if (status === 'APPROVED') return true;
        if (status === 'HR_APPROVED' && stage === 'FINAL') return true;
        return false;
    }

    function setupManagerNotifications(payload) {
        const userKey = payload.sub || payload.email || authStorage.get('userEmail') || 'manager';
        const storagePrefix = `manager_notif_${userKey}`;
        const seenKey = `${storagePrefix}_seen`;
        const archiveKey = `${storagePrefix}_archived`;
        const feedKey = `${storagePrefix}_feed`;
        const pendingSnapshotKey = `${storagePrefix}_pending_snapshot`;

        const notificationBtn = document.getElementById('manager-notification-btn');
        const notificationBadge = document.getElementById('manager-notification-badge');
        const notificationPanel = document.getElementById('manager-notification-panel');
        const notificationList = document.getElementById('manager-notification-list');
        const markAllReadBtn = document.getElementById('manager-mark-all-read-btn');
        const tabInboxBtn = document.getElementById('manager-notif-tab-inbox');
        const tabArchivedBtn = document.getElementById('manager-notif-tab-archived');
        const inboxCount = document.getElementById('manager-notif-inbox-count');
        const archivedCount = document.getElementById('manager-notif-archived-count');

        function loadJson(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (e) {
                return fallback;
            }
        }

        function saveJson(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        }

        function getArchivedSet() {
            return new Set(loadJson(archiveKey, []));
        }

        function setArchivedSet(setVal) {
            saveJson(archiveKey, Array.from(setVal));
        }

        function itemId(item) {
            return item.event_id || `${item.request_id || 'req'}::${item.event_type || 'GEN'}`;
        }

        function parseTs(item) {
            const ts = item.created_at ? Date.parse(item.created_at) : NaN;
            return Number.isNaN(ts) ? 0 : ts;
        }

        function relativeTime(item) {
            const ts = parseTs(item);
            if (!ts) return 'just now';
            const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
            if (sec < 60) return `${sec}s ago`;
            const min = Math.floor(sec / 60);
            if (min < 60) return `${min}m ago`;
            const hr = Math.floor(min / 60);
            if (hr < 24) return `${hr}h ago`;
            return `${Math.floor(hr / 24)}d ago`;
        }

        function statusClassFromType(eventType) {
            if (eventType === 'NEW_PENDING') return 'status-submitted';
            if (eventType === 'STATUS_APPROVED' || eventType === 'STATUS_MANAGER_APPROVED' || eventType === 'STATUS_HR_APPROVED') return 'status-approved';
            if (eventType === 'STATUS_REJECTED' || eventType === 'STATUS_AUTO_REJECTED') return 'status-rejected';
            if (eventType === 'REMOVED_FROM_QUEUE') return 'status-manager';
            return 'status-submitted';
        }

        function titleFromEvent(item) {
            if (item.event_type === 'NEW_PENDING') {
                return `New leave request from ${item.employee_id || 'Employee'}`;
            }
            if (item.event_type === 'STATUS_MANAGER_APPROVED') {
                return `Manager approved request ${item.request_id} (waiting for HR)`;
            }
            if (item.event_type === 'STATUS_HR_APPROVED' || item.event_type === 'STATUS_APPROVED') {
                return `Request ${item.request_id} finalized as approved`;
            }
            if (item.event_type === 'STATUS_REJECTED' || item.event_type === 'STATUS_AUTO_REJECTED') {
                return `Request ${item.request_id} finalized as rejected`;
            }
            if (item.event_type === 'REMOVED_FROM_QUEUE') {
                return `Request ${item.request_id} removed from pending queue`;
            }
            return item.title || 'Queue updated';
        }

        function appendEvent(event) {
            const id = event.event_id || `${event.request_id || 'req'}::${event.event_type || 'GEN'}`;
            if (managerNotificationItems.some((x) => itemId(x) === id)) return;
            managerNotificationItems.unshift({
                ...event,
                event_id: id,
                created_at: event.created_at || new Date().toISOString()
            });
            managerNotificationItems = managerNotificationItems.slice(0, 120);
            saveJson(feedKey, managerNotificationItems);
        }

        function updateBadge() {
            if (!notificationBadge) return;
            const archived = getArchivedSet();
            const seenTs = Number(localStorage.getItem(seenKey) || '0');
            const unread = managerNotificationItems.filter((x) => !archived.has(itemId(x)) && parseTs(x) > seenTs).length;
            if (unread > 0) {
                notificationBadge.style.display = 'inline-flex';
                notificationBadge.textContent = unread > 99 ? '99+' : String(unread);
            } else {
                notificationBadge.style.display = 'none';
                notificationBadge.textContent = '0';
            }
        }

        function renderPanel() {
            if (!notificationList) return;
            const archived = getArchivedSet();
            const seenTs = Number(localStorage.getItem(seenKey) || '0');
            const view = managerNotificationItems.map((x) => ({
                item: x,
                archived: archived.has(itemId(x)),
                unread: parseTs(x) > seenTs
            }));
            const filtered = view.filter((x) => managerNotificationTab === 'inbox' ? !x.archived : x.archived);

            if (inboxCount) inboxCount.textContent = String(view.filter((x) => !x.archived).length);
            if (archivedCount) archivedCount.textContent = String(view.filter((x) => x.archived).length);

            notificationList.innerHTML = '';
            if (!filtered.length) {
                notificationList.innerHTML = '<li class="notification-empty">No notifications yet.</li>';
                return;
            }

            const section = document.createElement('li');
            section.className = 'notification-section';
            section.textContent = managerNotificationTab === 'inbox' ? 'Recent' : 'Previously';
            notificationList.appendChild(section);

            filtered.forEach((entry) => {
                const x = entry.item;
                const li = document.createElement('li');
                li.className = `notification-item${entry.unread ? ' unread' : ''}`;
                li.innerHTML = `
                    <div class="notification-avatar">M</div>
                    <div class="notification-content">
                        <div class="notification-row">
                            <div class="notification-title">${titleFromEvent(x)}</div>
                            <div class="notification-date">${x.created_at ? new Date(x.created_at).toLocaleDateString() : '-'}</div>
                        </div>
                        <div class="notification-meta">${(x.leave_type || '').toUpperCase()} | ${x.start_date || '-'} to ${x.end_date || '-'}</div>
                        <div class="notification-row">
                            <div class="notification-time">${relativeTime(x)}</div>
                            <span class="notification-status ${statusClassFromType(x.event_type)}">${x.event_type === 'NEW_PENDING' ? 'Pending' : 'Status update'}</span>
                        </div>
                    </div>
                    ${entry.unread ? '<span class="notification-dot"></span>' : ''}
                `;
                li.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const setVal = getArchivedSet();
                    const id = itemId(x);
                    if (setVal.has(id)) setVal.delete(id);
                    else setVal.add(id);
                    setArchivedSet(setVal);
                    renderPanel();
                    updateBadge();
                });
                notificationList.appendChild(li);
            });
        }

        function statusToEventType(status) {
            const s = normalizeValue(status);
            if (s === 'MANAGER_APPROVED') return 'STATUS_MANAGER_APPROVED';
            if (s === 'HR_APPROVED') return 'STATUS_HR_APPROVED';
            if (s === 'APPROVED') return 'STATUS_APPROVED';
            if (s === 'REJECTED') return 'STATUS_REJECTED';
            if (s === 'AUTO_REJECTED') return 'STATUS_AUTO_REJECTED';
            return '';
        }

        function setPendingNotifications(rows) {
            const snapshot = loadJson(pendingSnapshotKey, {});
            const next = {};
            (rows || []).forEach((r) => {
                const reqId = r.request_id || r.id || r.leave_id;
                if (!reqId) return;
                next[reqId] = {
                    employee_id: r.employee_id || '',
                    employee_email: r.employee_email || '',
                    leave_type: r.leave_type || '',
                    start_date: r.start_date || '',
                    end_date: r.end_date || '',
                    status: r.status || '',
                    approval_stage: r.approval_stage || ''
                };
            });

            const prevIds = new Set(Object.keys(snapshot));
            const nextIds = new Set(Object.keys(next));

            if (!managerNotificationState.initialized) {
                Object.keys(next).forEach((reqId) => {
                    appendEvent({
                        event_type: 'NEW_PENDING',
                        request_id: reqId,
                        ...next[reqId]
                    });
                });
                managerNotificationState.initialized = true;
            } else {
                nextIds.forEach((reqId) => {
                    const prev = snapshot[reqId] || {};
                    const curr = next[reqId] || {};
                    if (!prevIds.has(reqId)) {
                        appendEvent({
                            event_type: 'NEW_PENDING',
                            request_id: reqId,
                            ...next[reqId]
                        });
                    } else if (normalizeValue(prev.status) !== normalizeValue(curr.status)) {
                        const eventType = statusToEventType(curr.status);
                        if (eventType) {
                            appendEvent({
                                event_type: eventType,
                                event_id: `${reqId}::${eventType}::${Date.now()}`,
                                request_id: reqId,
                                ...curr
                            });
                        }
                    }
                });
                prevIds.forEach((reqId) => {
                    if (!nextIds.has(reqId)) {
                        appendEvent({
                            event_type: 'REMOVED_FROM_QUEUE',
                            request_id: reqId,
                            ...(snapshot[reqId] || {})
                        });
                    }
                });
            }
            saveJson(pendingSnapshotKey, next);
            renderPanel();
            updateBadge();
        }

        window.__setManagerPendingNotifications = setPendingNotifications;

        managerNotificationItems = loadJson(feedKey, []);
        renderPanel();
        updateBadge();

        tabInboxBtn?.addEventListener('click', () => {
            managerNotificationTab = 'inbox';
            tabInboxBtn.classList.add('active');
            tabArchivedBtn?.classList.remove('active');
            renderPanel();
        });
        tabArchivedBtn?.addEventListener('click', () => {
            managerNotificationTab = 'archived';
            tabArchivedBtn.classList.add('active');
            tabInboxBtn?.classList.remove('active');
            renderPanel();
        });
        markAllReadBtn?.addEventListener('click', () => {
            localStorage.setItem(seenKey, String(Date.now()));
            updateBadge();
            renderPanel();
        });
        notificationBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = notificationPanel.style.display === 'block';
            notificationPanel.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) renderPanel();
        });
        document.addEventListener('click', (e) => {
            if (notificationPanel && notificationBtn && !notificationPanel.contains(e.target) && !notificationBtn.contains(e.target)) {
                notificationPanel.style.display = 'none';
            }
        });
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
                if (leaveType.toLowerCase() === 'unpaid') return;
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
                const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=980,height=700');
                try {
                    await downloadReport('pdf', printWindow);
                    showToast('PDF report downloaded.', 'success');
                } catch (error) {
                    if (printWindow && !printWindow.closed) {
                        printWindow.close();
                    }
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

    function buildTypeMarkers(leaveItems) {
        const seen = new Set();
        const colors = [];
        (leaveItems || []).forEach((item) => {
            const color = getTypeColor(item.leave_type);
            if (!seen.has(color)) {
                seen.add(color);
                colors.push(color);
            }
        });
        return colors.slice(0, 4);
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
        const dayOnly = new Date(day.getFullYear(), day.getMonth(), day.getDate());
        const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        return dayOnly.getTime() >= startOnly.getTime() && dayOnly.getTime() <= endOnly.getTime();
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
        const currentMonthPrefix = `${activeMonth.getFullYear()}-${String(activeMonth.getMonth() + 1).padStart(2, '0')}-`;
        if (!String(selectedDateKey || '').startsWith(currentMonthPrefix)) {
            selectedDateKey = `${currentMonthPrefix}01`;
        }

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
            if (key === selectedDateKey) classes.push('selected');
            cell.className = classes.join(' ');

            let html = `${dayNum}`;
            if (leaveItems.length > 0) {
                const markers = buildTypeMarkers(leaveItems)
                    .map((color) => `<span class="dot ${color}"></span>`)
                    .join('');
                html += `<span class="dot-stack">${markers}</span>`;
                const tip = leaveItems
                    .map((x) => `${x.employee_id || 'Employee'} (${x.leave_type || 'Leave'})`)
                    .slice(0, 4)
                    .join('\n');
                cell.setAttribute('title', tip + (leaveItems.length > 4 ? '\n...' : ''));
            }

            cell.innerHTML = html;
            cell.dataset.dateKey = key;
            cell.addEventListener('click', () => {
                selectedDateKey = key;
                renderCalendar();
            });
            calendarGrid.appendChild(cell);
        }

        renderSelectedDateDetails(leaveMap);
    }

    function renderSelectedDateDetails(leaveMap) {
        const parent = calendarGrid?.parentElement;
        if (!parent) return;

        let details = document.getElementById('calendar-day-details');
        if (!details) {
            details = document.createElement('div');
            details.id = 'calendar-day-details';
            details.className = 'calendar-day-details';
            parent.appendChild(details);
        }

        const items = leaveMap.get(selectedDateKey) || [];
        if (!items.length) {
            details.innerHTML = `<strong>${selectedDateKey}</strong>: No team members on approved leave.`;
            return;
        }

        const unique = new Map();
        items.forEach((x) => {
            const key = String(x.employee_id || x.employee_email || x.request_id || '');
            if (!unique.has(key)) unique.set(key, x);
        });
        const list = Array.from(unique.values())
            .map((x) => `${x.employee_id || x.employee_email || 'Employee'} (${String(x.leave_type || 'leave').toLowerCase()})`)
            .join(', ');
        details.innerHTML = `<strong>${selectedDateKey}</strong>: ${list}`;
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
        if (list) list.innerHTML = '<tr><td colspan="6" style="padding:20px; text-align:center;">Loading approvals...</td></tr>';

        const response = await apiRequest('/leave/pending', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);
        const managerRows = rows.filter(isManagerVisibleItem);
        const pendingCount = managerRows.filter(isManagerPendingItem).length;
        if (typeof window.__setManagerPendingNotifications === 'function') {
            window.__setManagerPendingNotifications(managerRows);
        }
        document.getElementById('stat-pending').textContent = String(pendingCount);

        if (!list) return;
        list.innerHTML = '';
        if (!Array.isArray(managerRows) || managerRows.length === 0) {
            list.innerHTML = '<tr><td colspan="6" style="padding:20px; text-align:center;">No requests found.</td></tr>';
            return;
        }

        managerRows.forEach((req) => {
            const status = statusLabel(req.status);
            const badgeClass = statusBadgeClass(req.status);
            const actionText = normalizeValue(req.status) === 'PENDING'
                ? 'Approve/Reject via signed email link'
                : (normalizeValue(req.status) === 'MANAGER_APPROVED'
                    ? 'Waiting for HR approval'
                    : 'Completed');
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div><strong>${safeText(req.employee_id || '-')}</strong></div>
                    <div class="text-muted" style="font-size:12px;">${safeText(req.employee_email || '')}</div>
                </td>
                <td><span class="type-indicator ${getTypeColor(req.leave_type)}"></span>${safeText((req.leave_type || '-').toLowerCase())}</td>
                <td>${safeText(req.start_date || '-')} to ${safeText(req.end_date || '-')}</td>
                <td>${safeText(req.created_at ? new Date(req.created_at).toLocaleDateString() : '-')}</td>
                <td><span class="status-badge ${badgeClass}">${safeText(status)}</span></td>
                <td>${safeText(actionText)}</td>
            `;
            list.appendChild(tr);
        });
    }

    async function loadCalendarData() {
        const response = await apiRequest('/leave/calendar', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);
        calendarRows = rows.filter(isCalendarApprovedItem);
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

    async function downloadReport(format, preopenedWindow = null) {
        const token = authStorage.get('idToken');
        const url = `${API_BASE_URL}/leave/report?format=${format}`;
        let response = null;
        let fetchFailed = false;
        try {
            response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (err) {
            fetchFailed = true;
            console.warn(`Report API fetch failed for ${format}:`, err);
        }

        // Fallback for environments where /leave/report is not deployed yet.
        if ((fetchFailed || !response || !response.ok) && format === 'csv') {
            const csv = buildCsvReportFromCalendar();
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = `leave-report-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(href);
            return;
        }

        if (fetchFailed || !response || !response.ok) {
            if (format === 'pdf') {
                openPrintablePdfFallback('Manager Leave Report', preopenedWindow);
                return;
            }
            throw new Error(`Failed to download ${format}`);
        }
        if (preopenedWindow && !preopenedWindow.closed) {
            preopenedWindow.close();
        }
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

    function buildCsvReportFromCalendar() {
        const headers = ['employee_id', 'leave_type', 'start_date', 'end_date', 'status', 'approval_stage', 'total_days'];
        const rows = calendarRows.map((item) => ([
            item.employee_id || '',
            item.leave_type || '',
            item.start_date || '',
            item.end_date || '',
            item.status || '',
            item.approval_stage || '',
            item.total_days || ''
        ]));
        const all = [headers, ...rows];
        return all
            .map((line) => line
                .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
                .join(','))
            .join('\n');
    }

    function openPrintablePdfFallback(title, preopenedWindow = null) {
        const rows = (calendarRows || []).map((item) => `
            <tr>
                <td>${escapeHtml(item.employee_id || '')}</td>
                <td>${escapeHtml(item.leave_type || '')}</td>
                <td>${escapeHtml(item.start_date || '')}</td>
                <td>${escapeHtml(item.end_date || '')}</td>
                <td>${escapeHtml(item.status || '')}</td>
                <td>${escapeHtml(item.approval_stage || '')}</td>
            </tr>
        `).join('');

        const html = `
            <html>
            <head>
                <title>${escapeHtml(title)}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 24px; }
                    h1 { font-size: 20px; margin-bottom: 4px; }
                    .meta { color: #555; margin-bottom: 16px; font-size: 12px; }
                    table { width: 100%; border-collapse: collapse; font-size: 12px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background: #f4f6f8; }
                </style>
            </head>
            <body>
                <h1>${escapeHtml(title)}</h1>
                <div class="meta">Generated on ${new Date().toLocaleString()}</div>
                <table>
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Type</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Status</th>
                            <th>Stage</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="6">No records</td></tr>'}</tbody>
                </table>
            </body>
            </html>
        `;

        const printWindow = preopenedWindow || window.open('', '_blank', 'noopener,noreferrer,width=980,height=700');
        if (!printWindow) throw new Error('Popup blocked while opening print preview.');
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 350);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    const refreshMs = 10000;
    setInterval(() => {
        if (document.hidden) return;
        refreshManagerDashboard();
    }, refreshMs);
});
