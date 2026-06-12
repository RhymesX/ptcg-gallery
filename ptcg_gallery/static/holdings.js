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

function formatDisplayProductCode(value) {
    const text = String(value ?? '').trim();
    return /^151C[1-4]$/i.test(text) ? '151C' : text;
}

function formatDisplayCardCode(value) {
    const text = String(value ?? '').trim();
    return text.split('/', 1)[0].trim();
}

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
const ATTRIBUTE_COLORS = {
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

function normalizeColor(value) {
    const text = String(value ?? '').trim();
    return text || '#edf2fb';
}

function getReadableTextColor(backgroundColor) {
    const color = normalizeColor(backgroundColor);
    const match = color.match(/^#?([0-9a-f]{6})$/i);
    if (!match) {
        return '#30445f';
    }

    const hex = match[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.65 ? '#132238' : '#ffffff';
}

function parseTargetQuantity(value) {
    const target = Number(value);
    if (!Number.isInteger(target) || target < 0) {
        throw new Error('数量必须是大于等于 0 的整数');
    }
    return target;
}

function renderQuantityEditor(label, value, options = {}) {
    const styleParts = [];
    if (options.backgroundColor) {
        styleParts.push(`background: ${options.backgroundColor}`);
        styleParts.push(`--editor-bg: ${options.backgroundColor}`);
    }
    if (options.textColor) {
        styleParts.push(`color: ${options.textColor}`);
        styleParts.push(`--editor-text: ${options.textColor}`);
    }
    const style = styleParts.length ? ` style="${styleParts.join('; ')}"` : '';
    const deckIdAttribute = Number.isFinite(options.deckId) ? ` data-deck-id="${options.deckId}"` : '';
    const extraClass = options.extraClass ? ` ${options.extraClass}` : '';
    const quantityValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    const showLabel = options.showLabel !== false;
    const labelMarkup = showLabel
        ? `<span class="quantity-editor-label">${escapeHtml(label)}</span>`
        : '<span class="quantity-editor-label quantity-editor-label-hidden" aria-hidden="true"></span>';
    const controlLabel = escapeHtml(options.controlLabel || label || '数量');
    const title = options.title ? ` title="${escapeHtml(options.title)}"` : '';

    return `
        <div class="quantity-editor${extraClass}"${style}${title}>
            ${labelMarkup}
            <input type="number" class="quantity-input" min="0" step="1" inputmode="numeric" value="${quantityValue}" data-current="${quantityValue}" aria-label="${controlLabel}" title="${controlLabel}">
            <button type="button" class="secondary quantity-apply-btn" data-action="${escapeHtml(options.action || '')}"${deckIdAttribute} aria-label="设置${controlLabel}" title="设置${controlLabel}">改</button>
        </div>
    `;
}

function extractAttributes(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        return [];
    }

    const attributes = ATTRIBUTE_ORDER.filter((attribute) => ATTRIBUTE_ALIASES[attribute].some((alias) => text.includes(alias)));
    return attributes.length ? attributes : [text];
}

function collectGroupAttributes(items) {
    const seen = new Set();
    const attributes = [];
    for (const item of items || []) {
        for (const attribute of extractAttributes(item?.attribute)) {
            if (seen.has(attribute)) {
                continue;
            }
            seen.add(attribute);
            attributes.push(attribute);
        }
    }
    return attributes;
}

function getAttributeColor(attribute) {
    return ATTRIBUTE_COLORS[attribute] || '#9aa0a6';
}

function renderAttributeMarkers(group) {
    if (!group || group.groupName === group.groupBaseName) {
        return '';
    }

    const attributes = collectGroupAttributes(group.items);
    if (!attributes.length) {
        return '';
    }

    return `
        <span class="group-attribute-markers">
            ${attributes.map((attribute) => `<span class="attribute-marker" style="color: ${getAttributeColor(attribute)}" title="${escapeHtml(attribute)}" aria-hidden="true">○</span>`).join('')}
        </span>
    `;
}

function renderDeckLegend(decks) {
    const legend = document.getElementById('deckLegend');
    if (!legend) {
        return;
    }

    if (!decks.length) {
        legend.innerHTML = '';
        return;
    }

    legend.innerHTML = decks.map((deck) => {
        const color = normalizeColor(deck.color);
        return `
            <span class="deck-legend-item">
                <span class="deck-legend-swatch" style="background: ${color}"></span>
                <span class="deck-legend-name">${escapeHtml(deck.name)}</span>
            </span>
        `;
    }).join('');
}

function renderSummary(summary) {
    const cards = [
        { label: '空闲', value: summary.freeCount ?? 0 },
        { label: '在卡组', value: summary.inDeckCount ?? 0 },
        { label: '总持有', value: summary.ownedCount ?? 0 },
        { label: '卡组数', value: summary.deckCount ?? 0 },
    ];

    document.getElementById('summaryCards').innerHTML = cards.map((item) => `
        <div class="stat-card">
            <span class="value">${item.value}</span>
            <span>${item.label}</span>
        </div>
    `).join('');
}

function renderFreeField(value) {
    const freeQuantity = Number.isFinite(Number(value)) ? Number(value) : 0;
    const freeEditor = renderQuantityEditor('空闲设置', freeQuantity, {
        action: 'adjust-free',
        extraClass: 'free record-free-editor',
        showLabel: false,
        controlLabel: '空闲数量',
        title: '空闲数量'
    });

    return `
        <div class="record-free-group">
            <div class="record-field record-strong-field record-free-field">
                <span>空闲</span>
                <strong>${freeQuantity}</strong>
            </div>
            ${freeEditor}
        </div>
    `;
}

function renderRecordCard(item, decks) {
    const displayCode = item.displayCode || `${item.displayProductCode || formatDisplayProductCode(item.productCode)}-${item.displayCardCode || formatDisplayCardCode(item.cardCode)}`;
    const freeField = renderFreeField(item.freeQuantity ?? 0);
    const deckEditors = (decks || []).map((deck) => {
        const backgroundColor = normalizeColor(deck.color);
        return renderQuantityEditor(deck.name, item.deckQuantities?.[deck.name] ?? 0, {
            action: 'adjust-deck',
            deckId: Number(deck.id),
            showLabel: false,
            title: deck.name,
            controlLabel: `${deck.name} 数量`,
            backgroundColor,
            textColor: getReadableTextColor(backgroundColor)
        });
    }).join('');

    return `
        <article class="record-card" data-card-id="${item.id}">
            <button type="button" class="record-delete-icon" data-action="delete-card" aria-label="删除卡牌" title="删除卡牌">×</button>
            <div class="record-top-row">
                <div class="record-field record-code-field">
                    <span>编号</span>
                    <strong class="mono record-code-value">${escapeHtml(displayCode)}</strong>
                </div>
                <div class="record-field">
                    <span>赛制</span>
                    <strong>${escapeHtml(item.regulation || '-')}</strong>
                </div>
                <div class="record-field">
                    <span>稀有度</span>
                    <strong>${escapeHtml(item.rarity || '-')}</strong>
                </div>
                <div class="record-field record-strong-field">
                    <span>总持有</span>
                    <strong>${item.ownedQuantity ?? 0}</strong>
                </div>
                ${freeField}
            </div>
            <div class="record-quantity-row">
                ${deckEditors}
            </div>
        </article>
    `;
}

function renderGroup(group, decks) {
    const items = group.items && group.items.length
        ? group.items.map((item) => renderRecordCard(item, decks)).join('')
        : `<div class="empty-table">当前组没有卡牌。</div>`;
    const attributeMarkers = renderAttributeMarkers(group);
    const titleText = escapeHtml(group.groupBaseName || group.groupName);

    return `
        <section class="group-block">
            <div class="group-head">
                <h3 class="group-title"><span class="group-title-text">${titleText}</span>${attributeMarkers}</h3>
                <span class="group-count">${group.items.length} 条</span>
            </div>
            <div class="group-records">${items}</div>
        </section>
    `;
}

function renderHoldings(report, summary) {
    renderSummary(summary);
    const content = document.getElementById('holdingsContent');
    const template = document.getElementById('holdingsSectionTemplate');
    const decks = report.decks || [];
    renderDeckLegend(decks);
    content.innerHTML = '';

    (report.sections || []).forEach((section) => {
        const node = template.content.firstElementChild.cloneNode(true);
        node.querySelector('.section-title').textContent = section.title;
        const groupCount = section.groups?.length || 0;
        const itemCount = section.groups?.reduce((sum, group) => sum + (group.items?.length || 0), 0) || 0;
        node.querySelector('.section-count').textContent = `${groupCount} 组 / ${itemCount} 条记录`;
        node.querySelector('.group-list').innerHTML = (section.groups || []).map((group) => renderGroup(group, decks)).join('');
        content.appendChild(node);
    });
}

async function refreshHoldings() {
    const [summary, report] = await Promise.all([api('/api/summary'), api('/api/holdings')]);
    renderHoldings(report, summary);
}

function bindHoldingsActions() {
    const content = document.getElementById('holdingsContent');
    content.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button || !content.contains(button)) {
            return;
        }

        const cardNode = button.closest('.record-card');
        const cardId = Number(cardNode?.dataset.cardId);
        if (!Number.isFinite(cardId)) {
            return;
        }

        const action = button.dataset.action;

        try {
            if (action === 'adjust-free' || action === 'adjust-deck') {
                const editor = button.closest('.quantity-editor');
                const input = editor?.querySelector('.quantity-input');
                if (!input) {
                    return;
                }

                const current = Number(input.dataset.current);
                const target = parseTargetQuantity(input.value);
                if (!Number.isFinite(current) || target === current) {
                    return;
                }

                if (action === 'adjust-free') {
                    await api(`/api/cards/${cardId}/free-adjust`, {
                        method: 'POST',
                        body: JSON.stringify({ delta: target - current })
                    });
                } else {
                    const deckId = Number(button.dataset.deckId);
                    if (!Number.isFinite(deckId)) {
                        return;
                    }
                    const amount = Math.abs(target - current);
                    if (target > current) {
                        await api(`/api/cards/${cardId}/add-to-deck`, {
                            method: 'POST',
                            body: JSON.stringify({ deckId, amount, consumeFree: false })
                        });
                    } else {
                        await api(`/api/cards/${cardId}/remove-from-deck`, {
                            method: 'POST',
                            body: JSON.stringify({ deckId, amount, backToFree: false })
                        });
                    }
                }

                await refreshHoldings();
                return;
            }

            if (action === 'delete-card') {
                if (!confirm('确认删除这张卡牌？删除后会同时从库存和卡组中移除。')) {
                    return;
                }
                await api(`/api/cards/${cardId}`, {
                    method: 'DELETE'
                });
                await refreshHoldings();
            }
        } catch (error) {
            alert(error.message);
        }
    });

    content.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter') {
            return;
        }
        const input = event.target.closest('.quantity-input');
        if (!input || !content.contains(input)) {
            return;
        }
        event.preventDefault();
        const button = input.closest('.quantity-editor')?.querySelector('.quantity-apply-btn');
        if (button) {
            button.click();
        }
    });
}

(async function init() {
    try {
        bindHoldingsActions();
        await refreshHoldings();
    } catch (error) {
        document.getElementById('holdingsContent').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
})();
