# ptcgGallery

一个面向 **PTCG（宝可梦集换式卡牌）本地库存管理** 的 Flask 网站，核心目标是：

- 用 Excel 卡表快速初始化卡牌目录
- 用 SQLite 持久化库存与卡组数据
- 用浏览器完成搜索、库存维护、卡组管理与状态备份

项目支持本机使用，也可以使用 Waitress + Nginx 部署到服务器。当前版本采用共享卡牌目录库和每用户独立业务库的拆库结构。

---

## 这个网站现在能做什么

### 1. 卡牌搜索

首页支持 3 种搜索方式：

- **精确编号搜索**：`商品编号-卡牌编号`
  - 例如：`CSM1aC-002`
- **卡牌名称模糊搜索**
- **PROMO 解析后的商品编号 / 商品名搜索**
  - 例如：`SM-P-002`
  - 例如：`上海糖`

搜索结果会展示：

- 卡牌名称
- 编号
- 商品编号 / 稀有度 / 属性
- 空闲库存
- 卡组库存
- 总持有数

点击一张卡后，可以进一步查看详情并执行库存操作。

补充说明：

- 在“加入卡组”时，页面会默认记住**上一次成功插入的卡组**，下次继续加卡时会自动选中它
- 如果卡牌是 `PROMO`，搜索时既支持原始编号，也支持系统派生出的展示编号 / 展示商品名

### 2. 空闲库存管理

在卡牌详情面板中可以直接：

- `空闲 +1`
- `空闲 -1`

系统会阻止把空闲库存减成负数。

### 3. 卡组管理

网站内置独立的卡组管理页，支持：

- 新建卡组
- 编辑卡组名称 / 描述 / 颜色
- 删除卡组
- 查看卡组详情

默认会自动确保存在 4 个卡组：

- `电友`
- `龙柱`
- `铝钢龙`
- `多龙`

删除卡组时，卡组中的卡会**自动回收到空闲库存**。

页面补充：

- 卡组列表已经改为更紧凑的多列布局，一屏可以同时看到更多卡组
- 仍然支持拖拽调整卡组顺序

### 4. 卡牌与卡组联动

对任意卡牌，可以执行：

- **直接加入卡组**：只增加卡组数量，不消耗空闲库存
- **空闲转入卡组**：从空闲库存扣减，再转入指定卡组
- **卡组 -1**：减少卡组中的该卡数量
- **移回空闲 +1**：从卡组中扣减并回收到空闲库存

### 5. 总持有页面

`/holdings` 页面会把“总持有 = 空闲 + 所有卡组中的数量”按类别展开展示。

页面特点：

- 按卡片大类分区展示
- 同名变体会按组聚合展示，但**底层记录不会合并**
- 每条记录都保留原始编号、稀有度、空闲数、卡组数
- 还能看到每个卡组分别持有多少张该卡

当前分类规则包括：

- 普通的宝可梦
- 详细里有“宝可梦GX”的宝可梦卡牌
- 详细里有“宝可梦V”的宝可梦卡牌
- 详细里有“宝可梦ex”的宝可梦卡牌
- 光辉宝可梦
- 物品
- 支援者
- 竞技场
- 道具
- 特殊能量
- 普通能量

### 6. 库存表格

`/inventory-table` 页面会按和“总持有”一致的分类与同名规则，渲染一个更适合批量盘点的表格视图。

页面特点：

- 每行最多展示 8 组记录
- 主表格展示赛制、商品编号、空闲数量与各卡组数量
- 可以打开“修改库存”弹窗，批量修改同名组内每条记录的空闲数和各卡组数量
- 修改弹窗会展示编号、稀有度、卡牌名、赛制与各数量字段

当前实现细节：

- 弹窗中会显示稀有度颜色
- 弹窗中不再展示商品编号，减少横向宽度
- 空闲数量和各卡组数量列已经做了更窄的布局，尽量减少横向滚动

### 7. 导入 / 导出

支持两类数据流：

#### 卡表导入

- 从默认文件 `data/卡表.xlsx` 更新卡表
- 在网页上传**同结构的** `.xlsx` 文件更新卡表

