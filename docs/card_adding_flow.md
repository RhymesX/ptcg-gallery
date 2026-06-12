# 卡牌添加流程与库存展示逻辑

本文档说明向空闲库存添加一张卡时，从 API 入口到最终库存页面展示的完整处理流程。

---

## 一、触发路径

新增空闲库存的入口有两个：

| HTTP 方法 | API 路径 | 用途 |
|-----------|----------|------|
| `POST` | `/api/cards/<card_id>/free-adjust` | 空闲库存 ±N（含首次从 0→1） |
| `PUT` | `/api/cards/<card_id>/free-quantity` | 直接设置空闲库存值 |

**不触发排序的场景**：删除卡组退卡、调整总持有量、Excel/CSV 导入、（同名卡第二次及之后添加）——这些路径均不再触发自动排序。

---

## 二、排序门控 —— `_ensure_sort_order_on_first_add`

只有同时满足以下三个条件才触发排序：

1. `old_qty == 0`（该卡此前无空闲库存）且 `new_qty > 0`
2. `card_type` 属于 `{'宝可梦', '训练家', '能量'}`（注：DB 中 card_type 只有这 3 个值；`支援者/物品/道具/竞技场` 是 card_type=`训练家` 通过 `detail` 细分）
3. 刚写入的 free_inventory 确实 > 0（双重校验）

**同名卡再加一张**：此时 `old_qty > 0`，直接跳过排序，什么都不改。

---

## 三、排序分配 —— `_assign_sort_order`

实际分配两层排序数据。

### 3.1 入口分类

将卡牌通过 `classify_card()` 分为宝可梦（`is_pokemon_category_key==True`）和非宝可梦。

#### 分类规则 (`classify_card`)

取 `card_type + detail + card_name + special_text` 拼接后匹配（优先级从上到下）：

| 匹配 | category_key | 说明 |
|------|-------------|------|
| 硬编码 `勇气护符` / `学习装置` | `tool` | 强制归道具 |
| `宝可梦GX` | `pokemon_gx` | |
| `宝可梦V` | `pokemon_v` | |
| `宝可梦ex` | `pokemon_ex` | |
| `光辉宝可梦` | `radiant_pokemon` | |
| `特殊能量` | `special_energy` | |
| `普通能量` | `basic_energy` | |
| `物品` | `item` | |
| `支援者` | `supporter` | |
| `竞技场` | `stadium` | |
| `道具` | `tool` | |
| `宝可梦` | `ordinary_pokemon` | |
| `能量` | `basic_energy` | |
| (兜底) | `ordinary_pokemon` | |

### 3.2 非宝可梦（训练家/物品/道具/竞技场/能量）

**直接追加到末尾**。gso = `COALESCE(MAX 全局 group_sort_order, 0) + 1`。

示例（支援者分区）：

```
现有支援者：    gso=0 奇树   gso=0 老大的指令（赤日）   gso=0 老大的指令（坂木）
新增博士的研究（弗图）：gso=1 → 排在 last（order_key=1 > 0）
```

**设计原因**：训练家/能量类无需属性分群，且旧数据 gso=0 堆积，新卡用 gso=MAX+1 自然排到最后。

### 3.3 宝可梦

按**同 category + 同属性**分组，在组内用 `(属性索引, 发售顺序)` 二分插入。

#### sort_key 计算

```
attr_idx = ATTRIBUTE_ORDER_INDEX[属性]      # 例：火=1, 钢=7, 未知=11
release_idx = 卡表.xlsx 中该 product_code 首次出现的行号  # 不在卡表中的 code 返回 9999
sort_key = attr_idx × 10000 + release_idx
```

#### 属性别名（数据库存的可能不是标准汉字）

| 标准属性 | DB 中可能的值 |
|----------|--------------|
| 草 | 草 |
| 火 | 火、炎 |
| 水 | 水 |
| 电 | 电、雷 |
| 超 | 超 |
| 斗 | 斗 |
| 恶 | 恶 |
| 钢 | 钢、金属 |
| 龙 | 龙 |
| 妖 | 妖、妖精 |
| 无 | 无、无色 |

#### 插入算法

```
1. 扫描所有卡片，选出同 category + 同属性 + 当前有库存的卡
2. 按 rk 排序，bisect_right 找到插入位置
3. 插入位置之后的卡片 gso 全部 +1（Shift）
4. 新卡 gso = 插入位置 + 1
```

示例（普通宝可梦，火属性）：

```
现有： 小火龙(151C1, rk=10168, gso=1)  小火焰猴(CSV5C, rk=10209, gso=2)
新增： 炭小侍(CSV9C, rk=10259, gso=?) → bisect_right → gso=3 排在最后
```

