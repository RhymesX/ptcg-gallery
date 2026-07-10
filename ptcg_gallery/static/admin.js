async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body,
    });
    if (response.status === 403) throw new Error('无权操作，仅管理员可用');
    if (!response.ok) {
        let msg = `HTTP ${response.status}`;
        try { const e = await response.json(); if (e?.error) msg = e.error; } catch (_) {}
        throw new Error(msg);
    }
    return response.json();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = 'status-line';
    if (type === 'success') el.style.color = 'var(--success)';
    else if (type === 'warning') el.style.color = 'var(--danger)';
    else el.style.color = '';
}

// ── 账号管理 ───────────────────────────────────────────

const els = {
    accountSelect: document.getElementById('adminAccountSelect'),
    resetPasswordInput: document.getElementById('adminResetPasswordInput'),
    resetBtn: document.getElementById('adminResetBtn'),
    deleteBtn: document.getElementById('adminDeleteAccountBtn'),
    accountStatus: document.getElementById('accountStatus'),
    generateInviteBtn: document.getElementById('generateInviteBtn'),
    inviteCodeList: document.getElementById('inviteCodeList'),
    inviteStatus: document.getElementById('inviteStatus'),
    toggleInviteBtn: document.getElementById('toggleInviteBtn'),
    offBtn: document.getElementById('crawlerOffBtn'),
    demandBtn: document.getElementById('crawlerDemandBtn'),
    onBtn: document.getElementById('crawlerOnBtn'),
    scheduledBtn: document.getElementById('crawlerScheduledBtn'),
    modeLabel: document.getElementById('crawlerModeLabel'),
    crawlerStatus: document.getElementById('crawlerStatus'),
};

async function loadAccounts() {
    const payload = await api('/api/accounts');
    const items = payload?.items || [];
    if (els.accountSelect) {
        els.accountSelect.innerHTML = items
            .filter(item => String(item.name) !== 'RhymesX')
            .map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
            .join('');
    }
}

async function resetPassword() {
    const accountId = Number(els.accountSelect?.value || 0);
    if (!accountId) {
        setStatus(els.accountStatus, '请选择要重置的目标账号。', 'warning');
        return;
    }
    const newPassword = (els.resetPasswordInput?.value || '').trim();
    if (!newPassword || newPassword.length < 4) {
        setStatus(els.accountStatus, '新密码至少需要 4 位。', 'warning');
        return;
    }
    const targetName = els.accountSelect?.options[els.accountSelect.selectedIndex]?.textContent || accountId;
    if (!confirm(`确认重置账号"${targetName}"的密码为"${newPassword}"？`)) return;
    try {
        await api(`/api/accounts/${accountId}/password`, { method: 'PUT', body: { newPassword } });
        if (els.resetPasswordInput) els.resetPasswordInput.value = '';
        setStatus(els.accountStatus, `已重置账号"${targetName}"的密码。`, 'success');
    } catch (error) {
        setStatus(els.accountStatus, error.message, 'warning');
    }
}

async function deleteAccount() {
    const accountId = Number(els.accountSelect?.value || 0);
    if (!accountId) {
        setStatus(els.accountStatus, '请选择要删除的目标账号。', 'warning');
        return;
    }
    const targetName = els.accountSelect?.options[els.accountSelect.selectedIndex]?.textContent || accountId;
    if (!confirm(`确定要删除账号"${targetName}"吗？\n\n该账号的所有卡组和库存数据将被永久删除，无法恢复。`)) return;
    try {
        await api(`/api/accounts/${accountId}`, { method: 'DELETE' });
        await loadAccounts();
        setStatus(els.accountStatus, `已删除账号"${targetName}"。`, 'success');
    } catch (error) {
        setStatus(els.accountStatus, error.message, 'warning');
    }
}

// ── 邀请码管理 ───────────────────────────────────────────