更新逻辑：

- 新卡会插入目录
- 已有卡会按目录身份更新信息
- 不会因为重复导入同一份卡表就生成重复卡牌记录

#### 状态备份与恢复

- 导出当前 **库存 + 卡组** 为 JSON
- 导入之前导出的 JSON 状态文件

适合做本地备份、换机器迁移、重装前导出等。

---

## 技术栈

- **后端**：Flask 3
- **部署/运行**：Waitress（失败时回退到 Flask 内置开发服务器）
- **数据库**：SQLite
- **Excel 读取**：openpyxl
- **前端**：原生 HTML + CSS + JavaScript
- **测试**：Python `unittest`

补充：`PyJWT` 用于微信小程序登录令牌，`requests` 用于卡图服务；当前 `run.py` 默认监听 `127.0.0.1:8000`，不读取 `PTCG_HOST` 或 `PTCG_PORT` 环境变量。部署时可通过 `PTCG_SECRET_KEY` 固定 Flask session 和微信 JWT 使用的密钥。

---

## 当前数据架构

当前版本不是所有业务数据都存放在同一个 SQLite 文件中，而是：

```text
data/
├─ ptcg_gallery.db       共享目录库：cards、accounts、邀请码等
├─ accounts/
│  ├─ <account_id>.db    用户业务库：库存、卡组、排序、搜索偏好
│  └─ ...
├─ 卡表.xlsx              默认卡表（可选）
├─ nicknames.xlsx         卡牌昵称表（可选）
├─ card_images/           自动下载的卡图缓存
├─ card_images_user/      用户手动放入的卡图
└─ backups/               导入和迁移时生成的备份
```

卡牌目录共享；空闲库存、卡组、卡组排序、持有页排序和搜索偏好按用户隔离。旧版单库迁移请使用 `scripts/migrate_split_db.py`，再用 `scripts/verify_account_dbs.py` 校验，详细步骤见 `docs/db_split_local_checklist.md` 和 `docs/deployment.md`。

---

## 本地运行前需要安装什么软件

如果只是想在本机跑起来并使用这个项目，最少需要安装这些：

### 必需软件

- **Python 3.11 或更高版本**
  - 建议直接安装官方 Windows 版本
  - 安装时勾选“Add Python to PATH”会更省事
- **pip**
  - 一般会随 Python 一起安装
- **一个浏览器**
  - 例如 Edge、Chrome、Firefox，启动后用来访问本地页面

### 可选但推荐

- **Git**：方便拉代码、更新代码
- **VS Code**：方便直接编辑和调试这个项目
- **Excel / WPS / LibreOffice Calc**：方便查看和维护 `data/卡表.xlsx`

这个项目**不需要单独安装数据库软件**，因为它直接使用 SQLite，本地文件即可运行。

---

## 项目结构

```text
ptcgGalleryWeb/
├─ data/
│  ├─ README.md                数据目录说明
│  ├─ ptcg_gallery.db          SQLite 数据库（运行后生成/使用）
│  └─ 卡表.xlsx                默认卡表 Excel
├─ ptcg_gallery/
│  ├─ __init__.py              Flask 应用工厂、页面路由、API 路由、错误处理
│  ├─ services.py              核心业务：SQLite、Excel 导入、库存/卡组逻辑、分类逻辑
│  ├─ image_service.py         卡图查找、缓存与按需下载
│  ├─ crawler.py               后台卡图爬虫与缓存验证
│  ├─ mikmoe_source.py         mikmoe 卡图源适配
│  ├─ card_translations.py     中文卡名到英文 API 查询名的映射
│  ├─ wx_auth.py               微信登录 JWT 工具
│  ├─ static/
│  │  ├─ admin.js              管理后台交互
│  │  ├─ app.js                首页搜索、库存操作、导入导出交互
│  │  ├─ decks.js              卡组管理页交互
│  │  ├─ deck_detail.js        卡组详情页交互
│  │  ├─ holdings.js           总持有页交互
│  │  ├─ inventory_table.js    库存表格页交互
│  │  └─ style.css             全站样式
│  └─ templates/
│     ├─ index.html            首页：搜索、详情、导入导出入口
│     ├─ admin.html             管理后台
│     ├─ login.html             登录与注册
│     ├─ decks.html            卡组管理页
│     ├─ deck_detail.html      卡组详情页
│     ├─ inventory_table.html  库存表格页
│     └─ holdings.html         总持有页
├─ tests/
│  └─ test_app.py              接口与业务流程测试
├─ miniprogram/                 微信小程序前端
├─ scripts/                     拆库迁移与校验脚本
├─ docs/                        部署、迁移和卡图说明
├─ requirements.txt            Python 依赖
├─ run.py                      启动入口
└─ README.md                   项目说明
```

