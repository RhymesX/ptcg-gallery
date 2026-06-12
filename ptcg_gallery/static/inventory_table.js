const GROUPS_PER_ROW = 8;
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
const ATTRIBUTE_ORDER = ['草', '火', '水', '电', '超', '斗', '恶', '钢', '龙', '妖', '无'];
const ATTRIBUTE_ALIASES = {
    草: ['草'],
    火: ['火'],
    水: ['水'],
    电: ['电', '雷'],
    超: ['超'],
    斗: ['斗'],
    恶: ['恶'],
    钢: ['钢', '金属'],
    龙: ['龙'],
    妖: ['妖', '妖精'],
    无: ['无', '无色']
};
const ATTRIBUTE_COLOR_FALLBACKS = {
    草: '#4caf50',
    火: '#ef6c36',
    水: '#2f80ed',
    电: '#f5b700',
    超: '#9b5de5',
    斗: '#a35a1f',
    恶: '#344054',
    钢: '#7a8798',
    龙: '#5a3fd1',
    妖: '#ec6aa7',
    无: '#9aa0a6'
};

const state = {
    report: null,
    summary: null,
    activeGroupKey: null,
    modalNeedsRefresh: false,
    modalSaving: false,
    groupOrderSaving: false,
    filters: {
        query: '',
        sectionKey: '',
        deckName: '',
        onlyFree: false,
        onlyInDeck: false,
    },
};

