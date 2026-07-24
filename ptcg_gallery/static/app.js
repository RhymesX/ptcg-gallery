const LAST_USED_DECK_STORAGE_KEY = 'ptcgGallery:last-used-deck-id';
const LEGACY_SEARCH_REGULATION_STORAGE_KEY = 'ptcgGallery:search-regulations';
const SEARCH_DEBOUNCE_DELAY = 500;

let activeSearchController = null;
let isSearchComposing = false;

const state = {
    selectedCardId: null,
    selectedResultId: null,
    decks: [],
    results: [],
    currentQuery: "",
    availableRegulations: [],
    selectedRegulations: [],
    considerSameNameRegulation: false,
    currentAccount: null,
    isAdmin: false,
    preferredDeckId: loadPreferredDeckId()
};

const EMPTY_DETAIL_HTML = '<div class="empty-state">从左侧搜索并点击一张卡牌后，这里才会显示详情。</div>';

const elements = {
    searchInput: document.getElementById('searchInput'),
    searchRegulationFilters: document.getElementById('searchRegulationFilters'),
    searchSameNameToggle: document.getElementById('searchSameNameRegulationToggle'),
    refreshSearchBtn: document.getElementById('refreshSearchBtn'),
    searchStatus: document.getElementById('searchStatus'),
    resultList: document.getElementById('resultList'),
    cardDetail: document.getElementById('cardDetail'),
    summaryCards: document.getElementById('summaryCards'),
    deckList: document.getElementById('deckList'),
    deckStatus: document.getElementById('deckStatus'),
    deckForm: document.getElementById('deckForm'),
    deckIdInput: document.getElementById('deckIdInput'),
    deckNameInput: document.getElementById('deckNameInput'),
    deckDescriptionInput: document.getElementById('deckDescriptionInput'),
    resetDeckBtn: document.getElementById('resetDeckBtn'),
    currentAccountName: document.getElementById('currentAccountName'),
    accountStatus: document.getElementById('accountStatus'),
    generateBindCodeBtn: document.getElementById('generateBindCodeBtn'),
    bindCodeStatus: document.getElementById('bindCodeStatus'),
    importDefaultCatalogBtn: document.getElementById('importDefaultCatalogBtn'),
    catalogUploadInput: document.getElementById('catalogUploadInput'),
    stateUploadInput: document.getElementById('stateUploadInput'),
    inventoryUploadInput: document.getElementById('inventoryUploadInput')
};

async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            ...(options.headers || {})
        },
        ...options
    });

    if (!response.ok) {
        let message = `请求失败：${response.status}`;
        try {
            const payload = await response.json();
            if (payload.error) {
                message = payload.error;
            }
        } catch (_) {
            // ignore
        }
        throw new Error(message);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }
    return response;
}

