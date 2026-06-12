const LAST_USED_DECK_STORAGE_KEY = 'ptcgGallery:last-used-deck-id';
const LEGACY_SEARCH_REGULATION_STORAGE_KEY = 'ptcgGallery:search-regulations';

const state = {
    selectedCardId: null,
    selectedResultId: null,
    decks: [],
    results: [],
    currentQuery: "",
    availableRegulations: [],
    selectedRegulations: [],
    considerSameNameRegulation: false,
    accounts: [],
    currentAccount: null,
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
    accountSelect: document.getElementById('accountSelect'),
    accountNameInput: document.getElementById('accountNameInput'),
    switchAccountBtn: document.getElementById('switchAccountBtn'),
    createAccountBtn: document.getElementById('createAccountBtn'),
    deleteAccountBtn: document.getElementById('deleteAccountBtn'),
    accountStatus: document.getElementById('accountStatus'),
    importDefaultCatalogBtn: document.getElementById('importDefaultCatalogBtn'),
    catalogUploadInput: document.getElementById('catalogUploadInput'),
    stateUploadInput: document.getElementById('stateUploadInput'),
    inventoryUploadInput: document.getElementById('inventoryUploadInput')
};

let crawlerMode = 'off';  // 全局，供 renderResults 判断

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
    state.accounts = payload.items || [];
    state.currentAccount = payload.current || state.accounts.find((account) => account.isCurrent) || null;
    if (elements.currentAccountName) {
        elements.currentAccountName.textContent = state.currentAccount?.name || '-';
    }
    if (elements.accountSelect) {
        elements.accountSelect.innerHTML = state.accounts.map((account) => `
            <option value="${account.id}" ${account.id === state.currentAccount?.id ? 'selected' : ''}>
                ${escapeHtml(account.name)}（${Number(account.ownedCount ?? ((account.freeCount || 0) + (account.inDeckCount || 0)))} 张 / ${Number(account.deckCount || 0)} 组）
            </option>
        `).join('');
    }
    if (elements.deleteAccountBtn) {
        elements.deleteAccountBtn.disabled = state.accounts.length <= 1;
    }
}

async function loadAccounts() {
    const payload = await api('/api/accounts');
    renderAccounts(payload);
    return payload;
}

async function refreshAccountScopedData() {
    state.selectedCardId = null;
    state.selectedResultId = null;
    state.preferredDeckId = null;
    try {
        window.localStorage.removeItem(LAST_USED_DECK_STORAGE_KEY);
    } catch (_) {
        // ignore storage failures
    }
    await Promise.all([loadAccounts(), loadSummary(), loadDecks(false), loadSearchOptions()]);
    await refreshSearch(false);
    elements.cardDetail.innerHTML = EMPTY_DETAIL_HTML;
}

async function switchToSelectedAccount() {
    const accountId = Number(elements.accountSelect?.value || 0);
    if (!accountId || accountId === state.currentAccount?.id) {
        return;
    }
    try {
        const payload = await api('/api/accounts/current', {
            method: 'PUT',
            body: JSON.stringify({ accountId })
        });
        renderAccounts(payload);
        await refreshAccountScopedData();
        setStatus(elements.accountStatus, `已切换到账号：${state.currentAccount?.name || '-'}`, 'success');
    } catch (error) {
        setStatus(elements.accountStatus, error.message, 'warning');
    }
}