示例（普通宝可梦，水属性，第一个水属性宝可梦）：

```
现有： 无同属性
新增： 铁包袱(CSV6C, rk=20247, gso=?) → existing=空 → gso=1
```

---

## 四、组间顺序 —— `_insert_holdings_group_order`

只控制 **holdings 页面中同 section 内各组（同名卡组）的排列**，不影响卡池内单卡排序。

### 逻辑

```
1. 查 holdings_group_orders 表中该 section + group_key 是否已有记录
2. 有 → 不动（保留用户已有的手动排序）
3. 无 → 追加到该 section 末尾: sort_order = MAX(sort_order, 0) + 1
```

**同名卡加第二张**：group_key 已存在 → `_insert_holdings_group_order` 直接 return，不改变组顺序。用户之前对 `宝可梦捕捉器` 组的拖拽排序不会被打乱。

---

## 五、库存展示 —— `holdings_report()`

### 5.1 分组

- 所有卡按 `classify_card` 分到 11 个 section
- section 内部按 `build_holdings_group_key(category_key, card_name)` 同名归组
- 同名规则（`remove_card_name_variants`）：
  - 去 `·精灵球闪`、`·大师球闪`、`·球闪` 后缀
  - `神奇糖果`、`超级球`、`博士的研究`、`老大的指令`、`宝可梦捕捉器`、`裁判`、`巢穴球` → 取关键词作为组名（忽略括号变体）

### 5.2 组排序（每组一行）

```python
build_holdings_group_sort_key = (
    groupSortOrder if groupSortOrder > 0 else 10000,   # ← holdings_group_orders 表
    attribute_sort_index,                               # 仅宝可梦
    groupBaseName,
    productCode, cardCode, rarity
)
```

- `groupSortOrder > 0` 的组（手动排过）排在最前（order_key 越小越前）
- `groupSortOrder = 0` 的组（新增/未排序）用 order_key=10000 → 排在手动组之后
- 宝可梦在 order_key 相同时按属性索引排序

### 5.3 组内排序（每组内每条记录）

```python
build_holdings_item_sort_key = (
    groupSortOrder if groupSortOrder > 0 else 10000,
    attribute_sort_index,                               # 仅宝可梦
    productCode, cardCode, rarity, cardName, id
)
```

所以 `cards.group_sort_order` 在这里**不直接参与排序**（已被 `inventory_table` 的表格版排序使用）。组内排序在 holdings 中总是按 productCode → cardCode → rarity → name。

---

## 六、库存表格页面的不同之处

`/inventory-table` 页面在组内显示顺序复用 `_summary_from_row` 返回的 `groupSortOrder`（即 `cards.group_sort_order`），因此宝可梦类卡片在库存表格的组内会按发售顺序排列。

---

## 七、完整流程速查表

| 卡牌类型 | 首次添加 (old_qty=0→new>0) | 同名再加 (old_qty>0) | gso 变化 | 组间顺序变化 |
|----------|--------------------------|---------------------|---------|------------|
| 宝可梦 | ✅ 同 category+同属性内按发售顺序插入 | ❌ 不触发 | gso 可能 Shift 后方卡 | 新组追加末尾；已有组不动 |
| 训练家/道具/能量 | ✅ 追加到全局末尾 | ❌ 不触发 | 新卡 gso=MAX+1 | 新组追加末尾；已有组不动 |
| 删卡组退卡 | ❌ | ❌ | 不动 | 不动 |
| 调整总持有量 | ❌ | ❌ | 不动 | 不动 |

---

## 八、关键数据表

### `cards.group_sort_order`

- 组内顺序标识
- 宝可梦：按属性+发售顺序自动分配
- 非宝可梦：追加到全局末尾

### `holdings_group_orders`

| 列 | 说明 |
|----|------|
| section_key | 分类 key，如 `ordinary_pokemon`、`supporter` |
| group_key | 格式 `pokemon_ex::铝钢桥龙ex` |
| sort_order | 1-based 顺序；`=0` 表示未排序（排到最后） |

- 新增卡组时自动追加（新 sort_order=当前最大值+1）
- 用户通过库存表格的"⚌ 排序"弹窗可拖拽调整
- 同名卡再加不改变排序

### `_get_release_index(product_code)`

- 读取 `data/卡表.xlsx`，取该 `product_code` **首次出现**的行号
- 不在卡表中的 code 返回 9999（排在末尾）
- 结果被缓存为全局变量，不随请求刷新