function loadPreferredDeckId() {
    try {
        const value = window.localStorage.getItem(LAST_USED_DECK_STORAGE_KEY);
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch (_) {
        return null;
    }
}

function rememberPreferredDeckId(deckId) {
    const parsed = Number(deckId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return;
    }
    state.preferredDeckId = parsed;
    try {
        window.localStorage.setItem(LAST_USED_DECK_STORAGE_KEY, String(parsed));
    } catch (_) {
        // ignore storage failures
    }
}

function displayCardName(card) {
    if (card.showNickname && card.nickname) {
        return card.nickname;
    }
    return card.cardName;
}

function displayCardCode(card) {
    if (card.showNickname && card.nickname) {
        return card.nickname;
    }
    return card.displayCode || `${card.displayProductCode || card.productCode}-${card.displayCardCode || card.cardCode}`;
}

function clearLegacySearchPreferenceStorage() {
    try {
        window.localStorage.removeItem(LEGACY_SEARCH_REGULATION_STORAGE_KEY);
    } catch (_) {
        // ignore storage failures
    }
}

function normalizeSearchPreferenceRegulations(values) {
    if (!Array.isArray(values)) {
        return [];
    }
    return values
        .map((item) => String(item || '').trim())
        .filter((item, index, items) => item && items.indexOf(item) === index);
}

function syncSelectedRegulations() {
    if (!state.availableRegulations.length) {
        state.selectedRegulations = [];
        return;
    }
    const availableSet = new Set(state.availableRegulations);
    state.selectedRegulations = state.selectedRegulations.filter((item) => availableSet.has(item));
}

function applySearchPreferences(preferences = {}) {
    state.selectedRegulations = normalizeSearchPreferenceRegulations(preferences.selectedRegulations);
    state.considerSameNameRegulation = Boolean(preferences.considerSameNameRegulation);
    syncSelectedRegulations();
}

async function persistSearchPreferences() {
    const payload = await api('/api/search/preferences', {
        method: 'PUT',
        body: JSON.stringify({
            selectedRegulations: state.selectedRegulations,
            considerSameNameRegulation: state.considerSameNameRegulation
        })
    });
    applySearchPreferences(payload);
}

function updateSearchSameNameToggle() {
    if (!elements.searchSameNameToggle) {
        return;
    }
    elements.searchSameNameToggle.checked = Boolean(state.considerSameNameRegulation);
    elements.searchSameNameToggle.disabled = !state.availableRegulations.length;
}

function regulationSummaryText() {
    const regulationText = !state.selectedRegulations.length
        ? '当前赛制：不限'
        : `当前赛制：${state.selectedRegulations.join('、')}`;
    if (!state.selectedRegulations.length || !state.considerSameNameRegulation) {
        return regulationText;
    }
    return `${regulationText}；同名卡按赛制组选出`;
}

function getDefaultDeckId() {
    const preferredDeckExists = state.decks.some((deck) => deck.id === state.preferredDeckId);
    if (preferredDeckExists) {
        return state.preferredDeckId;
    }
    return state.decks[0]?.id ?? '';
}

function setStatus(target, message, type = 'normal') {
    target.textContent = message;
    target.className = 'status-line';
    if (type === 'success') {
        target.classList.add('success-text');
    }
    if (type === 'warning') {
        target.classList.add('warning-text');
    }
}

function renderSummary(summary) {
    const cards = [
        { label: '空闲', value: summary.freeCount ?? 0 },
        { label: '在卡组', value: summary.inDeckCount ?? 0 },
        { label: '总持有', value: summary.ownedCount ?? 0, href: '/inventory-table' },
        { label: '卡组', value: summary.deckCount ?? 0, href: '/decks' }
    ];

    elements.summaryCards.innerHTML = cards.map((item) => item.href
        ? `
            <a class="stat-card stat-link" href="${item.href}">
                <span class="value">${item.value}</span>
                <span>${item.label}</span>
            </a>
        `
        : `
            <div class="stat-card">
                <span class="value">${item.value}</span>
                <span>${item.label}</span>
            </div>
        `).join('');
}

function renderAccounts(payload) {
    const current = payload?.current;
    state.isAdmin = Boolean(payload?.isAdmin);
    state.currentAccount = current && typeof current === 'object' ? current : null;
    if (elements.currentAccountName) {
        elements.currentAccountName.textContent = (state.currentAccount?.name || '-') + (state.isAdmin ? ' (管理员)' : '');
    }
}

async function loadAccounts() {
    const payload = await api('/api/accounts');
    renderAccounts(payload);
    return payload;
}

async function generateBindCode() {
    try {
        const data = await api('/api/account/bind-code', { method: 'POST' });
        const codeEl = document.getElementById('bindCodeStatus');
        if (codeEl) {
            codeEl.style.display = 'block';
            codeEl.textContent = '绑定码：' + data.code + '（5 分钟内有效，请在微信小程序中输入）';
            codeEl.style.color = 'var(--success)';
        }
        setTimeout(() => {
            if (codeEl) {
                codeEl.style.display = 'none';
                codeEl.textContent = '';
            }
        }, 300000); // 5 分钟后自动隐藏
    } catch (error) {
        setStatus(elements.bindCodeStatus, error.message, 'warning');
    }
}

// ── 改密弹窗 ───────────────────────────────────────────

(function initChangePwdModal() {
    const overlay = document.getElementById('changePwdOverlay');
    const trigger = document.getElementById('changePwdTrigger');
    const cancelBtn = document.getElementById('changePwdCancel');
    const confirmBtn = document.getElementById('changePwdConfirm');
    const oldInput = document.getElementById('changePwdOld');
    const newInput = document.getElementById('changePwdNew');
    const statusEl = document.getElementById('changePwdStatus');

    function open() {
        if (oldInput) oldInput.value = '';
        if (newInput) newInput.value = '';
        if (statusEl) statusEl.textContent = '';
        if (overlay) overlay.style.display = '';
    }
    function close() {
        if (overlay) overlay.style.display = 'none';
    }

    if (trigger) trigger.addEventListener('click', open);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    async function submit() {
        const oldPassword = (oldInput?.value || '').trim();
        const newPassword = (newInput?.value || '').trim();
        if (!oldPassword || !newPassword) {
            if (statusEl) statusEl.textContent = '原密码和新密码均不能为空';
            return;
        }
        if (newPassword.length < 4) {
            if (statusEl) statusEl.textContent = '新密码至少需要 4 位';
            return;
        }
        try {
            await api('/api/accounts/password', {
                method: 'PUT',
                body: JSON.stringify({ oldPassword, newPassword })
            });
            if (statusEl) { statusEl.style.color = 'var(--success,#2e7d32)'; statusEl.textContent = '密码修改成功'; }
            setTimeout(close, 1200);
        } catch (error) {
            if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = error.message; }
        }
    }

    if (confirmBtn) confirmBtn.addEventListener('click', submit);
    if (newInput) newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
})();