const elements = {
    summaryCards: document.getElementById('summaryCards'),
    deckLegend: document.getElementById('deckLegend'),
    rarityLegend: document.getElementById('rarityLegend'),
    filters: document.getElementById('inventoryTableFilters'),
    content: document.getElementById('inventoryTableContent'),
    modal: document.getElementById('inventoryModal'),
    modalTitle: document.getElementById('inventoryModalTitle'),
    modalSubtitle: document.getElementById('inventoryModalSubtitle'),
    modalStatus: document.getElementById('inventoryModalStatus'),
    modalTableWrap: document.getElementById('inventoryModalTableWrap'),
    modalSaveBtn: document.getElementById('inventoryModalSaveBtn'),
    modalCloseBtn: document.getElementById('inventoryModalCloseBtn'),
    modalCloseTop: document.getElementById('inventoryModalCloseTop'),
    // Sort groups modal
    sortModal: document.getElementById('sortGroupsModal'),
    sortModalTitle: document.getElementById('sortGroupsModalTitle'),
    sortModalSubtitle: document.getElementById('sortGroupsModalSubtitle'),
    sortModalStatus: document.getElementById('sortGroupsModalStatus'),
    sortModalList: document.getElementById('sortGroupsModalList'),
    sortModalSaveBtn: document.getElementById('sortGroupsModalSaveBtn'),
    sortModalCloseBtn: document.getElementById('sortGroupsModalCloseBtn'),
    sortModalCloseTop: document.getElementById('sortGroupsModalCloseTop'),
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
    return contentType.includes('application/json') ? response.json() : response;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function normalizeColor(value) {
    const text = String(value ?? '').trim();
    return text || '#edf2fb';
}

function getReadableTextColor(backgroundColor) {
    const color = normalizeColor(backgroundColor);
    const match = color.match(/^#?([0-9a-f]{6})$/i);
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

function formatDisplayProductCode(value) {
    const text = String(value ?? '').trim();
    return /^151C[1-4]$/i.test(text) ? '151C' : text;
}

function formatDisplayCardCode(value) {
    const text = String(value ?? '').trim();
    return text.split('/', 1)[0].trim();
}

function setStatus(target, message, type = 'normal') {
    if (!target) {
        return;
    }
    target.textContent = message;
    target.className = 'status-line';
    if (type === 'success') {
        target.classList.add('success-text');
    }
    if (type === 'warning') {
        target.classList.add('warning-text');
    }
}

function buildDisplayRarity(item) {
    const baseRarity = String(item?.rarity ?? '').trim();
    const variantText = `${item?.special ?? ''} ${item?.cardName ?? ''}`;

    const appendSuffix = (suffix) => {
        if (!baseRarity) {
            return suffix;
        }
        return baseRarity.endsWith(suffix) ? baseRarity : `${baseRarity}${suffix}`;
    };

    if (variantText.includes('★闪')) {
        return appendSuffix('★闪');
    }
    if (variantText.includes('精灵球闪') || variantText.includes('大师球闪') || variantText.includes('球闪')) {
        return appendSuffix('闪');
    }
    if (!baseRarity && variantText.includes('闪')) {
        return '闪';
    }
    return baseRarity || '-';
}

function getRarityTone(item) {
    const displayRarity = buildDisplayRarity(item);
    return {
        label: displayRarity,
        color: RARITY_COLOR_MAP[displayRarity] || ''
    };
}

function chunkItems(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks.length ? chunks : [[]];
}

function renderDeckLegend(decks) {
    if (!elements.deckLegend) {
        return;
    }
    if (!decks.length) {
        elements.deckLegend.innerHTML = '';
        return;
    }
    elements.deckLegend.innerHTML = decks.map((deck) => {
        const color = normalizeColor(deck.color);
        return `
            <span class="deck-legend-item">
                <span class="deck-legend-swatch" style="background: ${color}"></span>
                <span class="deck-legend-name">${escapeHtml(deck.name)}</span>
            </span>
        `;
    }).join('');
}

function renderRarityLegend() {
    if (!elements.rarityLegend) {
        return;
    }
    elements.rarityLegend.innerHTML = RARITY_COLOR_GROUPS.map((group) => `
        <span class="inventory-rarity-item">
            <span class="inventory-rarity-swatch" style="background: ${group.color}"></span>
            <span>${group.labels.map((label) => escapeHtml(label)).join(' / ')}</span>
        </span>
    `).join('');
}

function extractAttributes(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        return [];
    }

    const attributes = ATTRIBUTE_ORDER.filter((attribute) => ATTRIBUTE_ALIASES[attribute].some((alias) => text.includes(alias)));
    return attributes.length ? attributes : [text];
}

function collectGroupAttributeEntries(group) {
    const entries = [];
    const seen = new Set();
    for (const item of group?.items || []) {
        const attributes = extractAttributes(item?.attribute);
        for (const attribute of attributes) {
            if (seen.has(attribute)) {
                continue;
            }
            seen.add(attribute);
            entries.push({
                label: attribute,
                color: normalizeColor(item?.attributeColor || ATTRIBUTE_COLOR_FALLBACKS[attribute] || '#9aa0a6')
            });
        }
    }
    return entries;
}

function isPokemonGroup(group) {
    const categoryKey = group?.items?.[0]?.categoryKey || '';
    return ['ordinary_pokemon', 'pokemon_gx', 'pokemon_v', 'pokemon_ex', 'radiant_pokemon'].includes(categoryKey);
}

function getInventoryGroupName(group) {
    const groupName = String(group?.groupName ?? '');
    if (!isPokemonGroup(group)) {
        return groupName;
    }

    const attributes = collectGroupAttributeEntries(group).map((entry) => entry.label);
    if (!attributes.length) {
        return groupName;
    }

    const suffix = ` ${attributes.join('/')}`;
    return groupName.endsWith(suffix) ? groupName.slice(0, -suffix.length) : groupName;
}

function renderGroupAttributeDots(group) {
    if (!isPokemonGroup(group)) {
        return '';
    }

    const entries = collectGroupAttributeEntries(group);
    if (!entries.length) {
        return '';
    }

    return `
        <span class="inventory-attribute-dots" aria-label="属性：${escapeHtml(entries.map((entry) => entry.label).join('/'))}" title="${escapeHtml(entries.map((entry) => entry.label).join('/'))}">
            ${entries.map((entry) => `<span class="inventory-attribute-dot" style="background: ${entry.color}"></span>`).join('')}
        </span>
    `;
}

function renderSummary(summary) {
    const cards = [
        { label: '空闲', value: summary.freeCount ?? 0 },
        { label: '在卡组', value: summary.inDeckCount ?? 0 },
        { label: '总持有', value: summary.ownedCount ?? 0 },
        { label: '卡组数', value: summary.deckCount ?? 0 }
    ];
    elements.summaryCards.innerHTML = cards.map((item) => `
        <div class="stat-card">
            <span class="value">${item.value}</span>
            <span>${item.label}</span>
        </div>
    `).join('');
}

function renderInventoryFilters(report) {
    if (!elements.filters) {
        return;
    }
    const sections = report.sections || [];
    const decks = report.decks || [];
    elements.filters.innerHTML = `
        <div class="inventory-filter-grid">
            <label class="inventory-filter-field inventory-filter-search">
                <span>搜索</span>
                <input id="inventoryFilterQuery" type="text" placeholder="卡名、编号、商品编号" value="${escapeHtml(state.filters.query)}">
            </label>
            <label class="inventory-filter-field">
                <span>分类</span>
                <select id="inventoryFilterSection">
                    <option value="">全部分类</option>
                    ${sections.map((section) => `<option value="${escapeHtml(section.key)}" ${state.filters.sectionKey === section.key ? 'selected' : ''}>${escapeHtml(section.title)}</option>`).join('')}
                </select>
            </label>
            <label class="inventory-filter-field">
                <span>卡组</span>
                <select id="inventoryFilterDeck">
                    <option value="">全部卡组</option>
                    ${decks.map((deck) => `<option value="${escapeHtml(deck.name)}" ${state.filters.deckName === deck.name ? 'selected' : ''}>${escapeHtml(deck.name)}</option>`).join('')}
                </select>
            </label>
            <label class="inventory-filter-check">
                <input id="inventoryFilterFree" type="checkbox" ${state.filters.onlyFree ? 'checked' : ''}>
                <span>只看有空闲</span>
            </label>
            <label class="inventory-filter-check">
                <input id="inventoryFilterInDeck" type="checkbox" ${state.filters.onlyInDeck ? 'checked' : ''}>
                <span>只看在卡组</span>
            </label>
            <button type="button" class="secondary inventory-filter-reset" id="inventoryFilterReset">清除筛选</button>
        </div>
    `;
}

function normalizeFilterText(value) {
    return String(value ?? '').trim().toLocaleLowerCase('zh-CN');
}

function itemMatchesInventoryFilters(item) {
    const query = normalizeFilterText(state.filters.query);
    if (query) {
        const searchText = [
            item.cardName,
            item.displayCode,
            item.displayProductCode,
            item.productCode,
            item.cardCode,
            item.rarity,
            item.regulation,
        ].map((value) => normalizeFilterText(value)).join(' ');
        if (!searchText.includes(query)) {
            return false;
        }
    }
    if (state.filters.deckName && Number(item.deckQuantities?.[state.filters.deckName] ?? 0) <= 0) {
        return false;
    }
    if (state.filters.onlyFree && Number(item.freeQuantity ?? 0) <= 0) {
        return false;
    }
    if (state.filters.onlyInDeck && Number(item.visibleDeckQuantity ?? 0) <= 0) {
        return false;
    }
    return true;
}

function groupMatchesInventoryFilters(group) {
    const query = normalizeFilterText(state.filters.query);
    const groupNameMatches = query && normalizeFilterText(group.groupName).includes(query);
    if (groupNameMatches && !state.filters.deckName && !state.filters.onlyFree && !state.filters.onlyInDeck) {
        return true;
    }
    return (group.items || []).some((item) => itemMatchesInventoryFilters(item));
}

function applyInventoryFilters(report) {
    const sectionKey = state.filters.sectionKey;
    const sections = (report.sections || [])
        .filter((section) => !sectionKey || section.key === sectionKey)
        .map((section) => {
            const groups = (section.groups || []).filter((group) => groupMatchesInventoryFilters(group));
            return { ...section, groups };
        })
        .filter((section) => section.groups.length);
    return { ...report, sections };
}

function renderTableHeader(decks) {
    const groupColumnCount = 3 + decks.length;
    const topRow = ['<tr><th class="inventory-name-head sticky-name">卡牌名称</th>'];
    for (let index = 0; index < GROUPS_PER_ROW; index += 1) {
        topRow.push(`<th class="inventory-slot-head" colspan="${groupColumnCount}">记录 ${index + 1}</th>`);
    }
    topRow.push('</tr>');
    return topRow.join('');
}

function renderEmptyCells(count) {
    return Array.from({ length: count }, () => '<td class="inventory-empty-cell"></td>').join('');
}

function renderDataCell(value, className = '', style = '', title = '') {
    const styleAttribute = style ? ` style="${style}"` : '';
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    return `<td class="${className}"${styleAttribute}${titleAttribute}>${escapeHtml(value)}</td>`;
}

function renderItemCells(item, decks) {
    const tone = getRarityTone(item);
    const background = tone.color;
    const textColor = background ? getReadableTextColor(background) : '#132238';
    const toneStyle = background ? `background: ${background}; color: ${textColor};` : '';
    const productCode = item.displayProductCode || formatDisplayProductCode(item.productCode);
    const regulation = item.regulation || '-';
    const freeQuantity = Number(item.freeQuantity ?? 0);
    const cells = [
        renderDataCell(regulation, 'inventory-tone-cell inventory-mini-cell inventory-regulation-cell', toneStyle, `赛制：${regulation}`),
        renderDataCell(productCode || '-', 'inventory-tone-cell inventory-code-cell mono', toneStyle, `商品编号：${productCode || '-'}`),
        renderDataCell(freeQuantity, 'inventory-tone-cell inventory-number-cell inventory-mini-cell', toneStyle, `空闲：${freeQuantity}`)
    ];

    decks.forEach((deck) => {
        const quantity = item.deckQuantities?.[deck.name] ?? 0;
        const deckColor = normalizeColor(deck.color);
        const deckTextColor = getReadableTextColor(deckColor);
        const deckStyle = `background: ${deckColor}; color: ${deckTextColor};`;
        cells.push(renderDataCell(quantity, 'inventory-number-cell inventory-mini-cell inventory-deck-cell', deckStyle, `${deck.name}：${quantity}`));
    });
    return cells.join('');
}

function renderGroupActions(sectionKey, group, groupIndex, groupCount, groupName) {
    return `
        <div class="inventory-name-actions">
            <div class="inventory-group-reorder">
                <button
                    type="button"
                    class="inventory-group-move-btn"
                    data-action="move-group-up"
                    data-section-key="${escapeHtml(sectionKey)}"
                    data-group-key="${escapeHtml(group.groupKey)}"
                    title="上移 ${escapeHtml(groupName)}"
                    aria-label="上移 ${escapeHtml(groupName)}"
                    ${groupIndex === 0 ? 'disabled' : ''}
                >↑</button>
                <button
                    type="button"
                    class="inventory-group-move-btn"
                    data-action="move-group-down"
                    data-section-key="${escapeHtml(sectionKey)}"
                    data-group-key="${escapeHtml(group.groupKey)}"
                    title="下移 ${escapeHtml(groupName)}"
                    aria-label="下移 ${escapeHtml(groupName)}"
                    ${groupIndex === groupCount - 1 ? 'disabled' : ''}
                >↓</button>
            </div>
            <button type="button" class="inventory-edit-btn" data-action="open-group-editor" data-group-key="${escapeHtml(group.groupKey)}" aria-label="编辑 ${escapeHtml(groupName)} 库存" title="编辑 ${escapeHtml(groupName)} 库存"></button>
        </div>
    `;
}

function renderGroupRows(sectionKey, group, decks, groupIndex, groupCount) {
    const chunks = chunkItems(group.items || [], GROUPS_PER_ROW);
    const emptyCellCount = 3 + decks.length;
    const groupName = getInventoryGroupName(group);
    const attributeDots = renderGroupAttributeDots(group);
    return chunks.map((chunk, rowIndex) => {
        const rowCells = ['<tr>'];
        if (rowIndex === 0) {
            rowCells.push(`
                <td class="inventory-name-cell sticky-name" rowspan="${chunks.length}">
                    <div class="inventory-name-wrap">
                        ${renderGroupActions(sectionKey, group, groupIndex, groupCount, groupName)}
                        <div class="inventory-name-meta">
                            <div class="inventory-name-title-row">
                                <strong>${escapeHtml(groupName)}</strong>
                                ${attributeDots}
                            </div>
                        </div>
                    </div>
                </td>
            `);
        }

        for (let slot = 0; slot < GROUPS_PER_ROW; slot += 1) {
            const item = chunk[slot];
            rowCells.push(item ? renderItemCells(item, decks) : renderEmptyCells(emptyCellCount));
        }

        rowCells.push('</tr>');
        return rowCells.join('');
    }).join('');
}

function renderSection(section, decks) {
    const groupCount = section.groups?.length || 0;
    const itemCount = (section.groups || []).reduce((sum, group) => sum + (group.items?.length || 0), 0);

    if (!groupCount) {
        return '';
    }

    return `
        <section class="inventory-table-section">
            <div class="section-head">
                <h2 class="section-title">${escapeHtml(section.title)}</h2>
                <span class="section-count">${groupCount} 组 / ${itemCount} 条记录</span>
                <button type="button" class="secondary sort-groups-btn" data-action="sort-section-groups" data-section-key="${escapeHtml(section.key)}" title="调整${escapeHtml(section.title)}分类下的分组顺序">⚌ 排序</button>
            </div>
            <div class="inventory-table-scroll">
                <table class="inventory-grid">
                    <thead>${renderTableHeader(decks)}</thead>
                    <tbody>
                        ${(section.groups || []).map((group, groupIndex, groups) => renderGroupRows(section.key, group, decks, groupIndex, groups.length)).join('')}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function renderInventoryTableContent(report) {
    const filteredReport = applyInventoryFilters(report);
    const sections = (filteredReport.sections || []).map((section) => renderSection(section, report.decks || [])).join('');
    elements.content.innerHTML = sections || '<div class="empty-state">当前没有可展示的库存记录。</div>';
}

function renderInventoryTable(report, summary) {
    state.report = report;
    state.summary = summary;
    renderSummary(summary);
    renderDeckLegend(report.decks || []);
    renderRarityLegend();
    renderInventoryFilters(report);
    renderInventoryTableContent(report);
}

function findGroupByKey(groupKey) {
    for (const section of state.report?.sections || []) {
        const group = (section.groups || []).find((item) => item.groupKey === groupKey);
        if (group) {
            return group;
        }
    }
    return null;
}

function findSectionByKey(sectionKey) {
    return (state.report?.sections || []).find((section) => section.key === sectionKey) || null;
}

function renderModalTable(group, decks) {
    return `
        <table class="inventory-modal-table">
            <thead>
                <tr>
                    <th class="inventory-modal-order-head">顺序</th>
                    <th>编号</th>
                    <th>稀有度</th>
                    <th>卡牌名</th>
                    <th>赛制</th>
                    <th class="inventory-modal-qty-head">空闲</th>
                    ${decks.map((deck) => `<th class="inventory-modal-qty-head">${escapeHtml(deck.name)}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${(group.items || []).map((item) => {
                    const tone = getRarityTone(item);
                    const background = tone.color;
                    const textColor = background ? getReadableTextColor(background) : '#132238';
                    const productCode = item.displayProductCode || formatDisplayProductCode(item.productCode);
                    const displayCode = item.displayCode || `${productCode}-${item.displayCardCode || formatDisplayCardCode(item.cardCode)}`;
                    const rarityStyle = background ? ` style="background: ${background}; color: ${textColor};"` : '';
                    const cardName = escapeHtml(item.cardName);
                    return `
                        <tr data-card-id="${item.id}" data-card-name="${cardName}">
                            <td class="inventory-modal-order-cell">
                                <div class="inventory-modal-reorder">
                                    <button type="button" class="inventory-modal-move-btn" data-action="move-row-up" title="上移 ${cardName}" aria-label="上移 ${cardName}">上</button>
                                    <button type="button" class="inventory-modal-move-btn" data-action="move-row-down" title="下移 ${cardName}" aria-label="下移 ${cardName}">下</button>
                                </div>
                            </td>
                            <td class="mono inventory-modal-code-cell">${escapeHtml(displayCode)}</td>
                            <td class="inventory-modal-rarity-cell"${rarityStyle}>${escapeHtml(tone.label === '-' ? '' : tone.label)}</td>
                            <td class="inventory-modal-name-cell" data-role="card-name">${cardName}</td>
                            <td class="inventory-modal-regulation-cell">${escapeHtml(item.regulation || '-')}</td>
                            <td class="inventory-modal-qty-cell">
                                <input type="number" class="inventory-modal-input inventory-modal-qty-input" data-role="free-quantity" min="0" step="1" value="${Number(item.freeQuantity ?? 0)}" style="min-width:54px;width:54px">
                            </td>
                            ${decks.map((deck) => `
                                <td class="inventory-modal-qty-cell">
                                    <input type="number" class="inventory-modal-input inventory-modal-qty-input" data-role="deck-quantity" data-deck-id="${deck.id}" min="0" step="1" value="${Number(item.deckQuantities?.[deck.name] ?? 0)}" style="min-width:52px;width:52px">
                                </td>
                            `).join('')}
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function updateModalMoveButtons() {
    const rows = Array.from(elements.modalTableWrap.querySelectorAll('tbody tr[data-card-id]'));
    rows.forEach((row, index) => {
        const moveUpButton = row.querySelector('[data-action="move-row-up"]');
        const moveDownButton = row.querySelector('[data-action="move-row-down"]');
        if (moveUpButton) {
            moveUpButton.disabled = index === 0;
        }
        if (moveDownButton) {
            moveDownButton.disabled = index === rows.length - 1;
        }
    });
}

function moveModalRow(row, direction) {
    if (!row?.parentElement) {
        return;
    }

    const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) {
        return;
    }

    if (direction < 0) {
        row.parentElement.insertBefore(row, sibling);
    } else {
        row.parentElement.insertBefore(sibling, row);
    }

    updateModalMoveButtons();
    setStatus(elements.modalStatus, '已调整顺序，点击“保存修改”后生效。');
    const focusSelector = direction < 0 ? '[data-action="move-row-up"]' : '[data-action="move-row-down"]';
    row.querySelector(focusSelector)?.focus();
}

function openGroupEditor(groupKey) {
    const group = findGroupByKey(groupKey);
    if (!group) {
        alert('未找到对应分组，请刷新页面后重试。');
        return;
    }

    state.activeGroupKey = groupKey;
    state.modalNeedsRefresh = false;
    const displayName = getInventoryGroupName(group);
    elements.modalTitle.textContent = `修改库存：${displayName}`;
    elements.modalSubtitle.textContent = `共 ${group.items.length} 条记录，可直接修改数量，也可以在组内上下调整顺序。`;
    setStatus(elements.modalStatus, '修改后请点击“保存修改”，再手动关闭窗口刷新表格。');
    elements.modalTableWrap.innerHTML = renderModalTable(group, state.report?.decks || []);
    updateModalMoveButtons();
    elements.modal.hidden = false;
    document.body.classList.add('modal-open');
}

function parseNonNegativeInteger(value, fieldName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${fieldName}必须是大于等于 0 的整数`);
    }
    return parsed;
}

function collectModalPayload() {
    const group = findGroupByKey(state.activeGroupKey);
    if (!group) {
        throw new Error('当前分组不存在，请刷新后重试');
    }

    const rows = Array.from(elements.modalTableWrap.querySelectorAll('tbody tr[data-card-id]'));
    const cards = rows.map((row) => {
        const cardId = Number(row.dataset.cardId);
        const cardName = row.dataset.cardName || row.querySelector('[data-role="card-name"]')?.textContent?.trim() || '卡牌';
        const freeInput = row.querySelector('[data-role="free-quantity"]');
        const deckInputs = Array.from(row.querySelectorAll('[data-role="deck-quantity"]'));
        return {
            id: cardId,
            freeQuantity: parseNonNegativeInteger(freeInput?.value, `${cardName} 空闲数量`),
            deckQuantities: deckInputs.map((input) => ({
                deckId: Number(input.dataset.deckId),
                quantity: parseNonNegativeInteger(input.value, `${cardName} 卡组数量`)
            }))
        };
    });

    return {
        groupKey: group.groupKey,
        cards
    };
}

async function saveGroupChanges() {
    if (state.modalSaving) {
        return;
    }

    try {
        state.modalSaving = true;
        elements.modalSaveBtn.disabled = true;
        const payload = collectModalPayload();
        await api('/api/inventory-table/group-quantities', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        state.modalNeedsRefresh = true;
        setStatus(elements.modalStatus, '已保存修改。请点击“关闭”刷新库存表格。', 'success');
    } catch (error) {
        setStatus(elements.modalStatus, error.message, 'warning');
    } finally {
        state.modalSaving = false;
        elements.modalSaveBtn.disabled = false;
    }
}

async function closeGroupEditor() {
    const shouldRefresh = state.modalNeedsRefresh;
    elements.modal.hidden = true;
    document.body.classList.remove('modal-open');
    state.activeGroupKey = null;
    state.modalNeedsRefresh = false;
    elements.modalTableWrap.innerHTML = '';
    if (shouldRefresh) {
        await refreshInventoryTable();
    }
}

async function refreshInventoryTable() {
    const [summary, report] = await Promise.all([
        api('/api/summary'),
        api('/api/holdings')
    ]);
    renderInventoryTable(report, summary);
}

async function moveSectionGroup(sectionKey, groupKey, direction) {
    if (state.groupOrderSaving) {
        return;
    }

    const section = findSectionByKey(sectionKey);
    if (!section) {
        alert('未找到对应分类，请刷新页面后重试。');
        return;
    }

    const groupKeys = (section.groups || []).map((group) => group.groupKey);
    const currentIndex = groupKeys.indexOf(groupKey);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= groupKeys.length) {
        return;
    }

    [groupKeys[currentIndex], groupKeys[targetIndex]] = [groupKeys[targetIndex], groupKeys[currentIndex]];

    try {
        state.groupOrderSaving = true;
        await api('/api/inventory-table/group-order', {
            method: 'PUT',
            body: JSON.stringify({ sectionKey, groupKeys })
        });
        await refreshInventoryTable();
    } catch (error) {
        alert(error.message);
    } finally {
        state.groupOrderSaving = false;
    }
}

function bindEvents() {
    elements.filters?.addEventListener('input', (event) => {
        if (event.target.id === 'inventoryFilterQuery') {
            state.filters.query = event.target.value;
            renderInventoryTableContent(state.report);
        }
    });

    elements.filters?.addEventListener('change', (event) => {
        if (event.target.id === 'inventoryFilterSection') {
            state.filters.sectionKey = event.target.value;
        } else if (event.target.id === 'inventoryFilterDeck') {
            state.filters.deckName = event.target.value;
        } else if (event.target.id === 'inventoryFilterFree') {
            state.filters.onlyFree = event.target.checked;
        } else if (event.target.id === 'inventoryFilterInDeck') {
            state.filters.onlyInDeck = event.target.checked;
        } else {
            return;
        }
        renderInventoryTableContent(state.report);
    });

    elements.filters?.addEventListener('click', (event) => {
        if (event.target.id !== 'inventoryFilterReset') {
            return;
        }
        state.filters = { query: '', sectionKey: '', deckName: '', onlyFree: false, onlyInDeck: false };
        renderInventoryFilters(state.report);
        renderInventoryTableContent(state.report);
    });

    elements.content.addEventListener('click', async (event) => {
        const moveButton = event.target.closest('[data-action="move-group-up"], [data-action="move-group-down"]');
        if (moveButton && elements.content.contains(moveButton)) {
            await moveSectionGroup(
                moveButton.dataset.sectionKey,
                moveButton.dataset.groupKey,
                moveButton.dataset.action === 'move-group-up' ? -1 : 1,
            );
            return;
        }

        const button = event.target.closest('[data-action="open-group-editor"]');
        if (!button || !elements.content.contains(button)) {
            return;
        }
        openGroupEditor(button.dataset.groupKey);
    });

    // 分组排序按钮
    elements.content.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-action="sort-section-groups"]');
        if (btn && elements.content.contains(btn)) {
            openSortGroupsModal(btn.dataset.sectionKey);
        }
    });

    // 排序弹窗保存/关闭
    elements.sortModalSaveBtn.addEventListener('click', async () => {
        await saveSortGroupsOrder();
    });
    const sortCloseHandler = () => closeSortGroupsModal();
    elements.sortModalCloseBtn.addEventListener('click', sortCloseHandler);
    elements.sortModalCloseTop.addEventListener('click', sortCloseHandler);

    elements.modalTableWrap.addEventListener('click', (event) => {
        const moveButton = event.target.closest('[data-action="move-row-up"], [data-action="move-row-down"]');
        if (!moveButton || !elements.modalTableWrap.contains(moveButton)) {
            return;
        }

        const row = moveButton.closest('tr[data-card-id]');
        if (!row) {
            return;
        }

        moveModalRow(row, moveButton.dataset.action === 'move-row-up' ? -1 : 1);
    });

    elements.modalSaveBtn.addEventListener('click', async () => {
        await saveGroupChanges();
    });

    const closeHandler = async () => {
        await closeGroupEditor();
    };

    elements.modalCloseBtn.addEventListener('click', closeHandler);
    elements.modalCloseTop.addEventListener('click', closeHandler);
}

// ── 分组排序弹窗 ──────────────────────────────────────────────

let sortModalSectionKey = '';
let sortModalDraggedKey = null;

function openSortGroupsModal(sectionKey) {
    const section = findSectionByKey(sectionKey);
    if (!section || !section.groups?.length) {
        return;
    }
    sortModalSectionKey = sectionKey;
    sortModalDraggedKey = null;
    elements.sortModalTitle.textContent = `调整分组排序：${section.title}`;
    elements.sortModalSubtitle.textContent = `拖拽调整"${section.title}"下 ${section.groups.length} 个分组的顺序，点击"保存"生效。`;
    elements.sortModalStatus.textContent = '';
    elements.sortModalSaveBtn.disabled = false;
    renderSortGroupsList(section);
    elements.sortModal.hidden = false;
    document.body.classList.add('modal-open');
}

function closeSortGroupsModal() {
    sortModalSectionKey = '';
    sortModalDraggedKey = null;
    elements.sortModal.hidden = true;
    document.body.classList.remove('modal-open');
}

function renderSortGroupsList(section) {
    const groups = section.groups || [];
    elements.sortModalList.innerHTML = groups.map((group) => `
        <div class="sort-group-item" draggable="true" data-group-key="${escapeHtml(group.groupKey)}">
            <span class="sort-group-drag-handle" aria-hidden="true">⠿</span>
            <span class="sort-group-name">${escapeHtml(group.groupName || group.groupKey)}</span>
            <span class="sort-group-count">${group.items?.length || 0} 条</span>
        </div>
    `).join('');

    bindSortGroupDragEvents();
}

function bindSortGroupDragEvents() {
    const items = elements.sortModalList.querySelectorAll('.sort-group-item');
    items.forEach((item) => {
        item.addEventListener('dragstart', handleSortGroupDragStart);
        item.addEventListener('dragend', handleSortGroupDragEnd);
        item.addEventListener('dragover', handleSortGroupDragOver);
        item.addEventListener('dragleave', handleSortGroupDragLeave);
        item.addEventListener('drop', handleSortGroupDrop);
    });
}

function handleSortGroupDragStart(event) {
    sortModalDraggedKey = event.currentTarget.dataset.groupKey;
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sortModalDraggedKey);
}

function handleSortGroupDragEnd(event) {
    event.currentTarget.classList.remove('dragging');
    elements.sortModalList.querySelectorAll('.sort-group-item').forEach((el) => {
        el.classList.remove('drag-over');
    });
}

function handleSortGroupDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (event.currentTarget.dataset.groupKey !== sortModalDraggedKey) {
        event.currentTarget.classList.add('drag-over');
    }
}

function handleSortGroupDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

function handleSortGroupDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const targetKey = event.currentTarget.dataset.groupKey;
    if (!sortModalDraggedKey || targetKey === sortModalDraggedKey) {
        return;
    }

    const list = elements.sortModalList;
    const dragged = findSortGroupItem(sortModalDraggedKey);
    const target = event.currentTarget;
    if (!dragged || !target) {
        return;
    }

    // Drop above or below based on mouse Y
    const rect = target.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
        list.insertBefore(dragged, target);
    } else {
        list.insertBefore(dragged, target.nextSibling);
    }
}

function findSortGroupItem(groupKey) {
    const items = elements.sortModalList.querySelectorAll('.sort-group-item');
    for (const item of items) {
        if (item.dataset.groupKey === groupKey) {
            return item;
        }
    }
    return null;
}

async function saveSortGroupsOrder() {
    const items = elements.sortModalList.querySelectorAll('.sort-group-item');
    const groupKeys = Array.from(items).map((el) => el.dataset.groupKey);
    if (!sortModalSectionKey || groupKeys.length < 2) {
        return;
    }
    elements.sortModalSaveBtn.disabled = true;
    try {
        await api('/api/inventory-table/group-order', {
            method: 'PUT',
            body: JSON.stringify({ sectionKey: sortModalSectionKey, groupKeys }),
        });
        closeSortGroupsModal();
        await refreshInventoryTable();
    } catch (error) {
        elements.sortModalStatus.textContent = error.message;
        elements.sortModalStatus.className = 'status-line';
        elements.sortModalSaveBtn.disabled = false;
    }
}

(async function init() {
    try {
        bindEvents();
        await refreshInventoryTable();
    } catch (error) {
        elements.content.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
})();