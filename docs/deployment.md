# ptcgGallery 云服务器部署指南

本文档介绍如何将 ptcgGallery 部署到阿里云 ECS 上。

---

## 一、整体架构

```
浏览器（你的电脑/手机）
    │
    ▼ HTTP (80)
Nginx（反向代理）
    │
    ▼ HTTP (127.0.0.1:8000)
Waitress
    │
    ▼
Flask app → SQLite
```

> 登录由 Flask session 管理，首次访问任何页面自动跳转到登录页。

---

## 二、服务器准备

### 2.1 购买 ECS

| 项目 | 推荐配置 |
|------|---------|
| 实例规格 | 2 vCPU / 2 GB 内存（最低 1 vCPU / 1 GB） |
| 系统盘 | 40 GB（高效云盘） |
| 操作系统 | Ubuntu 22.04 LTS |
| 带宽 | 按量计费，1-5 Mbps |
| 地域 | 离你最近的 |

> 新用户通常有免费试用或低价套餐，年费约 100-300 元。

### 2.2 安全组配置

在阿里云控制台 → ECS → 安全组，添加入方向规则：

| 端口 | 来源 | 用途 |
|------|------|------|
| 22 | 0.0.0.0/0 | SSH / Workbench 远程连接 |
| 80 | 0.0.0.0/0 | HTTP |

### 2.3 域名（可选）

如果没有域名，直接用公网 IP 访问即可。有域名的话加一条 A 记录指向服务器 IP。

---

## 三、连接到服务器

```bash
# SSH（如果你本地可以连）
ssh root@<你的服务器IP>
```

如果本地无法 SSH，使用 **阿里云控制台 → ECS → 实例 → 远程连接 → Workbench**，网页终端同样可用。

---

## 四、安装基础软件

```bash
# 更新系统
apt update && apt upgrade -y

# 安装 Python、Nginx、Git
apt install -y python3 python3-venv python3-pip nginx git

# 确认版本
python3 --version  # 应该 >= 3.11
nginx -v
```

---

## 五、部署项目

### 5.1 拉取代码（推荐：GitHub 私有仓库）

1. 先把项目推到 GitHub/Gitee 私有仓库（参考第八节 Git 工作流）
2. 在服务器上克隆：

```bash
cd /opt
# 如果已有旧目录先备份再删
mv /opt/ptcgGalleryWeb /opt/ptcgGalleryWeb_old 2>/dev/null
git clone https://github.com/你的用户名/ptcg-gallery.git ptcgGalleryWeb
```

> 如果遇到 `GnuTLS recv error`，先 `apt update && apt upgrade -y` 升级系统再重试。

### 5.2 创建虚拟环境并安装依赖

```bash
cd /opt/ptcgGalleryWeb
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 5.3 上传数据文件

数据库文件和 `auth.json` 不在 git 仓库中（已加入 .gitignore），需要从本地上传或在服务器手动创建：

```bash
# 在你的本地电脑 PowerShell 执行（上传已有的数据文件）：
scp data/ptcg_gallery.db root@<服务器IP>:/opt/ptcgGalleryWeb/data/
scp data/卡表.xlsx root@<服务器IP>:/opt/ptcgGalleryWeb/data/

# 在服务器上创建 auth.json（见 5.4 认证配置）或者从本地上传：
scp data/auth.json root@<服务器IP>:/opt/ptcgGalleryWeb/data/
```

### 5.4 创建认证配置文件

应用启动时会从 `data/auth.json` 读取管理员凭据，首次部署时必须手动创建。在服务器上执行：

```bash
sudo nano /opt/ptcgGalleryWeb/data/auth.json
```

写入以下内容（替换为实际的用户名和密码）：

```json
{
  "admin_user": "你的管理员用户名",
  "admin_pass": "你的管理员密码",
  "init_admin_pass": "RhymesX初始密码"
}
```

- **admin_user / admin_pass**：登录页使用的管理员用户名和密码
- **init_admin_pass**：默认 RhymesX 账号的初始密码，仅在新数据库首次初始化时生效，之后可登录网页自行改密

> 该文件和数据库文件一样已在 `.gitignore` 中排除，`git pull` 不会覆盖。

### 5.5 测试运行

```bash
cd /opt/ptcgGalleryWeb
.venv/bin/python run.py
# 看到启动日志即成功，Ctrl+C 退出
```

### 5.6 拆库迁移上线步骤

> **适用版本**：本次提交（`fe0833c`，2026-07-07）引入了"共享目录库 + 用户独立业务库"架构。
> 从单库升级到此版本时需要执行本节的迁移步骤。
> **后续版本**：如果服务器已经完成拆库（即 `data/accounts/` 目录已存在且包含各用户 `.db` 文件），后续 `git pull` 更新代码时**不需要**再执行本节步骤，直接重启服务即可。

#### 前置条件

在服务器上执行迁移前，确保：

- 代码已更新到包含拆库改动的版本（`git pull` 或手动上传）
- 虚拟环境依赖已安装（`openpyxl` 是必需的）
- 已确认服务器当前没有任何用户正在使用（通知维护窗口）

```bash
# 确认依赖
cd /opt/ptcgGalleryWeb
.venv/bin/pip install -r requirements.txt
.venv/bin/python -c "import flask; import openpyxl; print('OK')"
```

#### 步骤 1：停服并手动备份

```bash
# 停止服务
sudo systemctl stop ptcggallery
sudo systemctl status ptcggallery   # 确认已停止