// ── 登出 ───────────────────────────────────────────────

(function initLogout() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/logout';
        document.body.appendChild(form);
        form.submit();
    });
})();

function renderResults() {
    elements.resultList.style.display = '';
    if (!state.results.length) {
        elements.resultList.innerHTML = '<div class="empty-state">没有找到符合条件的卡牌。</div>';
        return;
    }

    elements.resultList.innerHTML = state.results.map((card) => {
        return `
        <article class="result-item ${card.id === state.selectedResultId ? 'active' : ''}" data-card-id="${card.id}">
            <div class="result-main">
                ${renderCardImage(card)}
                <div class="result-info">
                    <div class="result-title">
                        <strong>${escapeHtml(card.cardName)}</strong>
                        <span class="mono">${escapeHtml(displayCardCode(card))}</span>
                    </div>
                    <div class="badges">
                        ${card.displayProductCode ? `<span class="badge">商品编号：${escapeHtml(card.displayProductCode)}</span>` : ''}
                        ${card.rarity ? `<span class="badge">稀有度：${escapeHtml(card.rarity)}</span>` : ''}
                        ${card.attribute ? `<span class="badge">属性：${escapeHtml(card.attribute)}</span>` : ''}
                        ${card.regulation ? `<span class="badge">赛制：${escapeHtml(card.regulation)}</span>` : ''}
                    </div>
                    <div class="inventory-pill-row" style="margin-top: 10px;">
                        <span class="inventory-pill">空闲 ${card.freeQuantity}</span>
                        <span class="inventory-pill">卡组 ${card.deckQuantity}</span>
                        <span class="inventory-pill">总计 ${card.ownedQuantity}</span>
                    </div>
                </div>
            </div>
        </article>
    `;
    }).join('');

    elements.resultList.querySelectorAll('.result-item').forEach((node) => {
        node.addEventListener('click', () => selectCard(Number(node.dataset.cardId)));
    });

    // 始终尝试加载本地缓存图片；若未命中则按下载模式决定是否等待
    initCardImages(elements.resultList, false);
}

