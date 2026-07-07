# ptcgGallery 拆库设计与迁移方案

本文档定义 ptcgGallery 从“单 SQLite 文件 + `account_id` 逻辑隔离”迁移到“共享目录库 + 用户独立业务库”的目标数据模型、迁移规则、实施步骤和回滚约束。

---

## 一、目标

本次改造需要同时满足以下目标：

1. 各个用户的数据存放到自己的数据库文件中。
2. 当前已有用户的数据不能丢失。
3. 多个用户可以同时登录。
4. 多个用户可以同时修改自己的库存、卡组、排序和偏好，互不影响。
5. 保持现有卡牌目录、账号体系和邀请码体系可用。

---

## 二、现状

当前系统的核心特点如下：

1. 所有业务逻辑和数据库访问集中在 `ptcg_gallery/services.py` 的 `CardRepository`。
2. 当前主库同时存放：
   - 共享数据：`cards`、`accounts`、`invite_codes`、`app_settings`
   - 用户数据：`free_inventory`、`decks`、`deck_cards`、`deck_basic_energies`、`deck_section_orders`
3. 用户隔离目前依赖这些表中的 `account_id` 列。
4. 某些实际上属于“用户私有”的状态目前仍是全局数据：
   - `holdings_group_orders`
   - `cards.group_sort_order`
   - `data/search_preferences.json`

这些全局状态会导致不同用户之间互相覆盖设置，不适合在拆库后继续保留原状。

---

## 三、目标架构

### 3.1 整体结构

拆库后采用以下结构：

```text
data/
├─ ptcg_gallery.db              # 共享目录库
├─ accounts/
│  ├─ 1.db                      # 用户 1 私有业务库
│  ├─ 2.db                      # 用户 2 私有业务库
│  └─ ...
├─ auth.json
├─ search_preferences.json      # 迁移完成后不再使用
└─ card_images/
```

### 3.2 库职责划分

共享目录库负责：

1. 卡牌目录。
2. 账号与认证元数据。
3. 邀请码。
4. 全局应用设置。

用户私有业务库负责：

1. 空闲库存。
2. 卡组。
3. 卡组中的卡牌数量。
4. 基础能量配置。
5. Deck 详情页排序。
6. Holdings 分组排序。
7. Holdings 单卡排序。
8. 搜索偏好等用户级设置。

### 3.3 连接方式

仓储层保留两类连接：

1. `connect_catalog()`
   - 只连接共享目录库。
   - 用于 `cards`、`accounts`、`invite_codes`、`app_settings`。

2. `connect_account(account_id)`
   - 主连接指向用户私有业务库。
   - `ATTACH` 共享目录库为 `shared`。
   - 业务 SQL 默认操作用户私有表。
   - 需要共享卡表时显式使用 `shared.cards`。

---

## 四、目标数据模型

### 4.1 共享目录库表

共享目录库保留以下表：

1. `cards`
2. `accounts`
3. `invite_codes`
4. `app_settings`

说明：

1. `cards` 仍然是全局共享卡牌目录。
2. `accounts` 保存账号名、密码哈希、排序等账号元数据。
3. `invite_codes` 保持管理员邀请注册逻辑不变。
4. `app_settings` 仅保留真正的全局配置。

### 4.2 用户私有业务库表

每个用户库包含以下表：

1. `free_inventory`
2. `decks`
3. `deck_cards`
4. `deck_basic_energies`
5. `deck_section_orders`
6. `holdings_group_orders`
7. `holdings_card_orders`
8. `user_settings`

#### `free_inventory`

```sql
CREATE TABLE free_inventory (
    card_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY(card_id)
);
```

规则：

1. `card_id` 对应共享库 `cards.id`。
2. 不再需要 `account_id`。

#### `decks`

