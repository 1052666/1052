---
name: web-search
description: 联网搜索技能，支持 DuckDuckGo 和 Bing 搜索。当用户需要搜索最新信息、查天气、查新闻、查资料时自动触发。
---

# 联网搜索技能

## 功能概述

支持多种搜索引擎自动切换：
- **DuckDuckGo Instant Answer API** - 快速，适合简单查询
- **DuckDuckGo HTML** - 结果更丰富，可能被验证码拦截
- **Bing RSS** - 备用搜索引擎

## 使用方式

### 命令行调用

```bash
python skills/web-search/scripts/search.py "搜索关键词" -n 10 -v
```

参数说明：
- `query`: 搜索关键词
- `-n, --max`: 最大结果数 (默认10)
- `-e, --engine`: 搜索引擎 (auto/duckduckgo/bing)
- `-v, --verbose`: 详细输出（包含链接和摘要）
- `--save path.json`: 保存结果到文件

### 通过 run_cmd 工具调用

```bash
python skills/web-search/scripts/search.py "关键词"
```

## 输出格式

```
1. 标题 - 摘要...
2. 标题 - 摘要...
...
```

详细模式 (-v) 输出：
```
1. [Source] 标题
   链接: https://...
   摘要: ...

2. [Source] 标题
   链接: https://...
   摘要: ...
```

## 常见搜索示例

| 场景 | 命令 |
|------|------|
| 搜索天气 | `python skills/web-search/scripts/search.py "北京天气"` |
| 搜索新闻 | `python skills/web-search/scripts/search.py "今日新闻"` |
| 搜索资料 | `python skills/web-search/scripts/search.py "Python教程"` |
| 搜索并保存 | `python skills/web-search/scripts/search.py "关键词" --save result.json` |

## 工作流程

1. **识别搜索需求** → 用户需要查询信息时触发
2. **执行搜索脚本** → 自动选择可用的搜索引擎
3. **解析结果** → 返回结构化的标题、链接、摘要
4. **返回给用户** → 整理后以可读格式输出

## 触发场景

- 用户说"搜索一下"、"帮我查一下"
- 用户询问天气、新闻、资料
- 需要获取实时信息时

## 技术细节

- 使用 Python 标准库（urllib），无需额外依赖
- 自动处理编码问题（UTF-8）
- 自动处理搜索引擎切换和异常
- 支持 Windows 和 Linux