function renderRegulationFilters() {
    if (!elements.searchRegulationFilters) {
        return;
    }
    if (!state.availableRegulations.length) {
        elements.searchRegulationFilters.innerHTML = '<span class="muted">当前卡表没有可筛选的赛制。</span>';
        updateSearchSameNameToggle();
        return;
    }

    const selectedRegulations = new Set(state.selectedRegulations);
    elements.searchRegulationFilters.innerHTML = state.availableRegulations.map((regulation) => `
        <label class="search-regulation-chip${selectedRegulations.has(regulation) ? ' is-active' : ''}">
            <input type="checkbox" value="${escapeHtml(regulation)}" ${selectedRegulations.has(regulation) ? 'checked' : ''}>
            <span>${escapeHtml(regulation)}</span>
        </label>
    `).join('');

    elements.searchRegulationFilters.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.addEventListener('change', async () => {
            debouncedSearch.cancel();
            state.selectedRegulations = Array.from(
                elements.searchRegulationFilters.querySelectorAll('input[type="checkbox"]:checked')
            ).map((node) => node.value);
            try {
                await persistSearchPreferences();
                renderRegulationFilters();

                if (elements.searchInput.value.trim()) {
                    await refreshSearch(false);
                } else {
                    setStatus(elements.searchStatus, `请输入关键字后再搜索。${regulationSummaryText()}`, 'normal');
                }
            } catch (error) {
                setStatus(elements.searchStatus, error.message, 'warning');
            }
        });
    });

    updateSearchSameNameToggle();
}

async function loadSearchOptions() {
    const payload = await api('/api/search/options');
    state.availableRegulations = Array.isArray(payload.regulations) ? payload.regulations : [];
    applySearchPreferences(payload.preferences || {});
    renderRegulationFilters();
}

function detailField(label, value) {
    return `
        <div>
            <div class="label">${label}</div>
            <div class="value">${escapeHtml(value || '-')}</div>
        </div>
    `;
}

function formatNumber(value) {
    return Number(value ?? 0).toLocaleString('zh-CN');
}

function importBackupSuffix(result) {
    return result?.autoBackupPath ? ` 自动备份：${result.autoBackupPath}` : '';
}

function buildDeckBreakdown(card) {
    if (!card.deckBreakdown || !card.deckBreakdown.length) {
        return '<div class="muted">当前还没有放入任何卡组。</div>';
    }

    return card.deckBreakdown.map((entry) => `
        <div class="deck-breakdown">
            <div class="result-title">
                <strong>${escapeHtml(entry.deckName)}</strong>
                <span>数量：${entry.quantity}${entry.backupQuantity ? `（备卡 ${entry.backupQuantity}）` : ''}</span>
            </div>
            <div class="inline-actions" style="margin-top: 10px;">
                <button type="button" class="secondary deck-remove-btn" data-deck-id="${entry.deckId}" data-mode="remove">卡组 -1</button>
                <button type="button" class="secondary deck-remove-btn" data-deck-id="${entry.deckId}" data-mode="back">移回空闲 +1</button>
            </div>
        </div>
    `).join('');
}

function deckOptions() {
    if (!state.decks.length) {
        return '<option value="">请先创建卡组</option>';
    }
    const defaultDeckId = getDefaultDeckId();
    return state.decks.map((deck) => `<option value="${deck.id}" ${deck.id === defaultDeckId ? 'selected' : ''}>${escapeHtml(deck.name)}</option>`).join('');
}

