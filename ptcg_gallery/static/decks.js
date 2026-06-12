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

const state = { decks: [], editId: null };
const elements = {
    deckList: document.getElementById('deckList'),
    deckStatus: document.getElementById('deckStatus'),
    deckForm: document.getElementById('deckForm'),
    deckIdInput: document.getElementById('deckIdInput'),
    deckNameInput: document.getElementById('deckNameInput'),
    deckDescriptionInput: document.getElementById('deckDescriptionInput'),
    deckColorInput: document.getElementById('deckColorInput'),
    resetDeckBtn: document.getElementById('resetDeckBtn')
};

let draggedDeckId = null;

function getDeckOrderFromDom() {
    return Array.from(elements.deckList.querySelectorAll('.deck-manage-card'))
        .map((node) => Number(node.dataset.deckId))
        .filter((deckId) => Number.isFinite(deckId));
}

function clearDropIndicators() {
    elements.deckList.querySelectorAll('.deck-manage-card').forEach((node) => {
        node.classList.remove('drag-over-before', 'drag-over-after');
    });
}

function clearDraggingState() {
    elements.deckList.querySelectorAll('.deck-manage-card').forEach((node) => {
        node.classList.remove('dragging');
    });
}

async function saveDeckOrder() {
    const deckIds = getDeckOrderFromDom();
    try {
        const payload = await api('/api/decks/reorder', {
            method: 'POST',
            body: JSON.stringify({ deckIds })
        });
        state.decks = payload.items || [];
        renderDecks();
        setStatus(elements.deckStatus, '已更新卡组顺序。', 'success');
    } catch (error) {
        await loadDecks();
        setStatus(elements.deckStatus, error.message, 'warning');
    }
}

function getDropSide(event, node) {
    const rect = node.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function handleDragStart(event) {
    const cardNode = event.currentTarget.closest('.deck-manage-card');
    draggedDeckId = Number(cardNode?.dataset.deckId);
    if (!Number.isFinite(draggedDeckId) || !cardNode) {
        event.preventDefault();
        return;
    }
    cardNode.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(draggedDeckId));
}

function handleDragEnd() {
    draggedDeckId = null;
    clearDropIndicators();
    clearDraggingState();
}

function handleDragOver(event) {
    if (!Number.isFinite(draggedDeckId)) {
        return;
    }
    const target = event.currentTarget;
    const targetDeckId = Number(target.dataset.deckId);
    if (targetDeckId === draggedDeckId) {
        return;
    }
    event.preventDefault();
    clearDropIndicators();
    target.classList.add(`drag-over-${getDropSide(event, target)}`);
}

async function handleDrop(event) {
    event.preventDefault();
    const target = event.currentTarget;
    const targetDeckId = Number(target.dataset.deckId);
    if (!Number.isFinite(draggedDeckId) || targetDeckId === draggedDeckId) {
        clearDropIndicators();
        return;
    }

    const draggedNode = elements.deckList.querySelector(`.deck-manage-card[data-deck-id="${draggedDeckId}"]`);
    if (!draggedNode) {
        clearDropIndicators();
        return;
    }

    const dropSide = getDropSide(event, target);
    if (dropSide === 'before') {
        target.before(draggedNode);
    } else {
        target.after(draggedNode);
    }
    clearDropIndicators();
    await saveDeckOrder();
}

function clearDeckForm() {
    state.editId = null;
    elements.deckIdInput.value = '';
    elements.deckNameInput.value = '';
    elements.deckDescriptionInput.value = '';
    elements.deckColorInput.value = '#9ca3af';
}

function fillDeckForm(deck) {
    state.editId = deck.id;
    elements.deckIdInput.value = deck.id;
    elements.deckNameInput.value = deck.name || '';
    elements.deckDescriptionInput.value = deck.description || '';
    elements.deckColorInput.value = deck.color || '#9ca3af';
    setStatus(elements.deckStatus, `正在编辑卡组：${deck.name}`, 'normal');
}

