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
    let selectedDateKey = todayKey;
    let calendarRows = [];
    let hrNotificationItems = [];
    let hrNotificationTab = 'inbox';
    const hrNotificationState = { initialized: false };

    const userEmail = payload.email || authStorage.get('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = 'HR Admin';
    }

    setupHrNotifications(payload);

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

    function normalizeValue(value) {
        return String(value || '').trim().toUpperCase();
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

    function isHrVisibleItem(row) {
        const stage = normalizeValue(row.approval_stage || row.stage);
        const status = normalizeValue(row.status);
        if (stage !== 'HR' && status !== 'MANAGER_APPROVED' && status !== 'HR_APPROVED' && status !== 'APPROVED' && status !== 'REJECTED' && status !== 'AUTO_REJECTED') {
            return false;
        }
        return true;
    }

    function isHrPendingItem(row) {
        const stage = normalizeValue(row.approval_stage || row.stage);
        const status = normalizeValue(row.status);
        if (stage === 'FINAL') return false;
        if (status === 'MANAGER_APPROVED') return true;
        if (stage === 'HR' && status === 'PENDING') return true;
        return false;
    }

    function isCalendarApprovedItem(row) {
        const stage = normalizeValue(row.approval_stage || row.stage);
        const status = normalizeValue(row.status);
        if (!status) return true;
        if (status === 'APPROVED') return true;
        if (status === 'HR_APPROVED' && stage === 'FINAL') return true;
        return false;
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

    function setupHrNotifications(authPayload) {
        const userKey = authPayload.sub || authPayload.email || authStorage.get('userEmail') || 'hr';
        const storagePrefix = `hr_notif_${userKey}`;
        const seenKey = `${storagePrefix}_seen`;
        const archiveKey = `${storagePrefix}_archived`;
        const feedKey = `${storagePrefix}_feed`;
        const pendingSnapshotKey = `${storagePrefix}_pending_snapshot`;

        const notificationBtn = document.getElementById('hr-notification-btn');
        const notificationBadge = document.getElementById('hr-notification-badge');
        const notificationPanel = document.getElementById('hr-notification-panel');
        const notificationList = document.getElementById('hr-notification-list');
        const markAllReadBtn = document.getElementById('hr-mark-all-read-btn');
        const tabInboxBtn = document.getElementById('hr-notif-tab-inbox');
        const tabArchivedBtn = document.getElementById('hr-notif-tab-archived');
        const inboxCount = document.getElementById('hr-notif-inbox-count');
        const archivedCount = document.getElementById('hr-notif-archived-count');

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
            return 'status-manager';
        }
        function titleFromEvent(item) {
            if (item.event_type === 'NEW_PENDING') return `New leave request from ${item.employee_id || 'Employee'}`;
            if (item.event_type === 'STATUS_MANAGER_APPROVED') return `Request ${item.request_id} is waiting for HR decision`;
            if (item.event_type === 'STATUS_HR_APPROVED' || item.event_type === 'STATUS_APPROVED') return `Request ${item.request_id} finalized as approved`;
            if (item.event_type === 'STATUS_REJECTED' || item.event_type === 'STATUS_AUTO_REJECTED') return `Request ${item.request_id} finalized as rejected`;
            if (item.event_type === 'REMOVED_FROM_QUEUE') return `Request ${item.request_id} removed from pending queue`;
            return item.title || 'Queue updated';
        }
        function appendEvent(event) {
            const id = event.event_id || `${event.request_id || 'req'}::${event.event_type || 'GEN'}`;
            if (hrNotificationItems.some((x) => itemId(x) === id)) return;
            hrNotificationItems.unshift({
                ...event,
                event_id: id,
                created_at: event.created_at || new Date().toISOString()
            });
            hrNotificationItems = hrNotificationItems.slice(0, 120);
            saveJson(feedKey, hrNotificationItems);
        }
        function updateBadge() {
            if (!notificationBadge) return;
            const archived = getArchivedSet();
            const seenTs = Number(localStorage.getItem(seenKey) || '0');
            const unread = hrNotificationItems.filter((x) => !archived.has(itemId(x)) && parseTs(x) > seenTs).length;
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
            const view = hrNotificationItems.map((x) => ({
                item: x,
                archived: archived.has(itemId(x)),
                unread: parseTs(x) > seenTs
            }));
            const filtered = view.filter((x) => hrNotificationTab === 'inbox' ? !x.archived : x.archived);

            if (inboxCount) inboxCount.textContent = String(view.filter((x) => !x.archived).length);
            if (archivedCount) archivedCount.textContent = String(view.filter((x) => x.archived).length);

            notificationList.innerHTML = '';
            if (!filtered.length) {
                notificationList.innerHTML = '<li class="notification-empty">No notifications yet.</li>';
                return;
            }

            const section = document.createElement('li');
            section.className = 'notification-section';
            section.textContent = hrNotificationTab === 'inbox' ? 'Recent' : 'Previously';
            notificationList.appendChild(section);

            filtered.forEach((entry) => {
                const x = entry.item;
                const li = document.createElement('li');
                li.className = `notification-item${entry.unread ? ' unread' : ''}`;
                li.innerHTML = `
                    <div class="notification-avatar">H</div>
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

            if (!hrNotificationState.initialized) {
                Object.keys(next).forEach((reqId) => {
                    appendEvent({
                        event_type: 'NEW_PENDING',
                        request_id: reqId,
                        ...next[reqId]
                    });
                });
                hrNotificationState.initialized = true;
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

        window.__setHrPendingNotifications = setPendingNotifications;
        window.__appendHrDecisionNotification = (requestId, decision, context = {}) => {
            appendEvent({
                event_type: decision === 'APPROVED' ? 'STATUS_HR_APPROVED' : 'STATUS_REJECTED',
                request_id: requestId,
                leave_type: context.leave_type || '',
                start_date: context.start_date || '',
                end_date: context.end_date || ''
            });
            renderPanel();
            updateBadge();
        };

        hrNotificationItems = loadJson(feedKey, []);
        renderPanel();
        updateBadge();

        tabInboxBtn?.addEventListener('click', () => {
            hrNotificationTab = 'inbox';
            tabInboxBtn.classList.add('active');
            tabArchivedBtn?.classList.remove('active');
            renderPanel();
        });
        tabArchivedBtn?.addEventListener('click', () => {
            hrNotificationTab = 'archived';
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
                html += `<span class="dot ${getTypeColor(leaveItems[0].leave_type)}"></span>`;
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

    function getRequestId(req) {
        return req.request_id || req.leave_id || req.id;
    }

    async function loadPendingApprovals() {
        const listContainer = document.getElementById('approval-list-container');
        listContainer.innerHTML = '<tr><td colspan="6" style="padding:20px; text-align:center;">Loading approvals...</td></tr>';
        const response = await apiRequest('/leave/pending', 'GET');
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);
        const hrRows = rows.filter(isHrVisibleItem);
        const pendingCount = hrRows.filter(isHrPendingItem).length;
        if (typeof window.__setHrPendingNotifications === 'function') {
            window.__setHrPendingNotifications(hrRows);
        }

        document.getElementById('stat-pending').textContent = String(pendingCount);
        listContainer.innerHTML = '';
        if (!Array.isArray(hrRows) || hrRows.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="6" style="padding:20px; text-align:center;">No requests found.</td></tr>';
            return;
        }

        hrRows.forEach((req) => {
            const requestId = getRequestId(req);
            const actionable = isHrPendingItem(req);
            const status = statusLabel(req.status);
            const actionCell = actionable
                ? `<button class="btn btn-primary approve-btn" data-request-id="${safeText(requestId)}" data-leave-type="${safeText(req.leave_type || '')}" style="padding: 5px 10px; font-size: 0.8rem; margin-right: 5px;">Approve</button>
                   <button class="btn btn-outline hover-red reject-btn" data-request-id="${safeText(requestId)}" data-leave-type="${safeText(req.leave_type || '')}" style="padding: 5px 10px; font-size: 0.8rem;">Reject</button>`
                : (normalizeValue(req.status) === 'MANAGER_APPROVED' ? 'Waiting for HR decision' : 'Completed');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div><strong>${safeText(req.employee_id || '-')}</strong></div>
                    <div class="text-muted" style="font-size:12px;">${safeText(req.employee_email || '')}</div>
                </td>
                <td><span class="type-indicator ${getTypeColor(req.leave_type)}"></span>${safeText((req.leave_type || '-').toLowerCase())}</td>
                <td>${safeText(req.start_date || '-')} to ${safeText(req.end_date || '-')}</td>
                <td>${safeText(req.created_at ? new Date(req.created_at).toLocaleDateString() : '-')}</td>
                <td><span class="status-badge ${statusBadgeClass(req.status)}">${safeText(status)}</span></td>
                <td>${actionCell}</td>
            `;
            listContainer.appendChild(tr);
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
        const leaveType = button.getAttribute('data-leave-type') || '';
        setButtonLoading(button, true, decision === 'APPROVED' ? 'Approving...' : 'Rejecting...');
        try {
            const qs = new URLSearchParams({
                request_id: requestId,
                decision: decision
            }).toString();
            await apiRequest(`/leave/approve?${qs}`, 'GET');
            if (typeof window.__appendHrDecisionNotification === 'function') {
                window.__appendHrDecisionNotification(requestId, decision, { leave_type: leaveType });
            }
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
        const rows = Array.isArray(response) ? response : (response.items || response.data || []);
        calendarRows = rows.filter(isCalendarApprovedItem);
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
                if (leaveType.toLowerCase() === 'unpaid') return;
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
                    increment_days: parseInt(document.getElementById('allot-days').value, 10)
                });
                showToast('Leave quota incremented successfully.', 'success');
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
                const payload = {
                    leave_type: document.getElementById('config-leave-type').value.toUpperCase(),
                    annual_quota: parseInt(document.getElementById('config-annual-quota').value, 10)
                };
                await apiRequest('/leave/config/update', 'PUT', payload);
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

        if ((fetchFailed || !response || !response.ok) && format === 'csv') {
            const csv = buildCsvReportFromCalendar();
            const csvBlob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const csvHref = URL.createObjectURL(csvBlob);
            const csvLink = document.createElement('a');
            csvLink.href = csvHref;
            csvLink.download = `leave-report-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(csvLink);
            csvLink.click();
            csvLink.remove();
            URL.revokeObjectURL(csvHref);
            return;
        }

        if (fetchFailed || !response || !response.ok) {
            if (format === 'pdf') {
                throw new Error('PDF report endpoint is unavailable. Deploy /leave/report?format=pdf.');
            }
            throw new Error('Download failed');
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

    const refreshMs = 10000;
    setInterval(() => {
        if (document.hidden) return;
        refreshHrDashboard();
    }, refreshMs);
});