function renderCardDetail(card) {
    state.selectedCardId = card.id;
    state.selectedResultId = card.id;
    renderResults();
    elements.cardDetail.innerHTML = `
        <div class="card-detail-header">
            ${renderCardImage(card)}
            <div class="card-detail-info">
                <h3 class="card-title">
                    <span>${escapeHtml(displayCardName(card))}</span>
                    <span class="mono">${escapeHtml(displayCardCode(card))}</span>
                </h3>
                <div class="inventory-pill-row">
                    <span class="inventory-pill">空闲 ${card.freeQuantity}</span>
                    <span class="inventory-pill">卡组 ${card.deckQuantity}</span>
                    <span class="inventory-pill">总持有 ${card.ownedQuantity}</span>
                </div>
            </div>
        </div>

        <div class="inventory-layout">
            <div class="inventory-card">
                <h3>空闲库存</h3>
                <p class="muted">当前值：${formatNumber(card.freeQuantity)}。可以直接加减，也可以一次增加多张。</p>
                <div class="inline-actions">
                    <button type="button" data-action="free-adjust" data-delta="1">空闲 +1</button>
                    <button type="button" class="secondary" data-action="free-adjust" data-delta="-1">空闲 -1</button>
                </div>
                <div class="detail-inline-form">
                    <label>
                        增加数量
                        <input id="detailFreeAddAmount" type="number" min="1" step="1" value="1">
                    </label>
                    <button type="button" data-action="free-add-multi">增加到空闲库存</button>
                </div>
            </div>

            <div class="inventory-card">
                <h3>加入卡组</h3>
                <p class="muted">可选择“新增到卡组”或“从空闲转入卡组”。</p>
                <div class="stack-form">
                    <label>
                        目标卡组
                        <select id="detailDeckId">${deckOptions()}</select>
                    </label>
                    <label>
                        数量
                        <input id="detailDeckAmount" type="number" min="1" value="1">
                    </label>
                    <div class="toolbar compact">
                        <button type="button" data-action="deck-add" ${state.decks.length ? '' : 'disabled'}>直接加入卡组</button>
                        <button type="button" class="secondary" data-action="deck-transfer" ${state.decks.length ? '' : 'disabled'}>空闲转入卡组</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="inventory-card" style="margin-top: 16px;">
            <h3>所在卡组</h3>
            ${buildDeckBreakdown(card)}
        </div>
    `;

    elements.cardDetail.querySelectorAll('[data-action="free-adjust"]').forEach((button) => {
        button.addEventListener('click', async () => {
            await mutateCard(`/api/cards/${card.id}/free-adjust`, { delta: Number(button.dataset.delta) });
        });
    });

    const addFreeButton = elements.cardDetail.querySelector('[data-action="free-add-multi"]');
    if (addFreeButton) {
        addFreeButton.addEventListener('click', async () => {
            const amountInput = document.getElementById('detailFreeAddAmount');
            await mutateCard(
                `/api/cards/${card.id}/adjust-total`,
                { delta: Number(amountInput?.value || 0) }
            );
        });
    }

    const addButton = elements.cardDetail.querySelector('[data-action="deck-add"]');
    const transferButton = elements.cardDetail.querySelector('[data-action="deck-transfer"]');
    if (addButton) {
        addButton.addEventListener('click', async () => handleDeckAdd(card.id, false));
    }
    if (transferButton) {
        transferButton.addEventListener('click', async () => handleDeckAdd(card.id, true));
    }

    const detailDeckSelect = document.getElementById('detailDeckId');
    if (detailDeckSelect) {
        detailDeckSelect.addEventListener('change', () => {
            rememberPreferredDeckId(detailDeckSelect.value);
        });
    }

    elements.cardDetail.querySelectorAll('.deck-remove-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            await mutateCard(`/api/cards/${card.id}/remove-from-deck`, {
                deckId: Number(button.dataset.deckId),
                amount: 1,
                backToFree: button.dataset.mode === 'back'
            });
        });
    });

    // 始终尝试加载本地缓存图片；若未命中则按下载模式决定是否等待
    initCardImages(elements.cardDetail, false);
}

async function mutateCard(url, payload, method = 'POST') {
    try {
        const card = await api(url, {
            method,
            body: JSON.stringify(payload)
        });
        await Promise.all([loadSummary(), refreshSearch(false), loadDecks(false)]);
        renderCardDetail(card);
        return card;
    } catch (error) {
        alert(error.message);
        return null;
    }
}

async function handleDeckAdd(cardId, consumeFree) {
    const deckId = Number(document.getElementById('detailDeckId').value);
    const amount = Number(document.getElementById('detailDeckAmount').value || 1);
    if (!deckId) {
        alert('请先选择卡组');
        return;
    }
    const card = await mutateCard(`/api/cards/${cardId}/add-to-deck`, {
        deckId,
        amount,
        consumeFree
    });
    if (card) {
        rememberPreferredDeckId(deckId);
    }
}

async function selectCard(cardId) {
    try {
        const card = await api(`/api/cards/${cardId}`);
        renderCardDetail(card);
    } catch (error) {
        alert(error.message);
    }
}