function renderDecks() {
    if (!state.decks.length) {
        elements.deckList.innerHTML = '<div class="empty-state">还没有卡组，先创建一个吧。</div>';
        return;
    }

    const template = document.getElementById('deckRowTemplate');
    elements.deckList.innerHTML = '';
    state.decks.forEach((deck) => {
        if (!template || !template.content || !template.content.firstElementChild) {
            elements.deckList.innerHTML = '<div class="empty-state">卡组模板未加载。</div>';
            return;
        }
        const node = template.content.firstElementChild.cloneNode(true);
        node.dataset.deckId = deck.id;
        node.style.setProperty('--deck-color', deck.color || '#9ca3af');

        const colorSwatch = node.querySelector('.deck-color-swatch');
        if (colorSwatch) {
            colorSwatch.style.background = deck.color || '#9ca3af';
        }

        const deckName = node.querySelector('.deck-name');
        if (deckName) {
            deckName.textContent = deck.name;
        }

        const deckCount = node.querySelector('.deck-count');
        if (deckCount) {
            deckCount.textContent = `${deck.cardCount || 0} 张卡牌`;
        }

        const deckDescription = node.querySelector('.deck-description');
        if (deckDescription) {
            deckDescription.textContent = deck.description || '暂无描述';
        }

        const deckOrderHandle = node.querySelector('.deck-order-handle');
        if (deckOrderHandle) {
            deckOrderHandle.textContent = '⋮⋮';
            deckOrderHandle.draggable = true;
            deckOrderHandle.addEventListener('dragstart', handleDragStart);
            deckOrderHandle.addEventListener('dragend', handleDragEnd);
        }

        const detailLink = node.querySelector('.deck-detail-link');
        if (detailLink) {
            detailLink.href = `/decks/${deck.id}`;
            detailLink.textContent = '查看详情';
        }

        const editButton = node.querySelector('.edit-deck');
        if (editButton) {
            editButton.addEventListener('click', () => fillDeckForm(deck));
        }

        const deleteButton = node.querySelector('.delete-deck');
        if (deleteButton) {
            deleteButton.addEventListener('click', async () => {
                if (!confirm(`确认整体删除卡组“${deck.name}”？删除后卡组中的卡片会自动转回空闲。`)) {
                    return;
                }
                try {
                    await api(`/api/decks/${deck.id}`, { method: 'DELETE' });
                    setStatus(elements.deckStatus, `已整体删除卡组：${deck.name}`, 'success');
                    clearDeckForm();
                    await loadDecks();
                } catch (error) {
                    setStatus(elements.deckStatus, error.message, 'warning');
                }
            });
        }
        node.addEventListener('dragover', handleDragOver);
        node.addEventListener('drop', handleDrop);
        elements.deckList.appendChild(node);
    });
}

async function loadDecks() {
    const payload = await api('/api/decks');
    state.decks = payload.items || [];
    renderDecks();
}

if (elements.deckForm) {
    elements.deckForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
            name: elements.deckNameInput.value.trim(),
            description: elements.deckDescriptionInput.value.trim(),
            color: elements.deckColorInput.value.trim()
        };
        try {
            if (state.editId) {
                await api(`/api/decks/${state.editId}`, { method: 'PUT', body: JSON.stringify(payload) });
                setStatus(elements.deckStatus, `已更新卡组：${payload.name}`, 'success');
            } else {
                await api('/api/decks', { method: 'POST', body: JSON.stringify(payload) });
                setStatus(elements.deckStatus, `已创建卡组：${payload.name}`, 'success');
            }
            clearDeckForm();
            await loadDecks();
        } catch (error) {
            setStatus(elements.deckStatus, error.message, 'warning');
        }
    });
}

if (elements.resetDeckBtn) {
    elements.resetDeckBtn.addEventListener('click', () => {
        clearDeckForm();
        setStatus(elements.deckStatus, '已清空卡组表单。', 'normal');
    });
}

(async function init() {
    try {
        clearDeckForm();
        await loadDecks();
        setStatus(elements.deckStatus, `当前共有 ${state.decks.length} 个卡组。`, 'normal');
    } catch (error) {
        setStatus(elements.deckStatus, error.message, 'warning');
    }
})();

