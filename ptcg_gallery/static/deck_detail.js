const RARITY_COLOR_GROUPS = [
    { color: '#ffc000', labels: ['AR', 'SAR'] },
    { color: '#fff200', labels: ['SR', 'HR'] },
    { color: '#00b050', labels: ['CHR', 'CSR'] },
    { color: '#dcd8c6', labels: ['C闪', 'U闪', 'R闪'] },
    { color: '#e5dff0', labels: ['闪'] },
    { color: '#00b0f0', labels: ['C★闪', 'U★闪', 'R★闪'] },
    { color: '#33cbca', labels: ['S', 'SSR'] },
    { color: '#f5abec', labels: ['TR'] },
    { color: '#ff0000', labels: ['UR'] }
];

const RARITY_COLOR_MAP = RARITY_COLOR_GROUPS.reduce((map, group) => {
    group.labels.forEach((label) => {
        map[label] = group.color;
    });
    return map;
}, {});

const state = {
    deck: null,
    modalCardId: null,
    modalEntryKind: 'main',
    modalNeedsRefresh: false
};

let draggedCardToken = null;
let draggedSectionKey = '';

const elements = {
    deckTitle: document.getElementById('deckTitle'),
    deckSubtitle: document.getElementById('deckSubtitle'),
    deckSummary: document.getElementById('deckSummary'),
    deckCardCount: document.getElementById('deckCardCount'),
    deckCards: document.getElementById('deckCards'),
    modal: document.getElementById('deckCardModal'),
    modalTitle: document.getElementById('deckCardModalTitle'),
    modalSubtitle: document.getElementById('deckCardModalSubtitle'),
    modalStatus: document.getElementById('deckCardModalStatus'),
    modalBody: document.getElementById('deckCardModalBody'),
    modalCloseBtn: document.getElementById('deckCardModalCloseBtn'),
    modalCloseTop: document.getElementById('deckCardModalCloseTop'),
    modalBackdrop: document.querySelector('#deckCardModal [data-action="close-card-modal"]'),
    cardDetailPopup: document.getElementById('cardDetailPopup'),
    cardDetailPopupTitle: document.getElementById('cardDetailPopupTitle'),
    cardDetailPopupSubtitle: document.getElementById('cardDetailPopupSubtitle'),
    cardDetailPopupBody: document.getElementById('cardDetailPopupBody'),
    cardDetailPopupCloseBtn: document.getElementById('cardDetailPopupCloseBtn'),
    cardDetailPopupCloseTop: document.getElementById('cardDetailPopupCloseTop'),
    cardDetailPopupBackdrop: document.querySelector('#cardDetailPopup [data-action="close-card-detail-popup"]')
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
    return response.json();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatNumber(value) {
    return Number(value ?? 0).toLocaleString('zh-CN');
}

function normalizeColor(value) {
    const text = String(value ?? '').trim();
    return text || '#9ca3af';
}

function getReadableTextColor(backgroundColor) {
    const match = normalizeColor(backgroundColor).match(/^#?([0-9a-f]{6})$/i);
    if (!match) {
        return '#132238';
    }

    const hex = match[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.7 ? '#132238' : '#ffffff';
}

function setStatus(message, type = 'normal') {
    const statusNode = document.getElementById('deckDetailStatus');
    if (!statusNode) {
        return;
    }
    statusNode.textContent = message;
    statusNode.className = 'status-line';
    if (type === 'success') {
        statusNode.classList.add('success-text');
    }
    if (type === 'warning') {
        statusNode.classList.add('warning-text');
    }
}

function setModalStatus(message, type = 'normal') {
    if (!elements.modalStatus) {
        return;
    }
    elements.modalStatus.textContent = message;
    elements.modalStatus.className = 'status-line inventory-modal-status';
    if (type === 'success') {
        elements.modalStatus.classList.add('success-text');
    }
    if (type === 'warning') {
        elements.modalStatus.classList.add('warning-text');
    }
}

function appendRaritySuffix(baseRarity, suffix) {
    if (!baseRarity) {
        return suffix;
    }
    return baseRarity.endsWith(suffix) ? baseRarity : `${baseRarity}${suffix}`;
}

function buildDisplayRarity(card) {
    const baseRarity = String(card?.rarity ?? '').trim();
    const variantText = `${card?.special ?? ''} ${card?.cardName ?? ''}`;

    if (variantText.includes('★闪')) {
        return appendRaritySuffix(baseRarity, '★闪');
    }
    if (variantText.includes('精灵球闪') || variantText.includes('大师球闪') || variantText.includes('球闪')) {
        return appendRaritySuffix(baseRarity, '闪');
    }
    if (!baseRarity && variantText.includes('闪')) {
        return '闪';
    }
    return baseRarity;
}

function getRarityTone(card) {
    const label = buildDisplayRarity(card);
    return {
        label,
        color: label ? (RARITY_COLOR_MAP[label] || '') : ''
    };
}

function renderBasicEnergyEditor(deck) {
    return `
        <section class="deck-basic-energy-panel">
            <div class="section-head">
                <h3 class="section-title">基本能量</h3>
                <span class="section-count">独立设置</span>
            </div>
            <div class="deck-basic-energy-list">
                ${(deck.basicEnergies || []).map((item) => `
                    <label class="deck-basic-energy-item">
                        <span class="deck-basic-energy-code mono">${escapeHtml(item.code)}</span>
                        <span class="deck-basic-energy-name">${escapeHtml(item.name)}</span>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            class="deck-basic-energy-input"
                            data-role="basic-energy-quantity"
                            data-code="${escapeHtml(item.code)}"
                            value="${Number(item.quantity ?? 0)}"
                        >
                    </label>
                `).join('')}
            </div>
            <div class="toolbar compact deck-basic-energy-actions">
                <button type="button" id="saveBasicEnergiesBtn">保存基础能量数量</button>
            </div>
            <p class="status-line" id="deckDetailStatus">可以在这里单独设置基本能量数量。</p>
        </section>
    `;
}

function renderDeckChecks(deck) {
    const checks = deck.deckChecks?.items || [];
    if (!checks.length) {
        return '';
    }
    return `
        <section class="deck-check-panel">
            <div class="section-head">
                <h3 class="section-title">卡组检查</h3>
                <span class="section-count ${deck.deckChecks?.ok ? 'success-text' : 'warning-text'}">${deck.deckChecks?.ok ? '通过' : '需确认'}</span>
            </div>
            <div class="deck-check-list">
                ${checks.map((item) => `
                    <div class="deck-check-item is-${escapeHtml(item.status || 'info')}">
                        <span class="deck-check-label">${escapeHtml(item.label || '-')}</span>
                        <span class="deck-check-message">${escapeHtml(item.message || '')}</span>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function renderDeckSummary(deck) {
    return `
        <div class="deck-summary-head" style="--deck-color: ${escapeHtml(deck.color || '#9ca3af')}">
            <div class="deck-color-swatch large" style="background: ${escapeHtml(deck.color || '#9ca3af')}"></div>
            <div>
                <h2 style="margin: 0 0 6px;">${escapeHtml(deck.name)}</h2>
                <p class="muted" style="margin: 0;">${escapeHtml(deck.description || '暂无描述')}</p>
            </div>
        </div>
        <div class="deck-summary-stats">
            <div class="mini-stat"><span>卡组总数</span><strong>${formatNumber(deck.cardCount)}</strong></div>
            <div class="mini-stat"><span>主牌数量</span><strong>${formatNumber(deck.mainCardCount)}</strong></div>
            <div class="mini-stat"><span>备卡数量</span><strong>${formatNumber(deck.backupCardCount)}</strong></div>
        </div>
        <div class="deck-summary-meta muted">
            <span>创建时间：${escapeHtml(deck.createdAt || deck.created_at || '-')}</span>
            <span>更新时间：${escapeHtml(deck.updatedAt || deck.updated_at || '-')}</span>
        </div>
        ${renderDeckChecks(deck)}
        ${renderBasicEnergyEditor(deck)}
    `;
}

function renderCardActionTrigger(card) {
    if (card.deckEntryType !== 'catalog_card') {
        return '<span class="deck-card-action-placeholder" aria-hidden="true"></span>';
    }

    const entryKind = card.isBackup ? 'backup' : 'main';
    const entryLabel = card.isBackup ? '备卡' : '主牌';

    return `
        <button
            type="button"
            class="secondary deck-card-action-trigger"
            data-action="open-card-modal"
            data-card-id="${card.id}"
            data-entry-kind="${entryKind}"
            title="操作这张${entryLabel}"
            aria-label="操作${entryLabel} ${escapeHtml(card.cardName)}"
        >
            ⋯
        </button>
    `;
}

function canReorderDeckCard(card) {
    return Boolean(card.deckSectionEntryKey);
}

function renderCardReorderHandle(card) {
    if (!canReorderDeckCard(card)) {
        return '<span class="deck-card-reorder-placeholder" aria-hidden="true"></span>';
    }

    return `
        <button
            type="button"
            class="secondary deck-card-reorder-handle"
            data-action="drag-card-order"
            data-card-id="${card.id}"
            data-entry-kind="${card.isBackup ? 'backup' : 'main'}"
            draggable="true"
            title="拖拽调整分区顺序"
            aria-label="拖拽调整分区顺序 ${escapeHtml(card.cardName)}"
        >
            ⋮⋮
        </button>
    `;
}

function renderDeckCardRow(card) {
    const tone = getRarityTone(card);
    const textColor = tone.color ? getReadableTextColor(tone.color) : '#425466';
    const rarityStyle = tone.color ? ` style="background: ${tone.color}; color: ${textColor};"` : '';
    const entryKind = card.isBackup ? 'backup' : 'main';
    return `
        <article
            class="deck-card-line${card.isBackup ? ' is-backup' : ''}${canReorderDeckCard(card) ? ' is-reorderable' : ''}"
            data-card-id="${card.id}"
            data-card-token="${card.id}-${entryKind}"
            data-entry-kind="${entryKind}"
            data-section-key="${escapeHtml(card.deckSectionKey || '')}"
            data-entry-key="${escapeHtml(card.deckSectionEntryKey || '')}"
            data-group-key="${escapeHtml(card.sameNameGroupKey || '')}"
            data-deck-entry-type="${escapeHtml(card.deckEntryType || '')}"
        >
            <div class="deck-card-mainline">
                ${renderCardReorderHandle(card)}
                <span class="deck-card-code mono">${escapeHtml(card.displayCode || '')}</span>
                <button class="deck-card-info-btn" type="button" data-card-id="${card.id}" title="查看卡牌详情">?</button>
                ${renderCardActionTrigger(card)}
                <span class="deck-card-name">${escapeHtml(card.cardName)}</span>
                <span class="deck-card-rarity${tone.label ? '' : ' is-empty'}"${rarityStyle}>${escapeHtml(tone.label || '')}</span>
                <span class="deck-card-quantity">${formatNumber(card.deckQuantity)}</span>
            </div>
        </article>
    `;
}

function renderDeckSection(section) {
    const totalQuantity = (section.items || []).reduce((sum, item) => sum + Number(item.deckQuantity ?? 0), 0);
    return `
        <section class="deck-section-card">
            <div class="section-head">
                <h3 class="section-title">${escapeHtml(section.title)}</h3>
                <span class="section-count">${formatNumber(totalQuantity)} 张</span>
            </div>
            <div class="deck-section-items" data-section-key="${escapeHtml(section.key || '')}">
                ${(section.items || []).map((card) => renderDeckCardRow(card)).join('')}
            </div>
        </section>
    `;
}

function renderDeckSections(deck) {
    const sections = deck.sections || [];
    if (!sections.length) {
        return '<div class="empty-state">这个卡组里还没有卡牌。</div>';
    }

    const leftSections = sections.filter((section) => section.column === 'left');
    const rightSections = sections.filter((section) => section.column === 'right');
    const fullSections = sections.filter((section) => section.column === 'full');
    return `
        <div class="deck-sections-layout">
            <div class="deck-sections-grid">
                <div class="deck-sections-column">
                    ${leftSections.map((section) => renderDeckSection(section)).join('')}
                </div>
                <div class="deck-sections-column">
                    ${rightSections.map((section) => renderDeckSection(section)).join('')}
                </div>
            </div>
            <div class="deck-sections-full">
                ${fullSections.map((section) => renderDeckSection(section)).join('')}
            </div>
        </div>
    `;
}

function collectBasicEnergyItems() {
    return Array.from(document.querySelectorAll('[data-role="basic-energy-quantity"]')).map((input) => ({
        code: input.dataset.code,
        quantity: Number(input.value || 0)
    }));
}

function getDeckCardEntry(cardId, entryKind = state.modalEntryKind || 'main') {
    const items = (state.deck?.cards || []).filter(
        (card) => card.deckEntryType === 'catalog_card' && Number(card.id) === Number(cardId)
    );
    const wantBackup = entryKind === 'backup';
    return items.find((card) => Boolean(card.isBackup) === wantBackup) || null;
}

function renderCardModal(card) {
    const mainQuantity = Math.max(0, Number(card.totalDeckQuantity ?? 0) - Number(card.currentBackupQuantity ?? 0));
    const entryQuantity = Number(card.deckQuantity ?? 0);
    const entryLabel = card.isBackup ? '备卡' : '主牌';
    const quantitySectionTitle = `${entryLabel}数量操作`;
    const quantityDescription = card.isBackup
        ? '输入这张卡在当前卡组里最终要保留多少张备卡，再选择通过哪种方式调整到这个结果。'
        : '输入这张卡在当前卡组里最终要保留多少张主牌，再选择通过哪种方式调整到这个结果。';
    return `
        <div class="deck-card-modal-summary">
            <div class="inventory-pill-row">
                <span class="inventory-pill">当前${entryLabel} ${formatNumber(entryQuantity)}</span>
                <span class="inventory-pill">卡组总数 ${formatNumber(card.totalDeckQuantity)}</span>
                <span class="inventory-pill">主牌 ${formatNumber(mainQuantity)}</span>
                <span class="inventory-pill">备卡 ${formatNumber(card.currentBackupQuantity)}</span>
                <span class="inventory-pill">空闲 ${formatNumber(card.freeQuantity)}</span>
            </div>
        </div>
        <div class="deck-card-modal-grid">
            ${card.isBackup ? '' : `
                <section class="inventory-card">
                    <h3>备卡设置</h3>
                    <p class="muted">设置这张卡当前有多少张计入备卡。</p>
                    <div class="detail-inline-form deck-card-modal-inline-form">
                        <label>
                            备卡数量
                            <input id="deckCardModalBackupQuantity" type="number" min="0" step="1" value="${Number(card.currentBackupQuantity ?? 0)}">
                        </label>
                        <button type="button" data-action="save-card-backup" data-card-id="${card.id}">保存备卡</button>
                    </div>
                </section>
            `}
            <section class="inventory-card">
                <h3>${quantitySectionTitle}</h3>
                <p class="muted">${quantityDescription}</p>
                <div class="deck-card-modal-ops">
                    <label class="deck-card-modal-field">
                        最终${entryLabel}数量
                        <input id="deckCardModalTargetQuantity" type="number" min="0" step="1" value="${entryQuantity}">
                    </label>
                    <p id="deckCardModalPlanHint" class="deck-card-modal-plan-hint"></p>
                    <div class="deck-card-modal-action-groups">
                        <div class="deck-card-modal-action-block">
                            <span class="deck-card-modal-action-title">补到这个数量</span>
                            <div class="toolbar compact deck-card-modal-action-row">
                                <button type="button" data-action="card-add-direct" data-card-id="${card.id}">直接补到此数量</button>
                                <button type="button" class="secondary" data-action="card-add-from-free" data-card-id="${card.id}">从空闲补到此数量</button>
                            </div>
                        </div>
                        <div class="deck-card-modal-action-block">
                            <span class="deck-card-modal-action-title">减到这个数量</span>
                            <div class="toolbar compact deck-card-modal-action-row">
                                <button type="button" class="secondary" data-action="card-back-to-free" data-card-id="${card.id}">转回空闲到此数量</button>
                                <button type="button" class="secondary" data-action="card-remove" data-card-id="${card.id}">直接删到此数量</button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    `;
}

function openCardModal(cardId, entryKind = 'main', statusMessage = '可以在这里按主牌/备卡分别调整数量。', statusType = 'normal') {
    const card = getDeckCardEntry(cardId, entryKind);
    if (!card || !elements.modal) {
        return;
    }

    state.modalCardId = Number(cardId);
    state.modalEntryKind = entryKind;
    const entryLabel = card.isBackup ? '备卡' : '主牌';
    elements.modalTitle.textContent = card.cardName;
    elements.modalSubtitle.textContent = `${card.displayCode || '-'} · 当前${entryLabel} ${formatNumber(card.deckQuantity)} 张`;
    elements.modalBody.innerHTML = renderCardModal(card);
    elements.modal.hidden = false;
    document.body.classList.add('modal-open');
    setModalStatus(statusMessage, statusType);
    bindCardModalContentEvents();
}

async function closeCardModal(shouldRefresh = true) {
    state.modalCardId = null;
    state.modalEntryKind = 'main';
    if (!elements.modal) {
        return;
    }
    elements.modal.hidden = true;
    elements.modalBody.innerHTML = '';
    document.body.classList.remove('modal-open');

    if (!shouldRefresh || !state.modalNeedsRefresh) {
        return;
    }

    state.modalNeedsRefresh = false;
    try {
        await reloadDeck();
    } catch (error) {
        setStatus(error.message, 'warning');
    }
}

function getModalBackupQuantity() {
    const quantity = Number(document.getElementById('deckCardModalBackupQuantity')?.value || 0);
    if (!Number.isInteger(quantity) || quantity < 0) {
        throw new Error('备卡数量必须是大于等于 0 的整数');
    }
    return quantity;
}

function getModalTargetDeckQuantity() {
    const quantity = Number(document.getElementById('deckCardModalTargetQuantity')?.value || 0);
    if (!Number.isInteger(quantity) || quantity < 0) {
        throw new Error('最终卡组剩余数量必须是大于等于 0 的整数');
    }
    return quantity;
}

function getDeckQuantityPlan(cardId) {
    const card = getDeckCardEntry(cardId, state.modalEntryKind);
    if (!card) {
        throw new Error('未找到当前卡牌，请关闭弹窗后重试');
    }
    const currentQuantity = Number(card.deckQuantity ?? 0);
    const targetQuantity = getModalTargetDeckQuantity();
    return {
        card,
        currentQuantity,
        targetQuantity,
        delta: targetQuantity - currentQuantity,
    };
}

function ensureQuantityPlanDelta(cardId, mode) {
    const plan = getDeckQuantityPlan(cardId);
    if (plan.delta === 0) {
        throw new Error('目标数量与当前数量相同，无需调整');
    }
    if (mode === 'increase' && plan.delta < 0) {
        throw new Error('目标数量更小，请使用“转回空闲到此数量”或“直接删到此数量”');
    }
    if (mode === 'decrease' && plan.delta > 0) {
        throw new Error('目标数量更大，请使用“直接补到此数量”或“从空闲补到此数量”');
    }
    return {
        ...plan,
        amount: Math.abs(plan.delta),
    };
}

function updateDeckQuantityPlan(cardId = state.modalCardId) {
    const hint = document.getElementById('deckCardModalPlanHint');
    const targetInput = document.getElementById('deckCardModalTargetQuantity');
    const addDirectButton = elements.modalBody?.querySelector('[data-action="card-add-direct"]');
    const addFromFreeButton = elements.modalBody?.querySelector('[data-action="card-add-from-free"]');
    const backToFreeButton = elements.modalBody?.querySelector('[data-action="card-back-to-free"]');
    const removeButton = elements.modalBody?.querySelector('[data-action="card-remove"]');
    if (!hint || !targetInput) {
        return;
    }

    const card = getDeckCardEntry(cardId, state.modalEntryKind);
    if (!card) {
        return;
    }

    const currentQuantity = Number(card.deckQuantity ?? 0);
    const targetQuantity = Number(targetInput.value || 0);
    hint.className = 'deck-card-modal-plan-hint';
    const entryLabel = card.isBackup ? '备卡' : '主牌';

    if (!Number.isInteger(targetQuantity) || targetQuantity < 0) {
        hint.textContent = `请输入大于等于 0 的整数${entryLabel}目标数量。`;
        hint.classList.add('warning-text');
        [addDirectButton, addFromFreeButton, backToFreeButton, removeButton].forEach((button) => {
            if (button) {
                button.disabled = true;
            }
        });
        return;
    }

    const delta = targetQuantity - currentQuantity;
    if (delta > 0) {
        hint.textContent = `当前${entryLabel} ${formatNumber(currentQuantity)} 张，目标 ${formatNumber(targetQuantity)} 张，还需要补入 ${formatNumber(delta)} 张。`;
        hint.classList.add('success-text');
    } else if (delta < 0) {
        hint.textContent = `当前${entryLabel} ${formatNumber(currentQuantity)} 张，目标 ${formatNumber(targetQuantity)} 张，需要移出 ${formatNumber(Math.abs(delta))} 张。`;
        hint.classList.add('warning-text');
    } else {
        hint.textContent = `当前${entryLabel}已经是 ${formatNumber(currentQuantity)} 张，暂时不需要调整。`;
    }

    if (addDirectButton) {
        addDirectButton.disabled = delta <= 0;
    }
    if (addFromFreeButton) {
        addFromFreeButton.disabled = delta <= 0;
    }
    if (backToFreeButton) {
        backToFreeButton.disabled = delta >= 0;
    }
    if (removeButton) {
        removeButton.disabled = delta >= 0;
    }
}

async function reloadDeck() {
    const deck = await api(`/api/decks/${window.__DECK_ID__}`);
    renderDeck(deck);
    return deck;
}

async function applyCardAction(cardId, requestFactory, successMessage) {
    const entryKind = state.modalEntryKind || 'main';
    try {
        const response = await requestFactory();
        const deck = response?.sections ? response : await reloadDeck();
        if (response?.sections) {
            renderDeck(deck);
        }
        state.modalNeedsRefresh = true;

        const currentCard = getDeckCardEntry(cardId, entryKind);
        if (currentCard) {
            openCardModal(cardId, entryKind, successMessage, 'success');
        } else {
            state.modalNeedsRefresh = false;
            await closeCardModal(false);
            setStatus(successMessage, 'success');
        }
    } catch (error) {
        setModalStatus(error.message, 'warning');
    }
}

async function saveBasicEnergies() {
    try {
        const deck = await api(`/api/decks/${window.__DECK_ID__}/basic-energies`, {
            method: 'PUT',
            body: JSON.stringify({ items: collectBasicEnergyItems() })
        });
        renderDeck(deck);
        setStatus('已更新基础能量数量。', 'success');
    } catch (error) {
        setStatus(error.message, 'warning');
    }
}

async function saveBackupQuantity(cardId) {
    await applyCardAction(
        cardId,
        () => api(`/api/decks/${window.__DECK_ID__}/cards/${cardId}/backup-quantity`, {
            method: 'PUT',
            body: JSON.stringify({ quantity: getModalBackupQuantity() })
        }),
        '已更新备卡数量。'
    );
}

async function addCardDirectly(cardId) {
    await applyCardAction(
        cardId,
        () => api(`/api/decks/${window.__DECK_ID__}/cards/${cardId}/quantity-action`, {
            method: 'POST',
            body: JSON.stringify({
                entryType: state.modalEntryKind,
                mode: 'add_direct',
                targetQuantity: getModalTargetDeckQuantity()
            })
        }),
        `已直接补到目标${state.modalEntryKind === 'backup' ? '备卡' : '主牌'}数量。`
    );
}

async function addCardFromFree(cardId) {
    await applyCardAction(
        cardId,
        () => api(`/api/decks/${window.__DECK_ID__}/cards/${cardId}/quantity-action`, {
            method: 'POST',
            body: JSON.stringify({
                entryType: state.modalEntryKind,
                mode: 'add_from_free',
                targetQuantity: getModalTargetDeckQuantity()
            })
        }),
        `已从空闲补到目标${state.modalEntryKind === 'backup' ? '备卡' : '主牌'}数量。`
    );
}

async function moveCardBackToFree(cardId) {
    await applyCardAction(
        cardId,
        () => api(`/api/decks/${window.__DECK_ID__}/cards/${cardId}/quantity-action`, {
            method: 'POST',
            body: JSON.stringify({
                entryType: state.modalEntryKind,
                mode: 'back_to_free',
                targetQuantity: getModalTargetDeckQuantity()
            })
        }),
        `已转回空闲并达到目标${state.modalEntryKind === 'backup' ? '备卡' : '主牌'}数量。`
    );
}

async function removeCardFromDeck(cardId) {
    await applyCardAction(
        cardId,
        () => api(`/api/decks/${window.__DECK_ID__}/cards/${cardId}/quantity-action`, {
            method: 'POST',
            body: JSON.stringify({
                entryType: state.modalEntryKind,
                mode: 'remove',
                targetQuantity: getModalTargetDeckQuantity()
            })
        }),
        `已直接删除并达到目标${state.modalEntryKind === 'backup' ? '备卡' : '主牌'}数量。`
    );
}

function bindCardModalContentEvents() {
    if (!elements.modalBody) {
        return;
    }

    const targetInput = document.getElementById('deckCardModalTargetQuantity');
    if (targetInput) {
        targetInput.addEventListener('input', () => updateDeckQuantityPlan());
    }

    elements.modalBody.querySelectorAll('[data-action="save-card-backup"]').forEach((button) => {
        button.addEventListener('click', () => saveBackupQuantity(Number(button.dataset.cardId)));
    });
    elements.modalBody.querySelectorAll('[data-action="card-add-direct"]').forEach((button) => {
        button.addEventListener('click', () => addCardDirectly(Number(button.dataset.cardId)));
    });
    elements.modalBody.querySelectorAll('[data-action="card-add-from-free"]').forEach((button) => {
        button.addEventListener('click', () => addCardFromFree(Number(button.dataset.cardId)));
    });
    elements.modalBody.querySelectorAll('[data-action="card-back-to-free"]').forEach((button) => {
        button.addEventListener('click', () => moveCardBackToFree(Number(button.dataset.cardId)));
    });
    elements.modalBody.querySelectorAll('[data-action="card-remove"]').forEach((button) => {
        button.addEventListener('click', () => removeCardFromDeck(Number(button.dataset.cardId)));
    });

    updateDeckQuantityPlan();
}

function clearDeckCardDropIndicators() {
    document.querySelectorAll('.deck-card-line').forEach((node) => {
        node.classList.remove('drag-over-before', 'drag-over-after');
    });
}

function clearDeckCardDraggingState() {
    document.querySelectorAll('.deck-card-line').forEach((node) => {
        node.classList.remove('dragging');
    });
}

function resetDeckCardDragState() {
    draggedCardToken = null;
    draggedSectionKey = '';
    clearDeckCardDropIndicators();
    clearDeckCardDraggingState();
}

function getDeckCardDropSide(event, node) {
    const rect = node.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function handleDeckCardDragStart(event) {
    const row = event.currentTarget.closest('.deck-card-line');
    if (!row) {
        event.preventDefault();
        return;
    }

    draggedCardToken = row.dataset.cardToken || '';
    draggedSectionKey = row.dataset.sectionKey || '';
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedCardToken);
}

function handleDeckCardDragEnd() {
    resetDeckCardDragState();
}

function handleDeckCardDragOver(event) {
    const targetRow = event.currentTarget;
    if (!draggedCardToken || !draggedSectionKey || !targetRow) {
        return;
    }
    if (targetRow.dataset.sectionKey !== draggedSectionKey || targetRow.dataset.cardToken === draggedCardToken) {
        return;
    }

    event.preventDefault();
    clearDeckCardDropIndicators();
    targetRow.classList.add(`drag-over-${getDeckCardDropSide(event, targetRow)}`);
}

async function saveDeckCardSectionOrder(sectionNode) {
    const sectionKey = sectionNode?.dataset.sectionKey || '';
    const entryKeys = Array.from(sectionNode?.querySelectorAll('.deck-card-line[data-entry-key]') || [])
        .map((node) => String(node.dataset.entryKey || '').trim())
        .filter((entryKey, index, items) => entryKey && items.indexOf(entryKey) === index);

    if (!sectionKey || entryKeys.length < 2) {
        resetDeckCardDragState();
        return;
    }

    try {
        const deck = await api(`/api/decks/${window.__DECK_ID__}/section-order`, {
            method: 'PUT',
            body: JSON.stringify({ sectionKey, entryKeys })
        });
        renderDeck(deck);
        setStatus('已更新分区内卡牌顺序。', 'success');
    } catch (error) {
        try {
            await reloadDeck();
        } catch (_) {
            // ignore reload failure after surfacing the original error
        }
        setStatus(error.message, 'warning');
    } finally {
        resetDeckCardDragState();
    }
}

async function handleDeckCardDrop(event) {
    event.preventDefault();
    const targetRow = event.currentTarget;
    if (!draggedCardToken || !draggedSectionKey || !targetRow) {
        clearDeckCardDropIndicators();
        return;
    }
    if (targetRow.dataset.sectionKey !== draggedSectionKey || targetRow.dataset.cardToken === draggedCardToken) {
        clearDeckCardDropIndicators();
        return;
    }

    const sectionNode = targetRow.closest('.deck-section-items');
    const draggedRow = Array.from(sectionNode?.querySelectorAll('.deck-card-line') || []).find(
        (node) => node.dataset.cardToken === draggedCardToken
    );
    if (!sectionNode || !draggedRow) {
        resetDeckCardDragState();
        return;
    }

    const dropSide = getDeckCardDropSide(event, targetRow);
    if (dropSide === 'before') {
        targetRow.before(draggedRow);
    } else {
        targetRow.after(draggedRow);
    }

    clearDeckCardDropIndicators();
    await saveDeckCardSectionOrder(sectionNode);
}

function bindDeckEvents() {
    const saveButton = document.getElementById('saveBasicEnergiesBtn');
    if (saveButton) {
        saveButton.addEventListener('click', saveBasicEnergies);
    }
    document.querySelectorAll('[data-action="open-card-modal"]').forEach((button) => {
        button.addEventListener('click', () => openCardModal(Number(button.dataset.cardId), button.dataset.entryKind || 'main'));
    });

    document.querySelectorAll('[data-action="drag-card-order"]').forEach((button) => {
        button.addEventListener('dragstart', handleDeckCardDragStart);
        button.addEventListener('dragend', handleDeckCardDragEnd);
    });

    document.querySelectorAll('.deck-card-line[data-entry-key]').forEach((row) => {
        row.addEventListener('dragover', handleDeckCardDragOver);
        row.addEventListener('drop', (event) => {
            void handleDeckCardDrop(event);
        });
    });

    // card detail popup buttons
    document.querySelectorAll('.deck-card-info-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cardId = Number(btn.dataset.cardId);
            if (cardId) showCardDetailPopup(cardId);
        });
    });

    // popup close events
    elements.cardDetailPopupCloseBtn?.addEventListener('click', closeCardDetailPopup);
    elements.cardDetailPopupCloseTop?.addEventListener('click', closeCardDetailPopup);
    elements.cardDetailPopupBackdrop?.addEventListener('click', closeCardDetailPopup);
}

function bindModalEvents() {
    elements.modalCloseBtn?.addEventListener('click', () => {
        void closeCardModal();
    });
    elements.modalCloseTop?.addEventListener('click', () => {
        void closeCardModal();
    });
    elements.modalBackdrop?.addEventListener('click', () => {
        void closeCardModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !elements.modal?.hidden) {
            void closeCardModal();
        }
    });
}