async function createAccount() {
    const name = elements.accountNameInput?.value.trim() || '';
    if (!name) {
        setStatus(elements.accountStatus, '请输入账号名称。', 'warning');
        return;
    }
    try {
        const payload = await api('/api/accounts', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        if (elements.accountNameInput) {
            elements.accountNameInput.value = '';
        }
        renderAccounts(payload);
        await refreshAccountScopedData();
        setStatus(elements.accountStatus, `已新增并切换到账号：${state.currentAccount?.name || name}`, 'success');
    } catch (error) {
        setStatus(elements.accountStatus, error.message, 'warning');
    }
}

async function deleteCurrentAccount() {
    const account = state.currentAccount;
    if (!account) {
        return;
    }
    if (!confirm(`确认删除账号“${account.name}”？这个账号下的库存和卡组会一起删除，卡表目录不会删除。`)) {
        return;
    }
    try {
        const payload = await api(`/api/accounts/${account.id}`, { method: 'DELETE' });
        renderAccounts(payload);
        await refreshAccountScopedData();
        setStatus(elements.accountStatus, `已删除账号：${account.name}`, 'success');
    } catch (error) {
        setStatus(elements.accountStatus, error.message, 'warning');
    }
}

function renderResults() {
    elements.resultList.style.display = '';
    if (!state.results.length) {
        elements.resultList.innerHTML = '<div class="empty-state">没有找到符合条件的卡牌。</div>';
        return;
    }

    elements.resultList.innerHTML = state.results.map((card) => {
        const displayCode = card.displayCode || `${card.displayProductCode || card.productCode}-${card.displayCardCode || card.cardCode}`;
        return `
        <article class="result-item ${card.id === state.selectedResultId ? 'active' : ''}" data-card-id="${card.id}">
            <div class="result-main">
                ${renderCardImage(card)}
                <div class="result-info">
                    <div class="result-title">
                        <strong>${escapeHtml(card.cardName)}</strong>
                        <span class="mono">${escapeHtml(displayCode)}</span>
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
    initCardImages(elements.resultList, crawlerMode !== 'off');
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
                    <span>${escapeHtml(card.cardName)}</span>
                    <span class="mono">${escapeHtml(card.displayCode || `${card.displayProductCode || card.productCode}-${card.displayCardCode || card.cardCode}`)}</span>
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
                <p class="muted">当前值：${formatNumber(card.freeQuantity)}。可以直接加减，也可以输入一个新值后保存。</p>
                <div class="inline-actions">
                    <button type="button" data-action="free-adjust" data-delta="1">空闲 +1</button>
                    <button type="button" class="secondary" data-action="free-adjust" data-delta="-1">空闲 -1</button>
                </div>
                <div class="detail-inline-form">
                    <label>
                        直接设置
                        <input id="detailFreeQuantity" type="number" min="0" step="1" value="${Number(card.freeQuantity ?? 0)}">
                    </label>
                    <button type="button" data-action="free-set">设置空闲库存</button>
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

    const setFreeButton = elements.cardDetail.querySelector('[data-action="free-set"]');
    if (setFreeButton) {
        setFreeButton.addEventListener('click', async () => {
            const quantityInput = document.getElementById('detailFreeQuantity');
            await mutateCard(
                `/api/cards/${card.id}/free-quantity`,
                { quantity: Number(quantityInput?.value || 0) },
                'PUT'
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
    initCardImages(elements.cardDetail, crawlerMode !== 'off');
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
    try {
        const params = new URLSearchParams({ q: query });
        state.selectedRegulations.forEach((regulation) => {
            params.append('regulation', regulation);
        });
        if (state.considerSameNameRegulation) {
            params.set('considerSameNameRegulation', 'true');
        }
        const payload = await api(`/api/search?${params.toString()}`);
        state.results = payload.items || [];
        setStatus(elements.searchStatus, `找到 ${state.results.length} 张卡牌。当前关键字：${query}。${regulationSummaryText()}`, 'normal');
        renderResults();
        state.selectedCardId = null;
        state.selectedResultId = null;
        elements.cardDetail.innerHTML = state.results.length ? EMPTY_DETAIL_HTML : '<div class="empty-state">没有找到卡牌，请尝试更换关键字。</div>';
    } catch (error) {
        setStatus(elements.searchStatus, error.message, 'warning');
    }
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
    return (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), delay);
    };
}

const debouncedSearch = debounce(() => refreshSearch(true), 200);

elements.searchInput.addEventListener('input', debouncedSearch);
elements.refreshSearchBtn.addEventListener('click', () => refreshSearch(true));
elements.switchAccountBtn?.addEventListener('click', switchToSelectedAccount);
elements.accountSelect?.addEventListener('change', switchToSelectedAccount);
elements.createAccountBtn?.addEventListener('click', createAccount);
elements.accountNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        void createAccount();
    }
});
elements.deleteAccountBtn?.addEventListener('click', deleteCurrentAccount);
elements.searchSameNameToggle?.addEventListener('change', async () => {
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

// ── 爬虫控制 ──────────────────────────────────────────────

const crawlerElements = {
    offBtn: document.getElementById('crawlerOffBtn'),
    demandBtn: document.getElementById('crawlerDemandBtn'),
    onBtn: document.getElementById('crawlerOnBtn'),
    scheduledBtn: document.getElementById('crawlerScheduledBtn'),
    modeLabel: document.getElementById('crawlerModeLabel'),
    statusLine: document.getElementById('crawlerStatus'),
};

const CRAWLER_MODE_LABELS = {
    off: '仅本地',
    demand: '点开下载',
    on: '持续爬取',
    scheduled: '凌晨3点',
};

const CRAWLER_STATUS_TEXTS = {
    off: '当前：仅本地图片（不自动下载）',
    demand: '当前：点击卡牌详情时下载该卡图片',
    on: '当前：持续爬取 + 自动下载',
    scheduled: '当前：凌晨3点定时 + 自动下载',
};

async function setCrawlerMode(mode) {
    try {
        const result = await api('/api/crawler/mode', {
            method: 'PUT',
            body: JSON.stringify({ mode }),
        });
        if (result.ok) {
            updateCrawlerUI(mode);
        }
    } catch (error) {
        crawlerElements.statusLine.textContent = '爬虫模式切换失败: ' + error.message;
    }
}

function updateCrawlerUI(mode) {
    crawlerMode = mode;
    const btnMap = { off: crawlerElements.offBtn, demand: crawlerElements.demandBtn, on: crawlerElements.onBtn, scheduled: crawlerElements.scheduledBtn };
    Object.entries(btnMap).forEach(([m, btn]) => {
        if (!btn) return;
        btn.classList.toggle('is-active', m === mode);
    });
    if (crawlerElements.modeLabel) {
        crawlerElements.modeLabel.textContent = CRAWLER_MODE_LABELS[mode] || mode;
    }
    if (crawlerElements.statusLine) {
        crawlerElements.statusLine.textContent = CRAWLER_STATUS_TEXTS[mode] || '';
    }
}

async function loadCrawlerStatus() {
    try {
        const stats = await api('/api/crawler/status');
        updateCrawlerUI(stats.mode || 'off');
        if (stats.total_cards > 0 && (stats.mode === 'on' || stats.running)) {
            const pct = Math.round((stats.cached / stats.total_cards) * 100);
            crawlerElements.statusLine.textContent =
                `爬取中：${stats.cached}/${stats.total_cards} (${pct}%)  |  简中 ${stats.zh_downloaded}  英文 ${stats.en_downloaded}`;
        }
    } catch (_) {
        updateCrawlerUI('off');
    }
}

async function initCrawlerControls() {
    const { offBtn, demandBtn, onBtn, scheduledBtn } = crawlerElements;
    if (offBtn) offBtn.addEventListener('click', () => setCrawlerMode('off'));
    if (demandBtn) demandBtn.addEventListener('click', () => setCrawlerMode('demand'));
    if (onBtn) onBtn.addEventListener('click', () => setCrawlerMode('on'));
    if (scheduledBtn) scheduledBtn.addEventListener('click', () => setCrawlerMode('scheduled'));
    await loadCrawlerStatus();
    setInterval(loadCrawlerStatus, 10000);
}

(async function init() {
    try {
        clearLegacySearchPreferenceStorage();
        await Promise.all([loadAccounts(), loadSummary(), loadDecks(true), loadSearchOptions()]);
        await refreshSearch(false);
        elements.cardDetail.innerHTML = EMPTY_DETAIL_HTML;
        await initCrawlerControls();
    } catch (error) {
        setStatus(elements.searchStatus, error.message, 'warning');
    }
})();

