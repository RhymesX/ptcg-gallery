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

### 5.1 上传代码

在服务器上创建目录结构：

```bash
mkdir -p /opt/ptcgGalleryWeb/ptcg_gallery/templates
mkdir -p /opt/ptcgGalleryWeb/ptcg_gallery/static
mkdir -p /opt/ptcgGalleryWeb/data
```

然后通过阿里云 Workbench 网页终端，用 `nano` 逐一创建文件（把本地代码内容粘贴进去）。

或者如果你能从本地 scp：

```bash
# 在本地 PowerShell 执行：
scp -r ptcg_gallery root@<服务器IP>:/opt/ptcgGalleryWeb/
scp run.py requirements.txt root@<服务器IP>:/opt/ptcgGalleryWeb/
scp data/ptcg_gallery.db root@<服务器IP>:/opt/ptcgGalleryWeb/data/
scp data/卡表.xlsx root@<服务器IP>:/opt/ptcgGalleryWeb/data/
```

### 5.2 创建虚拟环境

```bash
cd /opt/ptcgGalleryWeb
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 5.3 上传数据文件

```bash
# 从本地复制数据库和卡表（如已通过 scp 上传整个目录则跳过）
# 本地执行：
scp data/ptcg_gallery.db root@<IP>:/opt/ptcgGalleryWeb/data/
scp data/卡表.xlsx root@<IP>:/opt/ptcgGalleryWeb/data/
```

### 5.3 测试运行

```bash
cd /opt/ptcgGalleryWeb
.venv/bin/python run.py
# 看到启动日志即成功，Ctrl+C 退出
```

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
# 登录用户名/密码（修改下面的值来改密码）
Environment=PTCG_AUTH_USER=admin
Environment=PTCG_AUTH_PASS=pika2024

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

    # 静态文件由 Nginx 直接提供
    location /static/ {
        alias /opt/ptcgGalleryWeb/ptcg_gallery/static/;
        expires 7d;
        add_header Cache-Control "public, immutable";
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

编辑 `/etc/systemd/system/ptcggallery.service`，修改 `Environment=PTCG_AUTH_PASS=新密码`：

```bash
sudo nano /etc/systemd/system/ptcggallery.service
# 改完后：
sudo systemctl daemon-reload
sudo systemctl restart ptcggallery
```

---

## 八、更新项目代码

### 方式一：阿里云 Workbench + nano（无需 SSH）

1. 打开阿里云控制台 → ECS → 远程连接 → Workbench
2. `nano` 编辑对应文件，粘贴修改后的内容
3. 只改了 Python/模板 → `sudo systemctl restart ptcggallery`
4. 改了 CSS/JS → 上传新文件 + `sudo systemctl reload nginx`

### 方式二：本地用 scp 上传（如果可以 SSH）

```bash
# 在本地 PowerShell，只上传改动的文件：
scp ptcg_gallery/__init__.py root@<IP>:/opt/ptcgGalleryWeb/ptcg_gallery/
scp ptcg_gallery/services.py root@<IP>:/opt/ptcgGalleryWeb/ptcg_gallery/
scp -r ptcg_gallery/static/ root@<IP>:/opt/ptcgGalleryWeb/ptcg_gallery/
scp -r ptcg_gallery/templates/ root@<IP>:/opt/ptcgGalleryWeb/ptcg_gallery/

# 然后在 Workbench 里重启服务：
sudo systemctl restart ptcggallery
```

### 方式三：推送到 GitHub，服务器 git pull

```bash
cd /opt/ptcgGalleryWeb
git pull
sudo systemctl restart ptcggallery
```

### 常用操作速查

| 改动了什么 | 需要的操作 |
|-----------|-----------|
| Python 代码（.py） | 上传 + `sudo systemctl restart ptcggallery` |
| HTML 模板 | 上传 + `sudo systemctl restart ptcggallery` |
| CSS / JS | 上传新文件 + `sudo systemctl reload nginx` |
| 新增 Python 依赖 | 上传 requirements.txt + `.venv/bin/pip install -r requirements.txt` + restart |
| 改密码 | `sudo nano /etc/systemd/system/ptcggallery.service` → 修改 PTCG_AUTH_PASS → `daemon-reload` + restart |

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
| 🔴 必须 | Flask 登录 | 已内置，环境变量配置密码 |
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