---

## 网站页面说明

### 首页 `/`

主要功能：

- 搜索卡牌
- 查看单卡详情
- 调整空闲库存
- 直接设置空闲库存为指定值
- 把卡加入卡组 / 从卡组移回空闲
- 更新默认卡表 / 上传新卡表更新目录
- 导出 / 导入 JSON 状态
- 跳转到卡组管理与总持有页面
- 记住上一次加入卡组时选择的默认卡组

### 卡组管理 `/decks`

主要功能：

- 新建卡组
- 编辑卡组
- 设置卡组颜色
- 删除卡组
- 跳转到卡组详情页
- 拖拽调整卡组顺序
- 更紧凑地浏览多个卡组

### 卡组详情 `/decks/<deck_id>`

主要功能：

- 查看卡组基本信息，显示卡组总数与主牌数量
- 按”宝可梦 / 能量 / 物品 / 支援者 / 竞技场 / 宝可梦道具 / 备卡”分类展示
- 每条卡展示编号、名称、稀有度，右侧可设目标数量快速调整
- 备卡可一键”转为主卡组”（backup-to-main）
- 支持”全部转为空闲”一键清空卡组
- 可单独设置 8 种基础能量数量，持久化到卡组状态
- 同名组和分区可拖拽排序

当前基础能量固定支持：

- `GRA` 基本草能量
- `FIR` 基本火能量
- `WAT` 基本水能量
- `LIG` 基本雷能量
- `PSY` 基本超能量
- `FIG` 基本斗能量
- `DAR` 基本恶能量
- `MET` 基本钢能量

### 库存表格 `/inventory-table`

主要功能：

- 按类别浏览所有“有持有量”的卡牌分组
- 以更紧凑的表格视图查看空闲与各卡组库存
- 在弹窗中批量修改同名卡组内各记录的库存分布

### 总持有 `/holdings`

主要功能：

- 按类别浏览所有“有持有量”的卡
- 查看同名卡组的分组
- 查看每张卡在不同卡组中的数量分布

---

## 后端接口概览

### 页面路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/login` | 登录页面 |
| GET | `/` | 首页 |
| GET | `/holdings` | 总持有页面 |
| GET | `/inventory-table` | 库存表格页面 |
| GET | `/decks` | 卡组管理页面 |
| GET | `/decks/<deck_id>` | 卡组详情页面 |
| GET | `/health` | 健康检查 + 基础统计 |

