# 简中卡图说明

## 自动获取（英文兜底）

服务器启动后，后台爬虫会从 Pokémon TCG API 自动下载英文卡图。
查看爬虫状态：`GET /api/crawler/status`

## 手动添加简中卡图

### 方案 A：直接放入此目录

把简中卡图放到 `data/card_images_user/` 下，文件名格式：

```
商品编号-卡牌编号.jpg    如：CSM1aC-001.jpg
商品编号_卡牌编号.png    如：CSM1aC_001.png
卡牌名称.webp            如：小火龙.webp
```

命名需要和 Excel 卡表中的 `商品编号` + `卡牌编号` 一致。放入后刷新页面即可。

### 方案 B：批量导入脚本

```bash
python scripts/import_images.py /path/to/your/images/
```

按文件名自动匹配数据库卡牌并复制到缓存目录。

---

## 目前 (2026) 没有公开的简中卡图 API

| 来源 | 状态 |
|------|------|
| PTCG API | 仅英文卡图，无简中数据 |
| pokemon.cn | 新闻站，无卡牌图库 |
| 52poke wiki | 拒绝爬虫 (403) |
| 集换社 | SPA，API 404 |

推荐的简中卡图获取方式：小程序截图、扫描实体卡。