# 手动做一次额外备份（迁移脚本也会自动备份，这里再加一层保险）
cd /opt/ptcgGalleryWeb
mkdir -p data/backups
cp data/ptcg_gallery.db "data/backups/manual-pre-migration-$(date +%Y%m%d_%H%M%S).db"
cp data/search_preferences.json "data/backups/manual-pre-migration-search-$(date +%Y%m%d_%H%M%S).json" 2>/dev/null
cp data/auth.json "data/backups/manual-pre-migration-auth-$(date +%Y%m%d_%H%M%S).json" 2>/dev/null
```

#### 步骤 2：只读检查

先不做任何写操作，只检查迁移脚本能否正确读取当前数据：

```bash
cd /opt/ptcgGalleryWeb
.venv/bin/python scripts/migrate_split_db.py \
    --report-path /opt/ptcgGalleryWeb/data/backups/db-split-inspect.json
```

检查输出：

- `accounts` 列表中的账号数量和名称与你预期一致
- 每个账号的 `legacy` 统计（`freeInventory` 行数/总量、`decks` 数量、`deckCards` 行数/总量）与实际情况相符
- 所有 `targetDbExists` 为 `false`
- 脚本退出码为 0

如果任何一项不对，**停止**，排查后再继续。

#### 步骤 3：执行迁移

```bash
cd /opt/ptcgGalleryWeb
.venv/bin/python scripts/migrate_split_db.py --apply
```

关键检查点：

- `"allAccountsVerified": true` —— 必须是 `true`，如果不是，**停止！**
- 每个账号的 `"verificationOk": true`
- `"backupDir"` 指向 `data/backups/db-split-XXXX/`，确认该目录存在且包含 `ptcg_gallery.db`
- 脚本退出码为 0

#### 步骤 4：迁移后对账

```bash
cd /opt/ptcgGalleryWeb

# 确认账号库文件已生成
ls -la data/accounts/

# 快速检查每个用户库的表和数据
.venv/bin/python scripts/verify_account_dbs.py
```

检查点：

- 每个账号有一个 `.db` 文件
- 每个用户库有 8 张业务表（`free_inventory`、`decks`、`deck_cards`、`deck_basic_energies`、`deck_section_orders`、`holdings_group_orders`、`holdings_card_orders`、`user_settings`）
- 数据量与步骤 2 检查报告中的 `legacy` 统计一致

#### 步骤 5：启动服务并验证

```bash
sudo systemctl start ptcggallery
sudo systemctl status ptcggallery   # 确认 active (running)

# 查看启动日志，确认无异常
journalctl -u ptcggallery -n 20
```

打开浏览器访问网站，逐项验证：

- [ ] 管理员账号能正常登录
- [ ] 首页库存统计数字正确
- [ ] 持有卡牌列表正常展示，分组顺序正确
- [ ] 卡组列表和卡组详情正常
- [ ] 搜索功能正常
- [ ] 创建新账号后，新旧账号数据隔离（库存、卡组、排序、偏好互不干扰）

#### 步骤 6：清理旧数据（可选，建议等稳定运行一周后再做）

迁移成功后，旧主库中的 `free_inventory`、`decks`、`deck_cards`、`deck_basic_energies`、`deck_section_orders`、`holdings_group_orders` 等旧表仍然保留。确认新架构稳定后，可以通过 SQLite 清理这些旧表以减小主库体积。**在此之前不要删除，它们是回滚的依据。**

#### 回滚说明

如果迁移后发现问题需要回滚：

```bash
# 1. 停止服务
sudo systemctl stop ptcggallery

# 2. 恢复旧代码（git checkout 到迁移前的 commit）

# 3. 恢复主库（使用步骤 1 手动备份的文件）
cd /opt/ptcgGalleryWeb
cp data/backups/manual-pre-migration-XXXX.db data/ptcg_gallery.db

# 4. 恢复搜索偏好
cp data/backups/manual-pre-migration-search-XXXX.json data/search_preferences.json 2>/dev/null