async function refreshSearch(focusFirst = true) {
    cancelActiveSearch();
    const query = elements.searchInput.value.trim();
    state.currentQuery = query;
    if (!query) {
        state.results = [];
        state.selectedCardId = null;
        state.selectedResultId = null;
        elements.resultList.innerHTML = '';
        elements.resultList.style.display = 'none';
        elements.cardDetail.innerHTML = EMPTY_DETAIL_HTML;
        setStatus(elements.searchStatus, `请输入关键字后再搜索。${regulationSummaryText()}`, 'normal');
        return;
    }
    const controller = new AbortController();
    activeSearchController = controller;
    try {
        const params = new URLSearchParams({ q: query });
        state.selectedRegulations.forEach((regulation) => {
            params.append('regulation', regulation);
        });
        if (state.considerSameNameRegulation) {
            params.set('considerSameNameRegulation', 'true');
        }
        const payload = await api(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (activeSearchController !== controller) {
            return;
        }
        state.results = payload.items || [];
        setStatus(elements.searchStatus, `找到 ${state.results.length} 张卡牌。当前关键字：${query}。${regulationSummaryText()}`, 'normal');
        renderResults();
        state.selectedCardId = null;
        state.selectedResultId = null;
        elements.cardDetail.innerHTML = state.results.length ? EMPTY_DETAIL_HTML : '<div class="empty-state">没有找到卡牌，请尝试更换关键字。</div>';
    } catch (error) {
        if (error.name !== 'AbortError') {
            setStatus(elements.searchStatus, error.message, 'warning');
        }
    } finally {
        if (activeSearchController === controller) {
            activeSearchController = null;
        }
    }
}

function cancelActiveSearch() {
    activeSearchController?.abort();
    activeSearchController = null;
}

async function loadSummary() {
    const summary = await api('/api/summary');
    renderSummary(summary);
}

function renderDecks() {
    if (!elements.deckList) {
        return;
    }
    if (!state.decks.length) {
        elements.deckList.innerHTML = '<div class="empty-state">还没有卡组，先创建一个吧。</div>';
        return;
    }

    const template = document.getElementById('deckRowTemplate');
    elements.deckList.innerHTML = '';
    state.decks.forEach((deck) => {
        const node = template.content.firstElementChild.cloneNode(true);
        node.querySelector('.deck-name').textContent = deck.name;
        node.querySelector('.deck-count').textContent = `${deck.cardCount || 0} 张`;
        node.querySelector('.deck-description').textContent = deck.description || '暂无描述';
        node.querySelector('.edit-deck').addEventListener('click', () => fillDeckForm(deck));
        node.querySelector('.delete-deck').addEventListener('click', async () => {
            if (!confirm(`确认删除卡组“${deck.name}”？其中的卡组库存也会一起删除。`)) {
                return;
            }
            try {
                await api(`/api/decks/${deck.id}`, { method: 'DELETE' });
                setStatus(elements.deckStatus, `已删除卡组：${deck.name}`, 'success');
                clearDeckForm();
                await Promise.all([loadDecks(false), loadSummary()]);
                if (state.selectedCardId) {
                    await selectCard(state.selectedCardId);
                }
            } catch (error) {
                setStatus(elements.deckStatus, error.message, 'warning');
            }
        });
        elements.deckList.appendChild(node);
    });
}

async function loadDecks(showMessage = false) {
    const payload = await api('/api/decks');
    state.decks = payload.items || [];
    if (!state.decks.some((deck) => deck.id === state.preferredDeckId)) {
        state.preferredDeckId = state.decks[0]?.id ?? null;
    }
    renderDecks();
    if (showMessage) {
        if (elements.deckStatus) {
            setStatus(elements.deckStatus, `当前共有 ${state.decks.length} 个卡组。`, 'normal');
        }
    }
}

function fillDeckForm(deck) {
    elements.deckIdInput.value = deck.id;
    elements.deckNameInput.value = deck.name;
    elements.deckDescriptionInput.value = deck.description || '';
    setStatus(elements.deckStatus, `正在编辑卡组：${deck.name}`, 'normal');
}

function clearDeckForm() {
    elements.deckIdInput.value = '';
    elements.deckNameInput.value = '';
    elements.deckDescriptionInput.value = '';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderCardImage({ cardName, productCode, cardCode }) {
    return `
        <div class="card-image-wrap">
            <img
                class="card-image"
                src=""
                data-card-name="${escapeHtml(cardName)}"
                data-product-code="${escapeHtml(productCode || '')}"
                data-card-code="${escapeHtml(cardCode || '')}"
                alt="${escapeHtml(cardName)}"
                loading="lazy"
                onerror="retryCardImage(this)"
            >
        </div>
    `;
}

function resolveCardImage(imgElement, retryOnNull = false) {
    const name = imgElement.dataset.cardName || '';
    const productCode = imgElement.dataset.productCode || '';
    const cardCode = imgElement.dataset.cardCode || '';
    if (!name) {
        return;
    }
    const params = new URLSearchParams({ name, productCode, cardCode });
    api(`/api/images/lookup?${params}`)
        .then((payload) => {
            if (payload && payload.url) {
                imgElement.dataset.imageUrl = payload.url;
                imgElement.dataset.retryCount = '0';
                imgElement.src = payload.url;
            } else if (retryOnNull) {
                // demand 模式：等待后台下载完成，周期性重试
                const retries = parseInt(imgElement.dataset.retryCount || '0', 10);
                if (retries < 30) {  // 最多等 60 秒
                    imgElement.dataset.retryCount = String(retries + 1);
                    setTimeout(() => resolveCardImage(imgElement, true), 2000);
                } else {
                    imgElement.closest('.card-image-wrap').style.display = 'none';
                }
            } else {
                imgElement.closest('.card-image-wrap').style.display = 'none';
            }
        })
        .catch(() => {
            if (!retryOnNull) {
                imgElement.closest('.card-image-wrap').style.display = 'none';
            }
        });
}

function retryCardImage(img) {
    // 后台还在下载图片时，浏览器会 404，短暂重试几次
    const retries = parseInt(img.dataset.retryCount || '0', 10);
    if (retries >= 5) {
        img.closest('.card-image-wrap').style.display = 'none';
        return;
    }
    img.dataset.retryCount = String(retries + 1);
    const delay = Math.min(1000 * (retries + 1), 5000);
    setTimeout(() => {
        const url = img.dataset.imageUrl;
        if (url) {
            img.src = '';
            // 加时间戳绕过浏览器缓存，确保重试命中已下载的文件
            img.src = url + '?t=' + Date.now();
        }
    }, delay);
}

function initCardImages(container, retryOnNull = false) {
    if (!container) {
        return;
    }
    container.querySelectorAll('.card-image[src=""]').forEach((img) => {
        resolveCardImage(img, retryOnNull);
    });
}

async function uploadFile(url, file) {
    const formData = new FormData();
    formData.append('file', file);
    return api(url, {
        method: 'POST',
        body: formData,
        headers: {}
    });
}

function debounce(fn, delay) {
    let timer = null;
    const debounced = (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), delay);
    };
    debounced.cancel = () => window.clearTimeout(timer);
    return debounced;
}