### 数据接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/summary` | 获取统计信息 |
| GET | `/api/search/options` | 获取搜索选项（赛制列表、偏好） |
| PUT | `/api/search/preferences` | 保存搜索偏好 |
| GET | `/api/search?q=...` | 搜索卡牌 |
| GET | `/api/cards/<card_id>` | 获取单卡详情 |
| POST | `/api/cards/<card_id>/free-adjust` | 调整空闲库存（+/- delta） |
| PUT | `/api/cards/<card_id>/free-quantity` | 直接设置空闲库存 |
| POST | `/api/cards/<card_id>/add-to-deck` | 加入卡组 |
| POST | `/api/cards/<card_id>/remove-from-deck` | 从卡组移除 |
| POST | `/api/cards/<card_id>/adjust-total` | 调整总持有量 |
| DELETE | `/api/cards/<card_id>` | 删除卡牌及所有库存 |
| GET | `/api/accounts` | 获取账号列表 |
| POST | `/api/accounts` | 注册新账号 |
| PUT | `/api/accounts/password` | 修改当前账号密码 |
| PUT | `/api/accounts/<id>/password` | 管理员重置任意账号密码 |
| GET | `/api/decks` | 获取卡组列表 |
| POST | `/api/decks` | 新建卡组 |
| POST | `/api/decks/reorder` | 拖拽调整卡组顺序 |
| GET | `/api/decks/<deck_id>` | 获取卡组详情 |
| PUT | `/api/decks/<deck_id>` | 更新卡组名称/描述/颜色 |
| DELETE | `/api/decks/<deck_id>` | 删除卡组（卡回空闲） |
| PUT | `/api/decks/<deck_id>/basic-energies` | 设置卡组基础能量数量 |
| PUT | `/api/decks/<deck_id>/cards/<card_id>/backup-quantity` | 设置卡组内备卡数量 |
| POST | `/api/decks/<deck_id>/cards/<card_id>/quantity-action` | 卡组内单卡数量动作 |
| POST | `/api/decks/<deck_id>/move-to-free` | 卡组内全部卡转为空闲 |
| PUT | `/api/decks/<deck_id>/group-order` | 卡组内同名组排序 |
| PUT | `/api/decks/<deck_id>/section-order` | 卡组内分区排序 |
| GET | `/api/holdings` | 获取总持有报表 |
| PUT | `/api/holdings/group-order` | 调整持有页同名组排序 |
| PUT | `/api/inventory-table/group-quantities` | 批量更新同名组库存 |
| PUT | `/api/inventory-table/group-order` | 调整库存表格同名组排序 |
| POST | `/api/import/catalog-default` | 导入 `data/卡表.xlsx` |
| POST | `/api/import/catalog-upload` | 上传 Excel 导入卡表 |
| GET | `/api/export/state` | 导出完整状态 JSON |
| POST | `/api/import/state` | 导入完整状态 JSON |
| GET | `/api/export/inventory` | 导出纯库存 JSON |
| POST | `/api/import/inventory` | 导入纯库存 JSON |
| GET | `/api/images/lookup` | 卡图查找 |
| GET | `/api/images/<cache_key>` | 获取缓存卡图 |
| GET | `/api/images/user/<filename>` | 获取用户自定义卡图 |
| GET | `/api/crawler/status` | 爬虫状态 |
| PUT | `/api/crawler/mode` | 设置爬虫模式 |

管理员和扩展接口还包括：账号/邀请码管理、`/api/settings/registration` 注册开关、`/api/retire/preview` 和 `/api/retire/execute` 卡牌退役、`/api/images/lookup-batch` 批量卡图查询、`/api/images/verify-product` 和 `/api/images/verify-all` 卡图缓存验证、`/api/nicknames/reload` 昵称重载，以及 `/api/wx/login`、`/api/wx/bind` 微信登录接口。需要管理员权限的接口会由 session 或 JWT 认证保护。

---

## 数据模型说明

项目当前使用 SQLite，主要有以下表：

### `cards`

存放卡表主数据，通过 `source_key`（商品编号-卡牌编号）唯一标识每张卡。

### `accounts`

存放共享的账号信息，包含密码哈希和微信 OpenID。系统会确保存在内置账号 `RhymesX`；管理员登录身份会映射到该账号，但管理员登录名由 `data/auth.json` 配置。

### `free_inventory`

旧版共享库中的空闲库存表带有 `account_id`。当前拆库架构下，用户库中的 `free_inventory` 以 `card_id` 为主键，每个用户对应 `data/accounts/<account_id>.db`。

### `decks`

存放卡组信息（名称、描述、颜色、排序），每个账号独立拥有卡组。

### `deck_cards`

存放卡组与卡牌的关联数量，以及备卡数量。

### `deck_basic_energies`

存放每个卡组单独设置的 8 种基础能量数量。

### `holdings_group_orders` / `deck_section_orders`

存放同名卡组和卡组分区的拖拽排序顺序；用户库还保存持有页单卡排序和用户搜索偏好。

### `app_settings`

存放应用级配置键值对。

---

## 本地数据存在哪

这个项目默认把运行数据都放在仓库根目录下的 `data/` 目录。