function renderDeck(deck) {
    state.deck = deck;
    document.title = `${deck.name} - ptcgGallery`;
    elements.deckTitle.textContent = deck.name;
    elements.deckSubtitle.textContent = deck.description || '暂无描述';
    elements.deckSummary.innerHTML = renderDeckSummary(deck);
    elements.deckCardCount.textContent = `共 ${formatNumber(deck.cardCount)} 张`;
    elements.deckCards.innerHTML = renderDeckSections(deck);
    bindDeckEvents();
}

(async function init() {
    bindModalEvents();
    try {
        const deck = await api(`/api/decks/${window.__DECK_ID__}`);
        renderDeck(deck);
    } catch (error) {
        elements.deckSummary.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        elements.deckCards.innerHTML = '';
        elements.deckCardCount.textContent = '';
        elements.deckSubtitle.textContent = error.message;
    }
})();

// ── 卡片详情弹窗 ──────────────────────────────────────────
async function showCardDetailPopup(cardId) {
    if (!elements.cardDetailPopup || !cardId) return;
    elements.cardDetailPopup.removeAttribute('hidden');
    elements.cardDetailPopupBody.innerHTML = '<p class="muted">加载中...</p>';
    document.body.classList.add('modal-open');
    try {
        const card = await api('/api/cards/' + cardId);
        elements.cardDetailPopupTitle.textContent = card.cardName || '';
        elements.cardDetailPopupSubtitle.textContent = card.displayCode || '';

        var html = '';
        // 图片 + 基本信息
        html += '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">';
        html += '<div class="card-image-wrap" style="width:160px;min-height:224px;border-radius:12px;flex:0 0 auto">';
        html += '<img class="card-image" src="" style="display:none" data-card-name="' + escapeHtml(card.cardName) + '" data-product-code="' + escapeHtml(card.productCode||'') + '" data-card-code="' + escapeHtml(card.cardCode||'') + '">';
        html += '</div>';
        html += '<div style="flex:1;min-width:200px"><div class="card-grid">';
        html += popupLine('编号', card.displayCode);
        html += popupLine('商品编号', card.displayProductCode || card.productCode);
        html += popupLine('稀有度', card.rarity);
        html += popupLine('属性', card.attribute);
        html += popupLine('赛制', card.regulation);
        html += '</div></div></div>';
        // 库存汇总
        html += '<div class="inventory-pill-row" style="margin-top:4px">';
        html += '<span class="inventory-pill">空闲 ' + (card.freeQuantity??0) + '</span>';
        html += '<span class="inventory-pill">卡组 ' + (card.deckQuantity??0) + '</span>';
        html += '<span class="inventory-pill">总持有 ' + (card.ownedQuantity??0) + '</span>';
        html += '</div>';
        // 卡组分布
        var breakdown = card.deckBreakdown || [];
        if (breakdown.length > 0) {
            html += '<div style="margin-top:10px"><div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px">所在卡组</div>';
            for (var i = 0; i < breakdown.length; i++) {
                var d = breakdown[i];
                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:4px;background:#fcfdff">';
                html += '<span style="font-weight:600">' + escapeHtml(d.deckName) + '</span>';
                html += '<span>' + d.quantity + ' 张';
                if (d.backupQuantity > 0) html += '（备卡 ' + d.backupQuantity + '）';
                html += '</span></div>';
            }
            html += '</div>';
        }
        elements.cardDetailPopupBody.innerHTML = html;
        const img = elements.cardDetailPopupBody.querySelector('.card-image');
        if (img) {
            const p = new URLSearchParams({name:card.cardName,productCode:card.productCode||'',cardCode:card.cardCode||''});
            api('/api/images/lookup?' + p).then(function(r) { if(r && r.url) img.src = r.url; });
        }
    } catch(e) {
        elements.cardDetailPopupBody.innerHTML = '<p class="warning-text">' + escapeHtml(e.message) + '</p>';
    }
}
function closeCardDetailPopup() {
    if (elements.cardDetailPopup) elements.cardDetailPopup.setAttribute('hidden', '');
    document.body.classList.remove('modal-open');
}
function popupLine(label, value) {
    var v = (value && String(value).trim()) ? escapeHtml(String(value)) : '-';
    return '<div><div class="label">' + escapeHtml(label) + '</div><div class="value">' + v + '</div></div>';
}