const debouncedSearch = debounce(() => refreshSearch(true), SEARCH_DEBOUNCE_DELAY);

elements.searchInput.addEventListener('input', () => {
    if (isSearchComposing) {
        return;
    }
    cancelActiveSearch();
    debouncedSearch();
});
elements.searchInput.addEventListener('compositionstart', () => {
    isSearchComposing = true;
    debouncedSearch.cancel();
});
elements.searchInput.addEventListener('compositionend', () => {
    isSearchComposing = false;
    cancelActiveSearch();
    debouncedSearch();
});
elements.refreshSearchBtn.addEventListener('click', () => {
    debouncedSearch.cancel();
    refreshSearch(true);
});
elements.searchSameNameToggle?.addEventListener('change', async () => {
    debouncedSearch.cancel();
    state.considerSameNameRegulation = Boolean(elements.searchSameNameToggle?.checked);
    try {
        await persistSearchPreferences();
        if (elements.searchInput.value.trim()) {
            await refreshSearch(false);
        } else {
            setStatus(elements.searchStatus, `请输入关键字后再搜索。${regulationSummaryText()}`, 'normal');
        }
    } catch (error) {
        setStatus(elements.searchStatus, error.message, 'warning');
    }
});
elements.registerAccountBtn?.addEventListener('click', registerAccount);
elements.registerPasswordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void registerAccount(); }
});
elements.changePasswordBtn?.addEventListener('click', changePassword);
elements.newPasswordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void changePassword(); }
});
elements.generateBindCodeBtn?.addEventListener('click', generateBindCode);