主要包括：

- `data/ptcg_gallery.db`：共享卡牌目录、账号和邀请码
- `data/accounts/<account_id>.db`：对应账号的库存、卡组、基础能量和排序数据
- `data/卡表.xlsx`：默认卡表文件，启动时可自动导入，也可后续手动更新
- 你从网页导出的 JSON 状态文件：默认会落到浏览器的下载目录，位置取决于你的浏览器设置

需要注意：

- 迁移或备份时必须同时保留 `data/ptcg_gallery.db` 和 `data/accounts/`，只保留主库不能恢复用户库存和卡组
- 如果删除主库或用户库，应用会重新初始化缺失的数据，删除前务必先备份
- 如果想迁移到另一台机器，最简单的方式是复制整个 `data/` 目录，或者先导出 JSON 再导入

---

## Excel 卡表格式

默认推荐把 Excel 放在：

```text
data/卡表.xlsx
```

系统导入时会：

- 优先读取 **第 2 个工作表**
- 如果 Excel 只有 1 个工作表，则读取第 1 个

### 必需列

下面 3 列是必需的：

- `商品编号`
- `卡牌编号`
- `卡牌名称`

### 推荐完整表头

```text
商品名称
商品编号
卡牌编号
卡牌名称
类型
详细
特殊
属性
稀有度
赛制
数量
备注
```

### 字段用途

- `商品编号 + 卡牌编号`：用于精确编号搜索
- `卡牌名称`：用于名称搜索
- `PROMO` 类型卡牌会派生出可搜索的显示商品编号 / 商品名
- `数量`：首次导入时会初始化为该卡的空闲库存

### 导入行为

- 新卡：插入 `cards`，并初始化 `free_inventory`
- 已存在卡：更新卡牌信息
- 如果旧卡之前没有库存记录，会补一条空闲库存记录
- 缺少关键字段的行会被跳过

---

## 状态 JSON 说明

导出的状态文件包含：

- `version`
- `exportedAt`
- `decks`
- `cards`

其中每个卡组还会携带：

- `basicEnergies`

其中每张卡会携带：

- `sourceKey`
- `productCode`
- `cardCode`
- `cardName`
- `freeQuantity`
- `deckQuantities`

导入状态时会：

1. 为当前用户的库存和卡组数据创建自动备份
2. 清空当前用户的库存、卡组及相关排序数据
3. 根据 JSON 重新建立卡组、基础能量和库存数量
4. 最后再次确保默认卡组存在

也就是说：**状态导入会覆盖当前库存/卡组状态**，使用前建议先导出备份。

---

## 本地运行

推荐使用 Python 3.11+ 虚拟环境。

### 启动前检查

请先确认：

- 已安装 Python 3.11+
- 终端里可以运行 `py -3.11` 或 `python`
- 当前目录下存在 `requirements.txt`
- 默认数据目录 `data/` 可写

### Windows PowerShell

