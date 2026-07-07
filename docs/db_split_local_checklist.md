# 拆库本地演习清单

在本地电脑上先完整跑一遍拆库迁移流程，确认数据和功能都正确后，再上线到服务器。

---

## 第 0 步：确认当前环境

在项目根目录下执行以下检查：

```powershell
cd F:\ptcgGallery\ptcgGalleryWeb

# 1. 确认使用的是 Python 3.11（不是 embeddable 3.10）
#    如果 python 命令指向 3.10，下面全部改用绝对路径：
#    C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe
python --version
# 期望：Python 3.11.x

# 2. 确认依赖已安装
python -c "import flask; import openpyxl; import waitress; print('OK')"
# 期望：OK

# 3. 跑一遍现有测试，确认基线
python -m unittest discover -s tests -v
# 期望：42 tests, OK

# 4. 记录当前 git commit
git rev-parse HEAD
git status --short
```

---

## 第 1 步：备份当前数据

**注意：这是最关键的一步。后面的步骤可以反复重来，但这一步的数据必须保留。**

```powershell
cd F:\ptcgGallery\ptcgGalleryWeb

# 创建演习备份目录
$timestamp = Get-Date -Format "yyyyMMddTHHmmss"
$backupDir = "data\backups\local-rehearsal-$timestamp"
mkdir -p $backupDir

# 备份三个关键文件
copy data\ptcg_gallery.db "$backupDir\ptcg_gallery.db"
copy data\search_preferences.json "$backupDir\search_preferences.json"
copy data\auth.json "$backupDir\auth.json"

# 如果有已有的 accounts 目录也备份
if (Test-Path data\accounts) {
    copy -Recurse data\accounts "$backupDir\accounts"
}

# 确认备份文件大小合理
ls "$backupDir"

# 用 sqlite3 快速检查主库基本统计（和上面在同一个 PowerShell 会话中执行）
python -c "
import sqlite3
conn = sqlite3.connect('$backupDir/ptcg_gallery.db')
conn.row_factory = sqlite3.Row
print('cards:', conn.execute('SELECT COUNT(*) FROM cards').fetchone()[0])
print('accounts:', conn.execute('SELECT COUNT(*) FROM accounts').fetchone()[0])
for row in conn.execute('SELECT id, name FROM accounts ORDER BY id'):
    free = conn.execute('SELECT COUNT(*), COALESCE(SUM(quantity),0) FROM free_inventory WHERE account_id=?', (row['id'],)).fetchone()
    decks = conn.execute('SELECT COUNT(*) FROM decks WHERE account_id=?', (row['id'],)).fetchone()
    print('  account {} (id={}): free_inventory={} rows / {} total, decks={}'.format(
        row['name'], row['id'], free[0], free[1], decks[0]))
conn.close()
"
```

记下输出的数字，迁移后要对账。

---

## 第 2 步：只读检查

先不执行任何写操作，只检查迁移脚本能正确识别你的数据：

```powershell
python scripts/migrate_split_db.py
```

期望输出包含这些关键字段：

- `"mode": "inspect"`
- `accounts` 数组，每项包含 `id`, `name`, `targetDbPath`, `legacy`
- `legacy` 里包含 `freeInventory`, `decks`, `deckCards`, `deckBasicEnergies`, `deckSectionOrders`
- `global.groupOrderCount` 和 `global.cardOrderCount` 反映你现有的排序数据量

**检查点：**

1. 输出的账号数量和名称与你预期一致。
2. 每个账号的 `legacy` 统计数字与你在第 1 步手记的数字一致。
3. `targetDbExists` 都是 `false`（如果之前跑过 apply 可能会是 `true`）。
4. 搜索偏好输出与你预期一致。

如果输出不对，检查 `--data-dir` 和 `--database` 参数是否指向了正确位置。

---

## 第 3 步：执行迁移

```powershell
# 先确保 target 目录是干净的（如果之前跑过 apply）
# 注意：这一步会删除 data/accounts/ 下的所有 .db 文件！
Remove-Item -Force data\accounts\*.db -ErrorAction SilentlyContinue

# 正式执行迁移
python scripts/migrate_split_db.py --apply --force
```

期望输出关键字段：

- `"mode": "apply"`
- `"allAccountsVerified": true`
- `"backupDir"` 指向一个 `data\backups\db-split-XXXX\` 目录
- 每个账号的 `"verificationOk": true`

**检查点：**

1. `allAccountsVerified` 必须是 `true`。如果不是，**停止！**先排查原因再继续。
2. 每个账号的 `verification` 与 `legacy` 数字必须完全一致。
3. backup 目录已生成且包含 `ptcg_gallery.db`。

---

## 第 4 步：验证迁移后的文件结构

```powershell
# 确认目录结构
ls data\accounts\
# 期望：看到 1.db, 3.db, 4.db 等（按你的实际账号数）

# 快速检查每个用户库的内容
python scripts/verify_account_dbs.py
```

**检查点：**

1. 表数量正确（用户库应有 8 张表）。
2. 每个账号的 `free_inventory`、`decks`、`deck_cards` 行数和总量与第 2 步检查报告中的 legacy 数据一致。
3. `user_settings` 每个用户至少 1 行（搜索偏好）。

---

## 第 5 步：启动应用并功能验证

```powershell
# 启动开发服务器（不是 Waitress，便于看日志）
python run.py
```

打开浏览器访问 `http://127.0.0.1:8000`，逐项检查：

### 5.1 登录

- [ ] 以 RhymesX（或你的管理员账号）登录成功。
- [ ] 首页显示正确的库存统计（`/api/summary` 数字与之前一致）。

### 5.2 首页 - 库存浏览

