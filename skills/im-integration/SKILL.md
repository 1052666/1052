---
name: im-integration
description: IM 集成管理：配置和管理 Telegram、飞书机器人。当用户询问"接入 Telegram"、"配置飞书机器人"、"IM 集成"时使用。
---

# IM 集成管理

本项目支持 **Telegram** 和 **飞书(Lark)** 两大 IM 平台接入。

## 架构说明

- 前端配置：在网页设置面板配置 Token/AppID
- 后端运行：服务器维护长连接，接收消息
- 流式输出：两个平台都支持实时打字效果
- 文件输出：AI 生成的文件通过链接分享

---

## Telegram 接入

### 1. 创建机器人

1. 在 Telegram 搜索 @BotFather
2. 发送 `/newbot` 创建新机器人
3. 按提示设置名称和用户名（必须以 _bot 结尾）
4. 获取 **Bot Token**（形如：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）

### 2. 前端配置

- 打开网页设置面板 → 📱 IM 集成
- 勾选 "Telegram 机器人"
- 填入 Bot Token
- 点击保存

### 3. 验证

在 Telegram 向机器人发送 `/start`，应收到欢迎消息。

---

## 飞书接入

### 1. 创建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 添加 **机器人** 能力
4. 获取 **App ID** 和 **App Secret**（凭证与基础信息）
5. 进入「事件与回调」→「加密策略」：
   - 可选：获取 **Encrypt Key**（消息加密密钥）
   - 可选：获取 **Verification Token**（验证令牌）
6. 事件订阅方式选择：**长连接**（WebSocket）
7. 添加事件：`im.message.receive_v1`
8. 发布应用

> **注意**：Encrypt Key 和 Verification Token 在长连接模式下可选填，Webhook 回调模式下必填。

### 2. 前端配置

- 打开网页设置面板 → 📱 IM 集成
- 勾选 "飞书 机器人"
- 填入 App ID 和 App Secret
- 点击保存

### 3. 验证

在飞书群聊或个人聊天中 @机器人，发送消息测试。

---

## 功能对比

| 功能 | Telegram | 飞书 |
|------|----------|------|
| 消息格式 | 纯文本 | 卡片消息（富文本） |
| 流式输出 | ✓ 编辑消息 | ✓ 更新卡片 |
| 文件分享 | URL 链接 | URL 链接 |
| 命令支持 | /new /help | /new /help |
| 群组支持 | ✓ | ✓ |

---

## 常见问题

**Q: 为什么配置了但没反应？**
- 检查网络连接
- 查看服务器日志是否有连接成功提示
- 确认 Token/AppID 是否正确

**Q: 支持多人使用吗？**
- 支持。每个用户有独立的对话上下文

**Q: 文件怎么分享？**
- AI 生成的文件保存在 `data/1111/`，通过链接 `http://服务器/files/文件名` 分享

---

## 技术细节

- Telegram：python-telegram-bot 库，轮询模式
- 飞书：lark-oapi 库，WebSocket 长连接
- 消息持久化：`data/telegram_conv/` 和 `data/lark_conv/`
