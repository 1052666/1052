---
name: create-skill
description: 创建新 Skill 技能的完整指南。当用户询问"如何创建技能"、"怎么写 SKILL.md"、"新增技能"或希望让助手掌握某个领域的专业知识时使用。
---

# 如何创建和使用 Skill

## 什么是 Skill

Skill（技能）是一个文件夹，包含一个 `SKILL.md` 文件，用于封装特定领域的专业知识、工作流程和操作指南。

助手在启动时自动扫描 `skills/` 目录，将每个技能的名称和描述注入系统提示词。当任务匹配某个技能时，助手会调用 `invoke_skill` 工具获取完整指令后再执行。

---

## 目录结构

技能可以有两种形式：

### 1. 纯文档型（纯指南）
只有 SKILL.md，用于提供知识和操作流程：
```
skills/
└── 技能名/
    └── SKILL.md
```

### 2. 完整功能型（指南 + 脚本）
包含 SKILL.md 指导，以及可执行的脚本文件：
```
skills/
└── 技能名/
    ├── SKILL.md          ← 必需：元数据 + 使用说明
    └── scripts/          ← 可选：实际可执行的脚本
        ├── analyze.py
        ├── convert.sh
        └── helpers/
            └── utils.py
```

### 什么时候创建脚本？

| 场景 | 做法 |
|------|------|
| 技能只需要"知道怎么做" | 只写 SKILL.md |
| 技能需要"执行具体任务"（分析、转换、生成等） | SKILL.md + scripts/ |

**示例**：
- 「代码审查」→ 只需要文档指导 → 纯 SKILL.md
- 「PDF转Word」→ 需要执行转换程序 → SKILL.md + scripts/convert.py

---

## SKILL.md 格式

```markdown
---
name: your-skill-name
description: 简要说明这个技能做什么，以及何时应该使用它（建议 50-200 字）
---

# 技能标题

## 快速开始
...

## 详细指南
...

## 示例
...
```

---

## 字段规范

| 字段          | 要求                                              |
|---------------|---------------------------------------------------|
| `name`        | 小写字母、数字、连字符，最长 64 字符，全局唯一    |
| `description` | 非空，最长 1024 字符，**必须说明触发场景**        |

> **description 写作技巧**：描述应包含"何时使用"，例如：
> `"处理 Excel 表格时使用。当用户提到数据分析、表格操作、图表生成时触发。"`

---

## 如何调用技能

### 方式一：AI 自动识别（推荐）
对话中提及技能相关的任务，助手会自动匹配并调用：
- 用户："帮我分析一下这个 CSV 数据"
- 助手自动调用 `invoke_skill("data-analysis")` 获取指令后执行

### 方式二：显式调用
在对话中直接说：
- "使用 `create-skill` 技能帮我创建新技能"
- "调用 data-analysis 技能分析数据"

### 方式三：API 接口
```bash
# 列出所有技能
GET /skills

# 获取某个技能的完整内容
GET /skills/{name}

# 手动触发重载
POST /skills/reload
```

---

## 热更新

修改或新增 `SKILL.md` 后**无需重启服务器**。

系统每 **3 秒**自动检测 `skills/` 目录变更并重载：
- 新增技能文件夹 → 自动加载
- 修改 `SKILL.md` → 自动重载
- 删除技能文件夹 → 自动移除

---

## 创建新技能的完整步骤

### 方式一：纯文档型技能

**第一步**：创建目录和 SKILL.md

```
mkdir skills/code-review
write_file skills/code-review/SKILL.md
```

**第二步**：写入内容，保存后自动生效。

---

### 方式二：完整功能型技能（带脚本）

**场景示例**：创建一个"图片批量压缩"技能

**第一步**：创建目录结构

```
mkdir skills/image-compress/scripts
```

**第二步**：创建执行脚本

```python
# skills/image-compress/scripts/compress.py
import sys
from PIL import Image
import os

src = sys.argv[1]
dst = sys.argv[2]
quality = int(sys.argv[3]) if len(sys.argv) > 3 else 85

img = Image.open(src)
img.save(dst, quality=quality, optimize=True)
print(f"压缩完成: {src} -> {dst}")
```

**第三步**：创建 SKILL.md，说明如何使用这个脚本

```markdown
---
name: image-compress
description: 批量压缩图片。当用户提到"压缩图片"、"减小图片体积"、"图片太大"时使用。
---

# 图片压缩技能

## 使用方法

调用 scripts/compress.py：

```bash
python skills/image-compress/scripts/compress.py <输入文件> <输出文件> [质量]
```

- quality: 1-95，默认 85

## 工作流程

1. 确认用户要压缩的图片路径
2. 执行压缩脚本
3. 返回压缩后的文件路径
```

**第四步**：如需依赖，在技能目录放 requirements.txt：

```
Pillow>=10.0.0
```

---

### 验证加载

创建完成后，调用 reload 或等待 3 秒自动重载：

```bash
POST /skills/reload
GET /skills
```

---

## 示例：创建一个 Python 代码审查技能

```
skills/
└── code-review/
    └── SKILL.md
```

```markdown
---
name: code-review
description: 对 Python 代码进行专业审查。当用户提到代码审查、代码优化、检查代码质量时使用。
---

# Python 代码审查

## 审查维度
1. **正确性**：逻辑错误、边界情况
2. **性能**：时间复杂度、内存使用
3. **可读性**：命名规范、注释质量
4. **安全性**：输入验证、潜在漏洞

## 输出格式
- 🔴 严重问题（必须修复）
- 🟡 建议改进
- 🟢 优点

## 示例
用户提供代码后，按以上维度逐一分析，最后给出改进后的代码。
```
```

---

## 最佳实践

- **description 要具体**：包含触发关键词，让 AI 能准确匹配
- **正文要结构化**：使用标题、列表、代码块，便于 AI 理解
- **聚焦单一职责**：一个技能做好一件事，比大而全更有效
- **提供示例**：在正文中给出具体示例，提升执行准确率