- [ ] 持有卡牌列表正常展示（`/api/holdings` 返回 sections）。
- [ ] 分组顺序与迁移前一致。
- [ ] 卡牌图片正常显示。

### 5.3 库存表格

- [ ] 库存表格页（`/inventory-table`）正常加载。
- [ ] 分组顺序和单卡排序与迁移前一致。
- [ ] 修改某张卡的空闲库存，刷新后数据仍然正确。

### 5.4 卡组

- [ ] 卡组列表正常（`/decks`）。
- [ ] 每个卡组详情页（`/decks/<id>`）正常展示。
- [ ] 主牌和备卡数量正确。
- [ ] Deck 基础能量数量正确。
- [ ] Deck section 排序正确。

### 5.5 搜索

- [ ] 搜索功能正常，能搜到卡牌。
- [ ] 赛制过滤正常工作。
- [ ] 搜索偏好（`/api/search/options`）返回正确的值。
- [ ] 修改搜索偏好后刷新，偏好保持不变。

### 5.6 多用户隔离

- [ ] 创建新账号（需要邀请码）。
- [ ] 切换到新账号。
- [ ] 新账号库存为空（不会看到旧用户的数据）。
- [ ] 新账号放入一些库存。
- [ ] 切回旧账号，旧库存不受影响。
- [ ] 新账号改搜索偏好，旧账号偏好不受影响。

### 5.7 导出导入

- [ ] 导出当前用户状态（`/api/export/state`），下载文件正常。
- [ ] 导入状态文件，数据恢复正确。

---

## 第 6 步：回滚演习

如果第 5 步任何检查项失败，或者为了验证回滚能力，执行以下步骤：

```powershell
# 停止应用（Ctrl+C）

# 恢复主库
copy -Force "data\backups\local-rehearsal-XXXX\ptcg_gallery.db" "data\ptcg_gallery.db"

# 恢复搜索偏好
copy -Force "data\backups\local-rehearsal-XXXX\search_preferences.json" "data\search_preferences.json"

# 恢复 auth.json（如果之前被改过）
copy -Force "data\backups\local-rehearsal-XXXX\auth.json" "data\auth.json"

# 删除新生成的账号库
Remove-Item -Force data\accounts\*.db -ErrorAction SilentlyContinue

# 如果有备份的旧 accounts 目录也恢复
if (Test-Path "data\backups\local-rehearsal-XXXX\accounts") {
    Remove-Item -Recurse -Force data\accounts -ErrorAction SilentlyContinue
    copy -Recurse "data\backups\local-rehearsal-XXXX\accounts" "data\accounts"
}

# 重新跑测试确认回滚成功
python -m unittest discover -s tests -v
# 期望：42 tests, OK

# 启动应用再次手动检查
python run.py
```

---

## 第 7 步：确认清单（上线前）

在本地演习全部通过后，上线前确认以下事项：

- [ ] 42 个测试全部通过。
- [ ] 迁移工具的 inspect 模式和 apply 模式均正常执行。
- [ ] 多用户隔离验证通过（库存、卡组、排序、偏好互不影响）。
- [ ] 回滚路径已演练且有效。
- [ ] 服务器上的 Python 版本 >= 3.11。
- [ ] 服务器上已安装 `openpyxl`（`pip install openpyxl==3.1.5`）。
- [ ] 服务器上的代码已更新到包含拆库改动的版本。
- [ ] 已在服务器上对生产数据做过 `inspect` 检查，确认数据统计无误。
- [ ] 已确定维护窗口时间（建议留 30 分钟）。
- [ ] 已通知用户维护时间。
- [ ] 准备了回滚用的代码版本和备份文件位置。

---

## 附：本地演习用 PowerShell 一键脚本

把下面内容保存为 `scripts\local_rehearsal.ps1`，一键跑完第 1~4 步：

```powershell
# local_rehearsal.ps1 — 拆库本地演习脚本
# 用法：在项目根目录下执行 .\scripts\local_rehearsal.ps1

$ErrorActionPreference = "Stop"
$python = "C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe"

Write-Host "=== Step 0: Pre-check ===" -ForegroundColor Cyan
& $python --version
& $python -c "import flask; import openpyxl; print('Dependencies OK')"

Write-Host "`n=== Step 1: Backup ===" -ForegroundColor Cyan
$ts = Get-Date -Format "yyyyMMddTHHmmss"
$backupDir = "data\backups\local-rehearsal-$ts"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item "data\ptcg_gallery.db" "$backupDir\ptcg_gallery.db"
if (Test-Path "data\search_preferences.json") { Copy-Item "data\search_preferences.json" "$backupDir\search_preferences.json" }
if (Test-Path "data\auth.json") { Copy-Item "data\auth.json" "$backupDir\auth.json" }
Write-Host "Backup created: $backupDir"

Write-Host "`n=== Step 2: Inspect ===" -ForegroundColor Cyan
& $python scripts/migrate_split_db.py
if ($LASTEXITCODE -ne 0) { throw "Inspect failed" }

Write-Host "`n=== Step 3: Apply migration ===" -ForegroundColor Cyan
Remove-Item -Force data\accounts\*.db -ErrorAction SilentlyContinue
& $python scripts/migrate_split_db.py --apply --force
if ($LASTEXITCODE -ne 0) { throw "Migration apply failed" }

Write-Host "`n=== Step 4: Verify file structure ===" -ForegroundColor Cyan
Get-ChildItem data\accounts\

Write-Host "`n=== Step 5: Run tests ===" -ForegroundColor Cyan
& $python -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw "Tests failed" }

Write-Host "`n=== All steps passed! ===" -ForegroundColor Green
Write-Host "Backup: $backupDir"
Write-Host "Now start the app: python run.py"
Write-Host "Then manually verify with the checklist in docs/db_split_local_checklist.md"
```