async function loadInviteCodes() {
    try {
        const data = await api('/api/invite-codes');
        const codes = data?.codes || [];
        if (!els.inviteCodeList) return;
        if (codes.length === 0) {
            els.inviteCodeList.innerHTML = '<p id="inviteEmptyMsg">暂无有效邀请码</p>';
            return;
        }
        els.inviteCodeList.innerHTML = codes.map(c => {
            const expiresAt = c.expiresAt ? new Date(c.expiresAt + 'Z').toLocaleString('zh-CN') : '-';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
                <code style="font-size:14px;font-weight:700;">${escapeHtml(c.code)}</code>
                <span style="color:var(--muted);">失效: ${expiresAt}</span>
            </div>`;
        }).join('');
    } catch (error) {
        setStatus(els.inviteStatus, error.message, 'warning');
    }
}

async function generateInviteCode() {
    try {
        await api('/api/invite-codes', { method: 'POST' });
        await loadInviteCodes();
        setStatus(els.inviteStatus, '邀请码已生成，有效期 24 小时。', 'success');
    } catch (error) {
        setStatus(els.inviteStatus, error.message, 'warning');
    }
}

async function loadInviteSetting() {
    const btn = els.toggleInviteBtn;
    if (!btn) return;
    try {
        const data = await api('/api/settings/registration');
        btn.textContent = data.requireInvite ? '已开启（点击关闭）' : '已关闭（点击开启）';
        btn.className = data.requireInvite ? 'danger' : '';
        btn.dataset.enabled = data.requireInvite ? '1' : '0';
    } catch (e) {
        btn.textContent = '获取失败';
    }
}

async function toggleInviteRequired() {
    const btn = els.toggleInviteBtn;
    if (!btn) return;
    const current = btn.dataset.enabled === '1';
    try {
        await api('/api/settings/registration', { method: 'PUT', body: { requireInvite: !current } });
        await loadInviteSetting();
    } catch (error) {
        alert('操作失败：' + error.message);
    }
}

// ── 爬虫控制 ──────────────────────────────────────────────

const MODE_LABELS = { off: '仅本地', demand: '点开下载', on: '持续爬取', scheduled: '凌晨3点' };
const MODE_STATUS = {
    off: '当前：仅本地图片（不自动下载）',
    demand: '当前：点击卡牌详情时下载该卡图片',
    on: '当前：持续爬取 + 自动下载',
    scheduled: '当前：凌晨3点定时 + 自动下载',
};

async function setCrawlerMode(mode) {
    try {
        const result = await api('/api/crawler/mode', { method: 'PUT', body: { mode } });
        if (result.ok) updateCrawlerUI(mode);
    } catch (error) {
        if (els.crawlerStatus) els.crawlerStatus.textContent = '爬虫模式切换失败: ' + error.message;
    }
}

function updateCrawlerUI(mode) {
    const btnMap = { off: els.offBtn, demand: els.demandBtn, on: els.onBtn, scheduled: els.scheduledBtn };
    Object.entries(btnMap).forEach(([m, btn]) => {
        if (!btn) return;
        btn.classList.toggle('is-active', m === mode);
    });
    if (els.modeLabel) els.modeLabel.textContent = MODE_LABELS[mode] || mode;
    if (els.crawlerStatus) els.crawlerStatus.textContent = MODE_STATUS[mode] || '';
}

async function loadCrawlerStatus() {
    try {
        const stats = await api('/api/crawler/status');
        updateCrawlerUI(stats.mode || 'off');
        if (stats.total_cards > 0 && (stats.mode === 'on' || stats.running)) {
            const pct = Math.round((stats.cached / stats.total_cards) * 100);
            if (els.crawlerStatus) {
                els.crawlerStatus.textContent =
                    `爬取中：${stats.cached}/${stats.total_cards} (${pct}%)  |  简中 ${stats.zh_downloaded}  英文 ${stats.en_downloaded}`;
            }
        }
    } catch (_) {
        updateCrawlerUI('off');
    }
}

// ── 事件绑定与初始化 ──────────────────────────────────────

els.resetBtn?.addEventListener('click', resetPassword);
els.resetPasswordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); resetPassword(); }
});
els.deleteBtn?.addEventListener('click', deleteAccount);
els.generateInviteBtn?.addEventListener('click', generateInviteCode);
els.toggleInviteBtn?.addEventListener('click', toggleInviteRequired);

function initCrawlerControls() {
    if (els.offBtn) els.offBtn.addEventListener('click', () => setCrawlerMode('off'));
    if (els.demandBtn) els.demandBtn.addEventListener('click', () => setCrawlerMode('demand'));
    if (els.onBtn) els.onBtn.addEventListener('click', () => setCrawlerMode('on'));
    if (els.scheduledBtn) els.scheduledBtn.addEventListener('click', () => setCrawlerMode('scheduled'));
    loadCrawlerStatus();
    setInterval(loadCrawlerStatus, 10000);
}

(async function init() {
    await Promise.all([loadAccounts(), loadInviteCodes(), loadInviteSetting()]);
    initCrawlerControls();
})();