```sql
CREATE TABLE decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

规则：

1. deck 名称只需在当前用户库内唯一。
2. 不再需要 `account_id`。

#### `deck_cards`

```sql
CREATE TABLE deck_cards (
    deck_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    backup_quantity INTEGER NOT NULL DEFAULT 0 CHECK (backup_quantity >= 0),
    PRIMARY KEY(deck_id, card_id),
    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
```

规则：

1. `card_id` 引用共享目录卡牌。
2. 不在用户库内建立跨文件 `cards` 外键。

#### `deck_basic_energies`

```sql
CREATE TABLE deck_basic_energies (
    deck_id INTEGER NOT NULL,
    energy_code TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY(deck_id, energy_code),
    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
```

#### `deck_section_orders`

```sql
CREATE TABLE deck_section_orders (
    deck_id INTEGER NOT NULL,
    section_key TEXT NOT NULL,
    entry_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(deck_id, section_key, entry_key),
    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
```

#### `holdings_group_orders`

```sql
CREATE TABLE holdings_group_orders (
    section_key TEXT NOT NULL,
    group_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(section_key, group_key)
);
```

说明：

1. 该表从主库迁入用户库。
2. 原因是 holdings 分组顺序本质上是用户视图状态，不是全局目录数据。

#### `holdings_card_orders`

```sql
CREATE TABLE holdings_card_orders (
    card_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(card_id)
);
```

说明：

1. 该表用于取代当前共享 `cards.group_sort_order`。
2. 单卡排序一旦仍写回 `cards`，不同用户会互相污染排序结果。

#### `user_settings`

```sql
CREATE TABLE user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

说明：

1. 用于存放用户级搜索偏好、视图偏好等。
2. 用它取代当前全局文件 `data/search_preferences.json`。

---

## 五、数据归属规则

### 5.1 共享数据

以下数据对所有用户共享：

1. 卡牌目录和卡牌基础属性。
2. 账号与密码哈希。
3. 邀请码。
4. 全局应用设置。
5. 卡图缓存文件。

### 5.2 用户私有数据

以下数据只属于当前用户：

1. 空闲库存数量。
2. 各卡组及其排序。
3. 卡组中的卡牌数量和备卡数量。
4. Deck 基础能量数量。
5. Holdings 页面中的分组顺序。
6. Holdings 页面中的同名卡组内单卡顺序。
7. 搜索赛制过滤偏好。
8. 以后新增的用户级页面状态。

---

## 六、迁移规则

### 6.1 总原则

迁移遵循以下原则：

1. 先复制，再切换，不立即删除旧数据。
2. 迁移脚本必须可重复执行，或者至少在检测到已迁移状态时安全退出。
3. 迁移必须先校验，再允许应用切换到新逻辑。
4. 迁移失败时必须可以仅靠旧主库回滚。

### 6.2 迁移前备份

迁移前必须备份：

1. `data/ptcg_gallery.db`
2. `data/search_preferences.json`
3. `data/auth.json`
4. 当前代码版本号或 git commit

建议额外生成：

1. 每个账号的库存总数快照。
2. 每个账号的卡组数量快照。
3. 每个账号每个卡组的总牌数快照。

### 6.3 共享库迁移规则

共享库保留原表中的以下数据：

1. `cards` 全量保留。
2. `accounts` 全量保留。
3. `invite_codes` 全量保留。
4. `app_settings` 全量保留。

共享库中以下旧结构需要停用：

1. `free_inventory.account_id` 逻辑不再继续使用。
2. `decks.account_id` 逻辑不再继续使用。
3. `holdings_group_orders` 不再作为权威数据源。
4. `cards.group_sort_order` 不再作为权威数据源。

注意：

1. 旧表可在第一阶段保留，用于回滚和对账。
2. 新代码切换后，不应再写入这些旧用户数据表。

### 6.4 用户库迁移规则

对每一个 `accounts.id`，生成一个对应用户库：

1. 文件路径：`data/accounts/{account_id}.db`
2. 初始化用户库 schema。
3. 从旧主库抽取该用户的业务数据写入用户库。

具体规则如下。

#### 规则 A：迁移空闲库存

来源：

```text
free_inventory where account_id = 当前账号
```

目标：

```text
用户库 free_inventory(card_id, quantity)
```

#### 规则 B：迁移卡组

来源：

```text
decks where account_id = 当前账号
```

目标：

```text
用户库 decks
```

规则：

1. 保留 `id`，避免同账号下 `deck_cards`、`deck_basic_energies`、`deck_section_orders` 需要二次映射。
2. 该 `id` 只需在当前用户库内部保持一致。

#### 规则 C：迁移卡组卡牌

来源：

```text
deck_cards join decks on decks.id = deck_cards.deck_id
where decks.account_id = 当前账号
```

目标：

```text
用户库 deck_cards
```

#### 规则 D：迁移基础能量

来源：

```text
deck_basic_energies join decks on decks.id = deck_basic_energies.deck_id
where decks.account_id = 当前账号
```

目标：

```text
用户库 deck_basic_energies
```

#### 规则 E：迁移 Deck section 顺序

来源：

```text
deck_section_orders join decks on decks.id = deck_section_orders.deck_id
where decks.account_id = 当前账号
```

目标：

```text
用户库 deck_section_orders
```

#### 规则 F：迁移 Holdings 分组顺序

来源：

```text
主库 holdings_group_orders
```

目标：

```text
用户库 holdings_group_orders
```

规则：

1. 当前老系统中该表是全局的，因此没有账号维度。
2. 迁移时应将当前全局顺序复制到所有现有用户库，作为初始默认值。
3. 切换后每个用户各自维护自己的分组顺序。

#### 规则 G：迁移单卡排序

来源：

```text
cards.group_sort_order
```

目标：

```text
用户库 holdings_card_orders(card_id, sort_order)
```

规则：

1. 当前老系统中该字段是全局字段，因此没有账号维度。
2. 迁移时将 `group_sort_order > 0` 的记录复制到所有现有用户库。
3. 切换后不再把排序写回 `cards.group_sort_order`。

#### 规则 H：迁移搜索偏好

来源：

```text
data/search_preferences.json
```

目标：

```text
用户库 user_settings
```

规则：

1. 当前文件是全局的，因此没有账号维度。
2. 迁移时把该全局偏好复制到所有现有用户库作为初始默认值。
3. 切换后每个用户独立维护自己的偏好。
4. 新代码不再读取该 JSON 文件。

---

## 七、服务层改造规则

### 7.1 仓储层职责

`CardRepository` 改造后必须满足：

1. 账号上下文只决定“当前用户库文件”。
2. 用户业务查询默认从 `connect_account(account_id)` 进入。
3. 共享目录查询必须显式使用 `shared.` 前缀或 `connect_catalog()`。

### 7.2 需要走共享库的方法

以下方法必须只访问共享库：

1. 账号创建、删除、查找、认证、改密。
2. 邀请码生成、消费、查询。
3. 卡牌目录导入和目录查询。
4. 爬虫扫描共享卡表。

### 7.3 需要走用户库的方法

以下方法必须只访问当前用户库：

1. `stats()` 中的用户持有量统计。
2. `holdings_report()`。
3. `list_decks()` / `get_deck_detail()`。
4. 所有库存修改接口。
5. 所有卡组修改接口。
6. 所有排序修改接口。
7. 搜索偏好读取与更新。
8. 导出/导入当前用户状态。

### 7.4 排序规则变更

以下字段或表不再是权威来源：

1. `cards.group_sort_order`
2. 主库 `holdings_group_orders`

新权威来源：

1. 用户库 `holdings_card_orders`
2. 用户库 `holdings_group_orders`

### 7.5 搜索偏好变更

当前：

1. 偏好存到 `data/search_preferences.json`

目标：

1. 偏好存到用户库 `user_settings`

建议 key：

1. `search.preferences`

value 存 JSON 文本。

---

## 八、并发与锁设计

### 8.1 预期收益

拆库后并发写入会从“所有用户竞争一个业务库文件锁”变为：

1. 共享目录库主要读。
2. 用户写入落到各自的业务库文件。
3. 不同用户之间的库存和卡组修改通常不会互相阻塞。

### 8.2 SQLite 配置建议

每个连接继续保持：

1. `PRAGMA journal_mode=WAL`
2. `PRAGMA foreign_keys = ON`

建议补充：

1. `PRAGMA busy_timeout = 5000`

### 8.3 请求上下文清理

当前 `CardRepository` 使用 `threading.local()` 记录请求账号上下文。

切换后必须保证：

1. `before_request` 设置当前 `account_id`
2. `teardown_request` 或等效位置清理当前 `account_id`

否则在 Waitress 线程复用时可能出现跨请求串账号的问题。

---

## 九、业务规则调整

### 9.1 卡表导入权限

卡表导入修改的是共享 `cards`，因此应视为全局行为。

建议：

1. 默认只允许管理员导入卡表。
2. 普通用户不能直接修改共享目录。

### 9.2 卡图爬虫

爬虫扫描的是共享 `cards` 表，因此继续读共享目录库。

不需要为每个用户单独爬图。

### 9.3 状态导出导入

状态导出导入应只针对“当前用户数据”：

1. 导出当前用户库的库存、卡组、排序、偏好。
2. 不导出其他用户数据。
3. 不覆盖共享账号数据。

---

## 十、迁移实施步骤

### 第 1 步：冻结目标模型

1. 确认共享库与用户库的表归属。
2. 确认卡表导入为管理员操作。
3. 确认 `search_preferences.json` 废弃。
4. 确认 `cards.group_sort_order` 废弃为用户私有排序表。

### 第 2 步：实现用户库 schema 和连接抽象

1. 为用户库定义最终 schema。
2. 完成 `connect_catalog()` 和 `connect_account(account_id)`。
3. 为用户库 schema 增加版本控制。

### 第 3 步：编写一次性迁移脚本

迁移脚本职责：

1. 备份主库和全局偏好文件。
2. 为每个用户创建用户库。
3. 复制该用户业务数据。
4. 迁移全局排序和全局偏好为每用户默认值。
5. 输出对账报告。

### 第 4 步：切换服务层读写路径

1. 所有共享数据方法切换到共享库。
2. 所有用户业务方法切换到用户库。
3. 排序读写切换到用户库。
4. 搜索偏好切换到用户库。

### 第 5 步：修正配套模块

1. `create_app()` 传入 `accounts_dir`。
2. 爬虫继续只访问共享目录库。
3. 导出导入接口适配新结构。
4. 管理员导入卡表权限收口。

### 第 6 步：补测试

新增测试至少覆盖：

1. 旧单库数据迁移后默认用户数据不丢失。
2. 两个用户同时登录后彼此库存隔离。
3. 两个用户对卡组修改互不影响。
4. 两个用户的 holdings 排序互不影响。
5. 两个用户的搜索偏好互不影响。
6. 管理员导入卡表后用户库存仍能正确关联。

### 第 7 步：灰度切换

1. 先在备份数据上演练迁移。
2. 执行测试和对账。
3. 正式切换代码。
4. 保留旧主库和迁移日志，确认稳定后再清理旧路径。

---

## 十一、迁移校验清单

每个账号迁移完成后，至少校验：

1. `free_inventory` 行数一致。
2. `free_inventory` 数量总和一致。
3. `decks` 数量一致。
4. `deck_cards` 行数一致。
5. `deck_cards.quantity` 总和一致。
6. `deck_cards.backup_quantity` 总和一致。
7. `deck_basic_energies` 数量总和一致。
8. `deck_section_orders` 行数一致。
9. 全局分组顺序已复制到用户库。
10. 全局单卡排序已复制到用户库。
11. 搜索偏好已复制到用户库。

建议额外校验：

1. `stats()` 返回的 `freeCount`、`inDeckCount`、`ownedCount` 与迁移前一致。
2. 某个代表性卡组的 `get_deck_detail()` 结果在迁移前后主牌数、备牌数一致。

---

## 十二、回滚策略

只要没有删除旧主库中的历史业务数据，就可以回滚。

回滚步骤：

1. 停止新代码。
2. 恢复旧代码版本。
3. 使用迁移前备份的 `data/ptcg_gallery.db`。
4. 恢复 `data/search_preferences.json`。
5. 启动旧版本服务。

回滚前提：

1. 正式切换后的一段观察期内，不删除旧主库中的旧业务表数据。
2. 迁移脚本与切换日志必须保留。

---

## 十三、非目标

以下内容不属于本次拆库的直接目标：

1. 将 SQLite 替换为 MySQL、PostgreSQL 等服务型数据库。
2. 重写前端页面交互。
3. 重做账号体系。
4. 修改卡图缓存结构。

---

## 十四、实现建议

实现顺序建议如下：

1. 先完成文档和最终 schema 定稿。
2. 再清理 `services.py` 中当前未完成的半成品拆库改动。
3. 先把 repository 层跑通，再写迁移脚本。
4. 迁移脚本通过后，再切换 HTTP 接口和测试。

优先级上，不建议先做大面积字符串替换。应以“先定数据归属，再逐方法切换连接来源”的方式实施，否则很容易留下共享表和私有表混用的问题。