# 5. 删除新生成的账号库
rm -f data/accounts/*.db

# 6. 启动服务
sudo systemctl start ptcggallery
```

> 迁移脚本自身也会在 `data/backups/db-split-XXXX/` 下保留一份备份，也可以用它来恢复。

---

## 六、配置 systemd 服务（开机自启）

创建 `/etc/systemd/system/ptcggallery.service`（`sudo nano` 编辑）：

```ini
[Unit]
Description=ptcgGallery Flask App
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/ptcgGalleryWeb
ExecStart=/opt/ptcgGalleryWeb/.venv/bin/python run.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

启动：

```bash
chown -R www-data:www-data /opt/ptcgGalleryWeb/data/
systemctl daemon-reload
systemctl enable ptcggallery
systemctl start ptcggallery
systemctl status ptcggallery   # 确认 active (running)
```

---

## 七、配置 Nginx

创建 `/etc/nginx/sites-available/ptcggallery`（`sudo nano` 编辑）：

```nginx
server {
    listen 80;
    server_name _;   # 或你的域名

    # 代理到 Flask
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 20M;
    }

    # 静态文件由 Nginx 直接提供（不缓存 JS/CSS，确保更新后浏览器立即生效）
    location /static/ {
        alias /opt/ptcgGalleryWeb/ptcg_gallery/static/;
        expires -1;
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # 卡图缓存
    location /api/images/ {
        alias /opt/ptcgGalleryWeb/data/card_images/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

启用：

```bash
ln -sf /etc/nginx/sites-available/ptcggallery /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### 修改登录密码

登录后在网页右上角点击改密即可修改当前账号密码。管理员凭据也可直接编辑 `/opt/ptcgGalleryWeb/data/auth.json`，改完后重启服务：

```bash
sudo nano /opt/ptcgGalleryWeb/data/auth.json
sudo systemctl restart ptcggallery
```

---

## 八、更新项目代码

### 推荐方式：GitHub 推送 + 服务器 git pull

**首次（一次性）**：把代码推到一个私有 GitHub 仓库。

```bash
# 本地 PowerShell
cd f:\ptcgGallery\ptcgGalleryWeb
git init
git add .
git commit -m "init"
git remote add origin https://github.com/你的用户名/ptcg-gallery.git
git branch -M main
git push -u origin main
```

**每次更新**：

本地改完代码后：

```bash
# 本地
git add . && git commit -m "描述改动" && git push
```

服务器拉取并重启：

```bash
# 阿里云 Workbench 终端
cd /opt/ptcgGalleryWeb
git pull
sudo systemctl restart ptcggallery
```

### 备用方式：Workbench + nano（无需 SSH）

1. 阿里云控制台 → ECS → 远程连接 → Workbench
2. `nano` 编辑对应文件，粘贴修改后的内容
3. `sudo systemctl restart ptcggallery`

### 常用操作速查

| 改动了什么 | 需要的操作 |
|-----------|-----------|
| Python 代码（.py） | 上传 + `sudo systemctl restart ptcggallery` |
| HTML 模板 | 上传 + `sudo systemctl restart ptcggallery` |
| CSS / JS | 上传新文件 + `sudo systemctl reload nginx` |
| 新增 Python 依赖 | 上传 requirements.txt + `.venv/bin/pip install -r requirements.txt` + restart |
| 改密码 | 网页右上角改密按钮；或编辑 `data/auth.json` 后 `restart` |

### 查看日志

```bash
# Flask 应用日志
journalctl -u ptcggallery -f

# Nginx 日志
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

---

## 九、数据备份

### 9.1 定时备份脚本

创建 `/opt/backup.sh`：

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/opt/backups
mkdir -p $BACKUP_DIR

# 备份数据库
cp /opt/ptcgGalleryWeb/data/ptcg_gallery.db $BACKUP_DIR/ptcg_gallery_$DATE.db

# 备份卡表
cp /opt/ptcgGalleryWeb/data/卡表.xlsx $BACKUP_DIR/卡表_$DATE.xlsx

# 保留最近 30 天的备份
find $BACKUP_DIR -mtime +30 -delete

echo "Backup done: $DATE"
```

```bash
chmod +x /opt/backup.sh
```

### 9.2 定时任务（每天凌晨 3 点）

```bash
crontab -e
# 添加：
0 3 * * * /opt/backup.sh >> /var/log/ptcg-backup.log 2>&1
```

### 9.3 拉取备份到本地（推荐定期做）

```bash
# 在你本地电脑执行：
scp root@<IP>:/opt/backups/ptcg_gallery_*.db ./
```

---

## 十、安全性

| 优先级 | 项目 | 说明 |
|--------|------|------|
| 🔴 必须 | Flask 登录 | 已内置，通过 data/auth.json 配置凭据 |
| 🔴 必须 | 定期备份 | 数据库丢了就没了 |
| 🟡 推荐 | HTTPS | 有域名后配 Let's Encrypt |
| 🟡 推荐 | 关 80 换 443 | HTTPS 后关闭 HTTP |
| 🟡 推荐 | 修改 SSH 端口 | 改掉 22 |

---

## 十一、成本估算

| 项目 | 月费 |
|------|------|
| ECS 2C2G | ~30-60 元 |
| 合计 | **~30-60 元/月** |

---

## 十二、可选：添加 HTTPS（有域名后）

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名.com
```

certbot 会自动修改 Nginx 配置添加 SSL。
