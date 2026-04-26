import type { PkmSop } from './pkm.types.js'

const STORE_SOP: PkmSop = {
  title: '知识存储 SOP',
  description: '将新知识存入 PKM 系统的三步引导流程',
  steps: [
    {
      title: '选择存储位置',
      description: '根据知识类型选择合适的存储模块：Wiki 适合结构化知识（实体、概念、综合分析、经验），Memory 适合个人偏好和规则，Resources 适合参考资料，Skills 适合技能脚本。',
      tips: [
        '经验类知识使用 Wiki 的「经验」分类',
        '个人习惯和偏好存入 Memory',
        '如果有不确定的情况，可以先存入 Wiki 后续再调整',
      ],
    },
    {
      title: '填写标引信息',
      description: '为知识条目填写关键词、主题词、别名和场景描述，这些信息将帮助后续检索。可使用 AI 辅助标引功能自动生成建议。',
      tips: [
        '关键词选择 3-5 个核心词',
        '主题词使用标准术语而非口语表达',
        '别名填写常见的同义表达',
        '场景描述知识适用的具体情境',
      ],
    },
    {
      title: '验证并保存',
      description: '检查标引信息的完整性和准确性，确认后保存。系统会自动将新知识纳入统一索引。',
      tips: [
        '保存后可在 PKM 搜索中验证是否能被正确检索',
        '建议定期检查词表，确保同义词映射完整',
      ],
    },
  ],
}

const RETRIEVE_SOP: PkmSop = {
  title: '知识检索 SOP',
  description: '从 PKM 系统中检索知识的四步引导流程',
  steps: [
    {
      title: '明确检索意图',
      description: '确定要查找的知识类型和范围。是要查找某个具体实体、某个概念的解释、还是某次经验记录？',
      tips: [
        '先想清楚需要什么类型的知识',
        '考虑是否需要跨类型搜索',
      ],
    },
    {
      title: '构建搜索表达式',
      description: '使用布尔查询语法构建搜索表达式。支持 AND（默认）、OR、NOT 操作符，以及引号精确匹配。',
      tips: [
        '多个词之间默认为 AND 关系',
        '使用 OR 扩大搜索范围',
        '使用 NOT 或 - 排除不相关结果',
        '使用引号进行精确匹配',
        '系统会自动扩展同义词',
      ],
    },
    {
      title: '筛选与排序',
      description: '使用分类筛选、来源筛选和时间范围缩小结果范围。系统按相关性排序，标题匹配权重最高。',
      tips: [
        '优先查看高权重结果',
        '利用分类筛选快速定位',
        '注意查看匹配字段提示',
      ],
    },
    {
      title: '跳转与关联',
      description: '从搜索结果跳转到原始数据源查看完整内容，并利用关联关系发现相关知识。',
      tips: [
        '点击跳转链接查看完整内容',
        '关注关联的知识条目',
        '如果未找到，尝试调整搜索词或使用同义词',
      ],
    },
  ],
}

export function getStoreSop(): PkmSop {
  return STORE_SOP
}

export function getRetrieveSop(): PkmSop {
  return RETRIEVE_SOP
}
