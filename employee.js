document.addEventListener('DOMContentLoaded', () => {
    const payload = checkCognitoAuth(['Employee']);
    if (!payload) return;

    const userEmail = payload.email || authStorage.get('userEmail');
    if (userEmail) {
        document.getElementById('user-name').textContent = userEmail.split('@')[0];
        document.getElementById('user-role').textContent = authStorage.get('role') || 'Employee';
    }

    const leaveTypeVisuals = {
        annual: { icon: 'fa-solid fa-plane', color: 'green', label: 'Annual Leave' },
        earned: { icon: 'fa-solid fa-plane', color: 'green', label: 'Earned Leave' },
        sick: { icon: 'fa-solid fa-briefcase-medical', color: 'red', label: 'Sick Leave' },
        casual: { icon: 'fa-solid fa-mug-hot', color: 'blue', label: 'Casual Leave' },
        unpaid: { icon: 'fa-solid fa-wallet', color: 'orange', label: 'Unpaid Leave' }
    };
    let currentBalancesByType = {};
    let notificationItems = [];
    let activeNotificationTab = 'inbox';

    const notificationBtn = document.getElementById('employee-notification-btn');
    const notificationBadge = document.getElementById('employee-notification-badge');
    const notificationPanel = document.getElementById('employee-notification-panel');
    const notificationList = document.getElementById('employee-notification-list');
    const markAllReadBtn = document.getElementById('employee-mark-all-read-btn');
    const tabInboxBtn = document.getElementById('notif-tab-inbox');
    const tabArchivedBtn = document.getElementById('notif-tab-archived');
    const inboxCount = document.getElementById('notif-inbox-count');
    const archivedCount = document.getElementById('notif-archived-count');
    const notificationStorageKey = `employee_notifications_seen_${payload.sub || userEmail || 'user'}`;
    const notificationArchiveKey = `employee_notifications_archived_${payload.sub || userEmail || 'user'}`;
    const notificationFeedKey = `employee_notifications_feed_${payload.sub || userEmail || 'user'}`;
    const statusSnapshotKey = `employee_notifications_status_snapshot_${payload.sub || userEmail || 'user'}`;

    function normalizeType(rawType) {
        return String(rawType || '').trim().toLowerCase();
    }

    function calculateRequestedDays(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
        const diffMs = end.getTime() - start.getTime();
        if (diffMs < 0) return null;
        return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
    }

    function mapAutoRejectReason(reason) {
        const key = String(reason || '').toUpperCase();
        if (key === 'INSUFFICIENT_BALANCE') return 'Insufficient leave balance';
        if (key === 'MISSING_BALANCE_RECORD') return 'Leave balance record is missing';
        return key || 'Validation rule';
    }

    function getNotificationTitle(record) {
        const status = String(record.status || '').toUpperCase();
        if (status === 'PENDING') return 'Leave request submitted';
        if (status === 'AUTO_REJECTED') return 'Leave request auto-rejected';
        if (status === 'REJECTED') return 'Leave request rejected';
        if (status === 'MANAGER_APPROVED') return 'Manager approved, waiting HR';
        if (status === 'HR_APPROVED' || status === 'APPROVED') return 'Leave request approved';
        return `Leave status updated: ${status || 'UNKNOWN'}`;
    }

    function getRecordTimestamp(record) {
        const raw = record.updated_at || record.created_at;
        const parsed = raw ? Date.parse(raw) : NaN;
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function notificationId(record) {
        return record.event_id || `${record.request_id || 'req'}::${String(record.status || '').toUpperCase()}`;
    }

    function loadNotificationFeed() {
        try {
            const raw = localStorage.getItem(notificationFeedKey);
            const items = raw ? JSON.parse(raw) : [];
            return Array.isArray(items) ? items : [];
        } catch (e) {
            return [];
        }
    }

    function saveNotificationFeed() {
        localStorage.setItem(notificationFeedKey, JSON.stringify(notificationItems.slice(0, 100)));
    }

    function loadStatusSnapshot() {
        try {
            const raw = localStorage.getItem(statusSnapshotKey);
            const obj = raw ? JSON.parse(raw) : {};
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) {
            return {};
        }
    }

    function saveStatusSnapshot(snapshot) {
        localStorage.setItem(statusSnapshotKey, JSON.stringify(snapshot || {}));
    }

    function appendNotificationEvent(record, overrideTimestamp) {
        const status = String(record.status || '').toUpperCase();
        const requestId = record.request_id || record.leave_id || record.id || 'req';
        const eventId = `${requestId}::${status}`;
        if (notificationItems.some((x) => notificationId(x) === eventId)) return;

        const item = {
            request_id: requestId,
            leave_type: record.leave_type || '',
            start_date: record.start_date || '',
            end_date: record.end_date || '',
            status: status,
            created_at: overrideTimestamp || record.updated_at || record.created_at || new Date().toISOString(),
            event_id: eventId
        };
        notificationItems.push(item);
        notificationItems.sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a));
        notificationItems = notificationItems.slice(0, 100);
        saveNotificationFeed();
    }

    function getArchivedSet() {
        try {
            const raw = localStorage.getItem(notificationArchiveKey);
            const list = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(list) ? list : []);
        } catch (e) {
            return new Set();
        }
    }

    function setArchivedSet(setVal) {
        localStorage.setItem(notificationArchiveKey, JSON.stringify(Array.from(setVal)));
    }

    function relativeTimeFromRecord(record) {
        const ts = getRecordTimestamp(record);
        if (!ts) return 'just now';
        const seconds = Math.max(1, Math.floor((Date.now() - ts) / 1000));
        if (seconds < 60) return `${seconds}s ago`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    }

    function displayDateFromRecord(record) {
        const ts = getRecordTimestamp(record);
        if (!ts) return '-';
        return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function mapStatusToTone(status) {
        const s = String(status || '').toUpperCase();
        if (s === 'REJECTED' || s === 'AUTO_REJECTED') return 'Rejected';
        if (s === 'MANAGER_APPROVED') return 'Manager Approved';
        if (s === 'APPROVED' || s === 'HR_APPROVED') return 'Approved';
        if (s === 'PENDING') return 'Submitted';
        return s || 'Updated';
    }

    function statusClass(status) {
        const s = String(status || '').toUpperCase();
        if (s === 'APPROVED' || s === 'HR_APPROVED') return 'status-approved';
        if (s === 'REJECTED' || s === 'AUTO_REJECTED') return 'status-rejected';
        if (s === 'MANAGER_APPROVED') return 'status-manager';
        return 'status-submitted';
    }

    function buildNotificationView() {
        const archivedSet = getArchivedSet();
        const seenTs = Number(localStorage.getItem(notificationStorageKey) || '0');
        return notificationItems.map((record) => {
            const id = notificationId(record);
            const ts = getRecordTimestamp(record);
            return {
                id,
                record,
                archived: archivedSet.has(id),
                unread: ts > seenTs
            };
        });
    }

    function renderNotifications() {
        if (!notificationList) return;
        const view = buildNotificationView();
        const filtered = view.filter((x) => activeNotificationTab === 'inbox' ? !x.archived : x.archived);

        if (inboxCount) inboxCount.textContent = String(view.filter((x) => !x.archived).length);
        if (archivedCount) archivedCount.textContent = String(view.filter((x) => x.archived).length);

        notificationList.innerHTML = '';
        if (!filtered.length) {
            const emptyLabel = activeNotificationTab === 'inbox' ? 'No notifications yet.' : 'No archived notifications.';
            notificationList.innerHTML = `<li class="notification-empty">${emptyLabel}</li>`;
            return;
        }

        const section = document.createElement('li');
        section.className = 'notification-section';
        section.textContent = activeNotificationTab === 'inbox' ? 'Recent' : 'Previously';
        notificationList.appendChild(section);

        filtered.forEach((item) => {
            const record = item.record;
            const li = document.createElement('li');
            li.className = `notification-item${item.unread ? ' unread' : ''}`;
            const title = getNotificationTitle(record);
            const statusTone = mapStatusToTone(record.status);
            const created = relativeTimeFromRecord(record);
            const dateLabel = displayDateFromRecord(record);
            const type = String(record.leave_type || '').toUpperCase();
            const range = `${record.start_date || '-'} to ${record.end_date || '-'}`;
            li.innerHTML = `
                <div class="notification-avatar">${(type[0] || 'L')}</div>
                <div class="notification-content">
                    <div class="notification-row">
                        <div class="notification-title">${title}</div>
                        <div class="notification-date">${dateLabel}</div>
                    </div>
                    <div class="notification-meta">${type} | ${range}</div>
                    <div class="notification-row">
                        <div class="notification-time">${created}</div>
                        <span class="notification-status ${statusClass(record.status)}">${statusTone}</span>
                    </div>
                </div>
                ${item.unread ? '<span class="notification-dot"></span>' : ''}
            `;
            li.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const archivedSet = getArchivedSet();
                if (item.archived) archivedSet.delete(item.id);
                else archivedSet.add(item.id);
                setArchivedSet(archivedSet);
                renderNotifications();
                updateNotificationBadge();
            });
            notificationList.appendChild(li);
        });
    }

    function updateNotificationBadge() {
        if (!notificationBadge) return;
        const archivedSet = getArchivedSet();
        const seenTs = Number(localStorage.getItem(notificationStorageKey) || '0');
        const unread = notificationItems.filter((x) => {
            const id = notificationId(x);
            return !archivedSet.has(id) && getRecordTimestamp(x) > seenTs;
        }).length;
        if (unread > 0) {
            notificationBadge.style.display = 'inline-flex';
            notificationBadge.textContent = unread > 99 ? '99+' : String(unread);
        } else {
            notificationBadge.style.display = 'none';
            notificationBadge.textContent = '0';
        }
    }

    function setupNotificationsUi() {
        if (!notificationBtn || !notificationPanel) return;

        tabInboxBtn?.addEventListener('click', () => {
            activeNotificationTab = 'inbox';
            tabInboxBtn.classList.add('active');
            tabArchivedBtn?.classList.remove('active');
            renderNotifications();
        });

        tabArchivedBtn?.addEventListener('click', () => {
            activeNotificationTab = 'archived';
            tabArchivedBtn.classList.add('active');
            tabInboxBtn?.classList.remove('active');
            renderNotifications();
        });

        markAllReadBtn?.addEventListener('click', () => {
            localStorage.setItem(notificationStorageKey, String(Date.now()));
            updateNotificationBadge();
            renderNotifications();
        });

        notificationBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = notificationPanel.style.display === 'block';
            notificationPanel.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) renderNotifications();
        });
        document.addEventListener('click', (e) => {
            if (!notificationPanel.contains(e.target) && !notificationBtn.contains(e.target)) {
                notificationPanel.style.display = 'none';
            }
        });
    }

    function showBalancesLoading() {
        const container = document.getElementById('balance-cards');
        container.innerHTML = '<div class="card"><p class="text-muted">Loading leave balances...</p></div>';
    }

    function showHistoryLoading() {
        const body = document.getElementById('leave-history-body');
        body.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Loading leave history...</td></tr>';
    }

    async function loadLeaveConfig() {
        const leaveTypeSelect = document.getElementById('leave-type');
        const previousValue = normalizeType(leaveTypeSelect?.value || '');
        try {
            const configResponse = await apiRequest('/leave/config');
            const configRows = Array.isArray(configResponse) ? configResponse : (configResponse.data || []);
            if (!Array.isArray(configRows) || configRows.length === 0) {
                leaveTypeSelect.innerHTML = '<option value="">No leave types available</option>';
                return;
            }

            leaveTypeSelect.innerHTML = '';
            configRows.forEach((item) => {
                const key = normalizeType(item.leave_type || item.type);
                const label = item.display_name || leaveTypeVisuals[key]?.label || key.toUpperCase();
                const option = document.createElement('option');
                option.value = key;
                option.textContent = label;
                leaveTypeSelect.appendChild(option);
            });

            // Business rule: unpaid leave is always available even without config row.
            if (!Array.from(leaveTypeSelect.options).some((opt) => normalizeType(opt.value) === 'unpaid')) {
                const unpaid = document.createElement('option');
                unpaid.value = 'unpaid';
                unpaid.textContent = 'Unpaid Leave';
                leaveTypeSelect.appendChild(unpaid);
            }

            if (previousValue && Array.from(leaveTypeSelect.options).some((opt) => normalizeType(opt.value) === previousValue)) {
                leaveTypeSelect.value = previousValue;
            }
        } catch (err) {
            console.warn('Leave config API unavailable, using static leave type options.');
            if (!leaveTypeSelect.value) {
                leaveTypeSelect.innerHTML = `
                    <option value="earned">Earned Leave</option>
                    <option value="sick">Sick Leave</option>
                    <option value="casual">Casual Leave</option>
                    <option value="unpaid">Unpaid Leave</option>
                `;
            }
        }
    }

    async function loadLeaveBalances() {
        showBalancesLoading();
        try {
            const raw = await apiRequest('/leave/balance');
            const rows = Array.isArray(raw) ? raw : (raw.balances || raw.data || []);
            const normalized = {};

            if (Array.isArray(rows)) {
                rows.forEach((row) => {
                    const type = normalizeType(row.leave_type || row['leave_type#year']?.split('#')[0]);
                    normalized[type] = {
                        remaining: Number(row.remaining_balance ?? row.remaining ?? 0),
                        total: Number(row.total_quota ?? row.total ?? 0)
                    };
                });
            } else {
                Object.keys(raw || {}).forEach((key) => {
                    const value = raw[key] || {};
                    normalized[normalizeType(key)] = {
                        remaining: Number(value.remaining_balance ?? value.remaining ?? 0),
                        total: Number(value.total_quota ?? value.total ?? 0)
                    };
                });
            }

            const container = document.getElementById('balance-cards');
            const keys = Object.keys(normalized);
            currentBalancesByType = normalized;
            if (keys.length === 0) {
                container.innerHTML = '<div class="card"><p class="text-muted">No leave balances found.</p></div>';
                return;
            }

            container.innerHTML = '';
            keys.forEach((type) => {
                const visual = leaveTypeVisuals[type] || { icon: 'fa-solid fa-calendar-day', color: 'blue', label: type.toUpperCase() };
                const balance = normalized[type];
                const card = document.createElement('div');
                card.className = 'card balance-card';
                card.innerHTML = `
                    <div class="card-icon ${visual.color}"><i class="${visual.icon}"></i></div>
                    <div class="card-details">
                        <h3>${visual.label}</h3>
                        <div class="flex-row">
                            <span class="days-left">${balance.remaining}<span>d</span></span>
                            <span class="total-days">/ ${balance.total}</span>
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });
        } catch (err) {
            const container = document.getElementById('balance-cards');
            container.innerHTML = '<div class="card"><p class="text-muted">Unable to load leave balances.</p></div>';
        }
    }

    async function loadLeaveHistory() {
        showHistoryLoading();
        try {
            const raw = await apiRequest('/leave/history');
            const rows = Array.isArray(raw) ? raw : (raw.history || raw.data || []);
            const historyBody = document.getElementById('leave-history-body');
            historyBody.innerHTML = '';

            if (!Array.isArray(rows) || rows.length === 0) {
                historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">No leave history found.</td></tr>';
                renderNotifications();
                updateNotificationBadge();
                return;
            }

            const previousSnapshot = loadStatusSnapshot();
            const nextSnapshot = {};
            const firstRun = Object.keys(previousSnapshot).length === 0;
            rows.forEach((record) => {
                const requestId = record.request_id || record.leave_id || record.id;
                if (!requestId) return;
                const status = String(record.status || '').toUpperCase();
                nextSnapshot[requestId] = status;
                const previousStatus = previousSnapshot[requestId];
                if (!firstRun && previousStatus && previousStatus !== status) {
                    appendNotificationEvent(record, new Date().toISOString());
                }
            });
            saveStatusSnapshot(nextSnapshot);

            renderNotifications();
            updateNotificationBadge();

            rows.forEach((record) => {
                const statusStr = (record.status || '').toUpperCase();
                let statusClass = 'pending';
                if (statusStr === 'APPROVED') statusClass = 'approved';
                if (statusStr === 'REJECTED' || statusStr === 'AUTO_REJECTED') statusClass = 'rejected';

                const typeStr = normalizeType(record.leave_type);
                let typeColor = 'blue';
                if (typeStr.includes('earned') || typeStr.includes('annual')) typeColor = 'green';
                if (typeStr.includes('unpaid')) typeColor = 'orange';
                if (typeStr.includes('sick')) typeColor = 'red';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><span class="type-indicator ${typeColor}"></span> ${record.leave_type || 'Unknown'}</td>
                    <td>${record.start_date || '-'} to ${record.end_date || '-'}</td>
                    <td>${record.created_at ? new Date(record.created_at).toLocaleDateString() : (record.start_date || '-')}</td>
                    <td><span class="status-badge ${statusClass}">${record.status || 'PENDING'}</span></td>
                `;
                historyBody.appendChild(tr);
            });
        } catch (err) {
            const historyBody = document.getElementById('leave-history-body');
            historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Unable to load leave history.</td></tr>';
        }
    }

    async function refreshEmployeeDashboard() {
        await Promise.all([loadLeaveBalances(), loadLeaveHistory()]);
    }

    const applyLeaveForm = document.getElementById('apply-leave-form');
    const dateFromInput = document.getElementById('date-from');
    const dateToInput = document.getElementById('date-to');

    function setupDateConstraints() {
        if (!dateFromInput || !dateToInput) return;
        const today = new Date();
        const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        dateFromInput.min = minDate;
        dateToInput.min = minDate;

        dateFromInput.addEventListener('change', () => {
            const fromVal = dateFromInput.value;
            if (!fromVal) return;
            dateToInput.min = fromVal;
            if (dateToInput.value && dateToInput.value < fromVal) {
                dateToInput.value = fromVal;
            }
        });
    }

    setupDateConstraints();
    notificationItems = loadNotificationFeed();
    setupNotificationsUi();
    renderNotifications();
    updateNotificationBadge();

    if (applyLeaveForm) {
        applyLeaveForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = applyLeaveForm.querySelector('button[type="submit"]');
            setButtonLoading(submitBtn, true, 'Submitting...');

            const payloadBody = {
                leave_type: String(document.getElementById('leave-type').value || '').toUpperCase(),
                start_date: document.getElementById('date-from').value,
                end_date: document.getElementById('date-to').value,
                reason: document.getElementById('leave-reason').value
            };

            try {
                const requestedDays = calculateRequestedDays(payloadBody.start_date, payloadBody.end_date);
                if (requestedDays === null) {
                    showToast('Please select a valid leave date range.', 'error');
                    return;
                }

                const response = await apiRequest('/leave/apply', 'POST', payloadBody);
                const status = String(response?.status || '').toUpperCase();
                const requestId = response?.request_id;
                if (status === 'AUTO_REJECTED') {
                    const reason = mapAutoRejectReason(response?.reason);
                    showToast(`Leave request auto-rejected: ${reason}.`, 'error');
                    if (requestId) {
                        appendNotificationEvent({
                            request_id: requestId,
                            leave_type: payloadBody.leave_type,
                            start_date: payloadBody.start_date,
                            end_date: payloadBody.end_date,
                            status: 'AUTO_REJECTED',
                            created_at: new Date().toISOString()
                        });
                    }
                } else {
                    showToast('Leave request submitted successfully!', 'success');
                    if (requestId) {
                        appendNotificationEvent({
                            request_id: requestId,
                            leave_type: payloadBody.leave_type,
                            start_date: payloadBody.start_date,
                            end_date: payloadBody.end_date,
                            status: 'PENDING',
                            created_at: new Date().toISOString()
                        });
                    }
                }
                renderNotifications();
                updateNotificationBadge();
                applyLeaveForm.reset();
                await Promise.all([loadLeaveBalances(), loadLeaveHistory()]);
            } catch (error) {
                console.error('Error submitting leave request', error);
            } finally {
                setButtonLoading(submitBtn, false);
            }
        });
    }

    loadLeaveConfig();
    refreshEmployeeDashboard();

    const refreshMs = 10000;
    setInterval(() => {
        if (document.hidden) return;
        refreshEmployeeDashboard();
    }, refreshMs);
});