if (elements.deckForm) {
    elements.deckForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const deckId = elements.deckIdInput.value;
        const payload = {
            name: elements.deckNameInput.value.trim(),
            description: elements.deckDescriptionInput.value.trim()
        };
        try {
            if (deckId) {
                await api(`/api/decks/${deckId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                setStatus(elements.deckStatus, `已更新卡组：${payload.name}`, 'success');
            } else {
                await api('/api/decks', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                setStatus(elements.deckStatus, `已创建卡组：${payload.name}`, 'success');
            }
            clearDeckForm();
            await Promise.all([loadDecks(false), loadSummary()]);
            if (state.selectedCardId) {
                await selectCard(state.selectedCardId);
            }
        } catch (error) {
            setStatus(elements.deckStatus, error.message, 'warning');
        }
    });
}

if (elements.resetDeckBtn) {
    elements.resetDeckBtn.addEventListener('click', () => {
        clearDeckForm();
        if (elements.deckStatus) {
            setStatus(elements.deckStatus, '已清空卡组表单。', 'normal');
        }
    });
}

elements.importDefaultCatalogBtn.addEventListener('click', async () => {
    try {
        const result = await api('/api/import/catalog-default', { method: 'POST' });
        setStatus(elements.searchStatus, `卡表更新完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}。${importBackupSuffix(result)}`, 'success');
        await Promise.all([loadSummary(), loadSearchOptions()]);
        await refreshSearch(true);
    } catch (error) {
        setStatus(elements.searchStatus, error.message, 'warning');
    }
});

elements.catalogUploadInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }
    try {
        const result = await uploadFile('/api/import/catalog-upload', file);
        setStatus(elements.searchStatus, `上传更新卡表完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}。${importBackupSuffix(result)}`, 'success');
        await Promise.all([loadSummary(), loadSearchOptions()]);
        await refreshSearch(true);
    } catch (error) {
        setStatus(elements.searchStatus, error.message, 'warning');
    } finally {
        event.target.value = '';
    }
});

elements.stateUploadInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }
    try {
        const result = await uploadFile('/api/import/state', file);
        setStatus(elements.deckStatus, `状态导入完成：导入 ${result.importedCards} 张卡牌，跳过 ${result.skippedCards} 张。${importBackupSuffix(result)}`, 'success');
        await Promise.all([loadDecks(false), loadSummary(), loadSearchOptions()]);
        await refreshSearch(true);
    } catch (error) {
        setStatus(elements.deckStatus, error.message, 'warning');
    } finally {
        event.target.value = '';
    }
});

elements.inventoryUploadInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }
    try {
        const result = await uploadFile('/api/import/inventory', file);
        setStatus(elements.deckStatus, `库存导入完成：导入 ${result.importedCards} 张卡牌，跳过 ${result.skippedCards} 张。${importBackupSuffix(result)}`, 'success');
        await Promise.all([loadSummary(), loadSearchOptions()]);
        await refreshSearch(true);
    } catch (error) {
        setStatus(elements.deckStatus, error.message, 'warning');
    } finally {
        event.target.value = '';
    }
});

(async function init() {
    try {
        clearLegacySearchPreferenceStorage();
        await Promise.all([loadAccounts(), loadSummary(), loadDecks(true), loadSearchOptions()]);
        await refreshSearch(false);
        elements.cardDetail.innerHTML = EMPTY_DETAIL_HTML;
    } catch (error) {
        setStatus(elements.searchStatus, error.message, 'warning');
    }
})();

