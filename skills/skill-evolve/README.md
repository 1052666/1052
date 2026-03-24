# skill-evolve

用演进式方法论改进任何 Claude Code Skill 的质量。

**核心哲学：好 skill 是总结出来的，不是设计出来的。**

## 是什么

一个 Claude Code Skill，专门用来改进其他 skill。

你给它一个已有的 skill，它会通过 **观察→总结→改进→验证** 的循环，系统性地提升质量。

方法论来自三个核心机制：

| 机制 | 含义 | 在 skill 改进中的落地 |
|------|------|---------------------|
| **OTF**（On-The-Fly） | 边做边总结 | 每跑一个测试 prompt 就记录观察 |
| **JIT**（Just-In-Time） | 小步快跑 | 每轮只改 1-2 个核心模式 |
| **Bootstrap**（自举） | 知识自增殖 | 每轮笔记是下一轮的燃料 |

## 安装

```bash
# 复制到 Claude Code skills 目录
cp -r skill-evolve ~/.claude/skills/skill-evolve
```

或者手动把 `SKILL.md` 放到 `~/.claude/skills/skill-evolve/SKILL.md`。

## 使用

在 Claude Code 中说：

- `/evolve` + 目标 skill 路径
- "改进这个 skill"
- "这个 skill 效果不好"
- "优化 skill"

也可以带着一个 skill 的输出来说"这不对"。

## 五步演进循环

```
冷启动（建立直觉）
  → 观察（用真实 prompt 跑）
    → 提炼模式（从案例到规律）
      → 改写（每轮只改一件事）
        → 验证（判断是否收敛）
          → 回到观察，进入下一轮
```

每轮产出保存在目标 skill 的 `evolve/` 目录下：

```
target-skill/
├── evolve/
│   ├── evolution-log.md       ← 压缩记忆（跨轮次索引）
│   └── round-1/
│       ├── observations.md    ← 观察记录
│       ├── patterns.md        ← 错误模式表
│       └── changes.md         ← 改写记录
```

下次再改进同一个 skill，Claude 会先读 `evolution-log.md`，从上次停下的地方继续。

## 和 skill-creator 的关系

| | skill-creator | skill-evolve |
|--|--------------|-------------|
| 阶段 | 从 0 到 1 | 从 1 到 N |
| 做什么 | 创建新 skill | 改进现有 skill |
| 方法 | 访谈→写初版→跑评测 | 观察→提炼模式→迭代 |

两者可以串联：先 `skill-creator` 出初版，再 `skill-evolve` 持续打磨。

## 方法论来源

基于《好东西都是总结出来的》——一篇关于演进式知识工作方法论的文章。核心命题：

> 好东西 = 总结出来 ≠ 设计出来
> OTF（边做边总结）+ JIT（小步快跑）+ Bootstrap（自举）
> 知识自动增长，人工投入递减

## License

MIT
