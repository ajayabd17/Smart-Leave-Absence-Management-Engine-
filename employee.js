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
                return;
            }

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
        await Promise.all([loadLeaveBalances(), loadLeaveHistory(), loadLeaveConfig()]);
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
                const selectedType = normalizeType(payloadBody.leave_type);
                const requestedDays = calculateRequestedDays(payloadBody.start_date, payloadBody.end_date);
                if (requestedDays === null) {
                    showToast('Please select a valid leave date range.', 'error');
                    return;
                }

                const selectedBalance = currentBalancesByType[selectedType];
                if (selectedBalance && Number(requestedDays) > Number(selectedBalance.remaining)) {
                    showToast(`Insufficient ${selectedType.toUpperCase()} balance. Apply for ${selectedBalance.remaining} day(s) or fewer.`, 'error');
                    return;
                }

                await apiRequest('/leave/apply', 'POST', payloadBody);
                showToast('Leave request submitted successfully!', 'success');
                applyLeaveForm.reset();
                await Promise.all([loadLeaveBalances(), loadLeaveHistory()]);
            } catch (error) {
                console.error('Error submitting leave request', error);
            } finally {
                setButtonLoading(submitBtn, false);
            }
        });
    }

    refreshEmployeeDashboard();

    const refreshMs = 45000;
    setInterval(() => {
        if (document.hidden) return;
        refreshEmployeeDashboard();
    }, refreshMs);
});