```powershell
Set-Location "<项目目录>"
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

### 为什么建议在虚拟环境里安装依赖

推荐使用下面这种形式安装依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

而不是直接在普通 `cmd` / PowerShell 里执行：

```powershell
pip install -r requirements.txt
```

原因是这两种方式**安装到的 Python 环境可能不是同一个**。

如果你没有激活虚拟环境，就直接运行 `pip install -r requirements.txt`，常见区别和后果是：

- `pip` 可能会把依赖装到**系统 Python**，而不是项目的 `.venv`
- 之后你如果用 `.venv\Scripts\python.exe run.py` 启动，虚拟环境里可能仍然**缺包**
- 常见报错会是 `ModuleNotFoundError`，例如找不到 `flask`、`waitress`、`openpyxl`
- 反过来，如果你把包装在系统 Python 里，项目能不能跑就会取决于你这台机器的全局环境，**可复现性会很差**
- 系统 Python 还会被这个项目的依赖污染，后续别的 Python 项目也可能受到影响
- 如果电脑里同时装了多个 Python 版本，`pip` 指向的解释器还可能和 `py -3.11`、`python`、`.venv\Scripts\python.exe` 不是同一个，问题会更隐蔽

简单理解：

- 用 `.venv\Scripts\python.exe -m pip ...`，依赖一定装进当前项目自己的虚拟环境
- 直接用 `pip ...`，依赖装到哪里要看你当前 shell 里的 `pip` 指向谁

所以这个项目最稳妥的做法是：

1. 先创建 `.venv`
2. 始终用 `.venv\Scripts\python.exe -m pip install -r requirements.txt` 安装依赖
3. 始终用 ``.venv\Scripts\python.exe run.py 启动项目

启动后访问：

```text
http://127.0.0.1:8000
```

应用启动时会自动：

- 初始化 SQLite 表结构
- 自动确保默认卡组存在
- 如果数据库还是空的，并且 `data/卡表.xlsx` 存在，则自动导入默认卡表

### 认证配置文件

首次使用前需要在 `data/` 目录下创建 `auth.json`，内容格式如下（请替换为实际用户名密码）：

```json
{
  "admin_user": "你的管理员用户名",
  "admin_pass": "你的管理员密码",
  "init_admin_pass": "RhymesX账号初始密码"
}
```

- `admin_user` / `admin_pass`：登录页的管理员用户名和密码
- `init_admin_pass`：RhymesX 账号的初始密码，仅在新数据库首次初始化时写入，后续更改不会影响已存在的数据库

该文件不会通过 git 上传（`data/*.json` 已在 `.gitignore` 中排除）。

### 第一次运行后会发生什么

第一次正常启动后，通常会看到这些结果：

- 在 `data/` 下生成或使用 `ptcg_gallery.db`
- 如果数据库原本为空，会自动从 `data/卡表.xlsx` 初始化卡牌目录
- 默认管理员账号 `RhymesX` 自动创建
- 默认卡组（电友、龙柱、铝钢龙、多龙）自动建立

启动后打开 `http://127.0.0.1:8000`，会先跳转到登录页。管理员账号和初始密码通过 `data/auth.json` 配置（首次启动前需手动创建该文件，格式见下方说明）。管理员登录后实际使用的是 `RhymesX` 账号。新用户可在登录页下方直接注册。

如果你只是想把项目跑起来，核心就是 4 步：

1. 安装 Python 3.11+
2. 使用虚拟环境安装依赖 `.venv\Scripts\python.exe -m pip install -r requirements.txt`
3. 运行 `run.py`
4. 浏览器打开 `http://127.0.0.1:8000`，用管理员账号登录

---

## 测试

项目包含一组基于 `unittest` 的后端测试，覆盖了核心业务流程：

- 默认卡组初始化
- 编号/名称/PROMO 派生搜索
- 赛制筛选与同名牌赛制联动
- 总持有报表分类与分组
- 库存表格批量修改与拖拽排序
- 库存与卡组联动
- 基础能量状态导出 / 导入回灌
- 状态导出 / 导入回灌（含自动备份）
- 删除卡组后库存回收
- 卡组同名牌 4 张限制
- 登录认证：未登录拦截、管理员映射、账号注册
- 密码管理：修改密码、管理员重置、旧密码失效

运行命令：

```powershell
Set-Location "F:\ptcgGallery\ptcgGalleryWeb"
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

当前测试使用临时目录和临时数据库，不会修改生产数据；运行方式以本节命令为准。拆库迁移相关的辅助脚本还可单独运行：`scripts/migrate_split_db.py` 和 `scripts/verify_account_dbs.py`。

---

## 适合继续扩展的方向

- 更细的筛选条件（属性、稀有度、赛制等）
- 卡组导入 / 导出更丰富的格式
- 操作日志、备份策略、批量编辑

---

## 一句话总结

`ptcgGallery` 现在已经是一个完整可用的 **本地 PTCG 卡牌库存 + 卡组管理网站**：

- Excel 负责导入卡表
- SQLite 负责落库存和卡组状态
- Flask 提供页面与 API
- 前端页面负责搜索、维护、浏览和备份

如果你接下来要继续开发，这个项目的主要入口可以优先看：

- `run.py`
- `ptcg_gallery/__init__.py`
- `ptcg_gallery/services.py`
- `tests/test_app.py`

