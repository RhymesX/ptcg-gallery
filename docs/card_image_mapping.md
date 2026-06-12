# 卡牌图片映射说明

## 图片源优先级

| 优先级 | 数据源 | 类型 | 说明 |
|--------|--------|------|------|
| 1 | `data/card_images_user/` | 用户手动放入的本地简中图片 | 最高优先级，文件名匹配 |
| 2 | `tcg.mik.moe` CDN | 自动获取简中卡图 | 通过产品索引+卡名匹配 |
| 3 | `api.pokemontcg.io` | 英文卡图兜底 | 中英名称翻译后搜索 |

---

## 数据源 1：card_images_user 命名规则

简中卡图放入 `data/card_images_user/` 目录，系统按以下顺序查找（找到即停止）：

| 顺序 | 格式 | 示例 | 适用场景 |
|------|------|------|---------|
| 1 | `{product_code}-{card_name}.png` | `PROMO9-神奇糖果.png` | PROMO无数字编号的卡 |
| 2 | `{product_code}-{card_code}.jpg` | `CSM1aC-002.jpg` | 标准产品 |
| 3 | `{product_code}_{card_code}.png` | `CSM1aC_002.png` | 同上的替代格式 |
| 4 | `{card_name}.webp` | `小火龙.webp` | 用卡名匹配 |

**PROMO 无数字编号命名示例（不同变体不混用）**：

| 卡牌 | 文件名 |
|------|--------|
| 2024深圳糖（基础） | `PROMO9-神奇糖果.png` |
| 2024深圳糖 冠军 | `PROMO9-神奇糖果·冠军.png` |
| 2024深圳糖 亚军 | `PROMO9-神奇糖果·亚军.png` |
| 胜利之证 冠军 | `PROMO6-胜利之证·冠军.png` |

---

## 数据源 2：tcg.mik.moe 映射规则

网站 URL 模式：`https://tcg.mik.moe/static/img/{setId}/{cardIndex}.png`

### A. 标准系列 — 产品索引 + 卡名匹配

**流程**：
1. `product_code` 规范化（见 alias 表）
2. 请求 `/api/v3/card/product-detail` 获取产品全部卡牌
3. 按 `cardName` 精确匹配
4. 球闪后缀自动去除后重新匹配
5. 同名多值时用 `card_code` 数字匹配

**product_code 规范化 (alias)**：

| DB product_code | mikmoe setId |
|-----------------|-------------|
| `151C1/2/3/4` | `151C` |
| `CSEC1/2/4` | `CSEC` |
| `CSHC1/2` | `CSHC` |
| `CSVE1C1/CSVE1C2` | `CSVE1C` |
| `CSVE1pC2` | `CSVE1pC` |
| `CSVE2C1/CSVE2C2` | `CSVE2C` |
| `CSVE2pC2` | `CSVE2pC` |

**cardIndex 匹配**：`"054/072"→"54"`, `"081"→"81"`

**球闪后缀**：`"铝钢桥龙·精灵球闪"→"铝钢桥龙"`、`"·大师球闪"→同上`

### B. PROMO 系列 — 直接取编号数字

| card_code后缀 | setId | URL示例 |
|---------------|-------|---------|
| `SM-P` | `SMP` | `SMP/001.png` |
| `S-P` | `SSP` | `SSP/049.png` |
| `SV-P` | `SVP` | `SVP/242.png` |
| `30th-P` | `30thP` | `30thP/001.png` |

**映射**：PROMO1~2→SMP, PROMO3~20→SSP, PROMO21+SVxx→SVP, MISSION01~07→SVP, 30th-P-01→30thP

---

## 数据源 3：PTCG API 英文兜底

中英名称翻译后在 `api.pokemontcg.io/v2` 搜索英文卡图。

---

## 卡图下载模式

首页右侧"卡图下载"面板 4 种模式：

| 模式 | 行为 |
|------|------|
| **仅本地** | 不下载，仅用本地图片 |
| **点开下载** | 搜索结果不下载，点击详情时才下载 |
| **持续爬取** | 后台逐卡补全所有卡图 |
| **凌晨3点** | 每天凌晨3点自动爬一轮 |

---

## 卡图覆盖情况

| 类别 | 卡牌数 | 比例 |
|------|--------|------|
| mikmoe 自动映射 | 17,447 | 99.0% |
| 需手动放图（PROMO无数字编号） | 178 | 1.0% |

### 需手动放图的 178 张卡

card_code不含数字（纯SM-P/S-P/SV-P/DAR等），建议用 `{product_code}-{card_name}.png` 格式放入 `card_images_user/`：

| 产品 | card_code | 典型卡牌 |
|------|-----------|---------|
| PROMO, PROMO1, PROMO2 | SM-P（无数字） | 胜利勋章·冠军 |
| PROMO4,6,9,13~15,19,26,27 | S-P（无数字） | 胜利之证·冠军、精灵球·冠军 |
| PROMO22, SV01, SV03, SV06 | SV-P（无数字） | 超级球·冠军、乐园度假地 |
| PROMOSV02 | DAR/FIG等 | 基本能量卡 |
| PROMOSVML02~04 | DAR/FIG/GRA等 | 基本能量卡 |

---

## 卡组详情弹窗

卡组详情页每张卡编号右侧有 `?` 按钮，点击弹出浮层展示卡牌名称、图片、编号、稀有度、属性、赛制、库存数量。仅供查看，不可编辑。
