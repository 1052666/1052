#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网页搜索工具 - 支持多种搜索引擎
使用 DuckDuckGo Instant Answer API，无需验证码
"""

import sys
import json
import argparse
import io
from pathlib import Path

# 修复 Windows 控制台编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 添加父目录到路径以便于导入
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def search_duckduckgo_instant(query: str, max_results: int = 10) -> list:
    """
    使用 DuckDuckGo Instant Answer API 搜索
    这个 API 不需要验证码，适合程序调用

    Args:
        query: 搜索关键词
        max_results: 最大结果数

    Returns:
        搜索结果列表
    """
    import urllib.parse
    import urllib.request

    encoded_query = urllib.parse.quote(query)
    # Instant Answer API
    url = f"https://api.duckduckgo.com/?q={encoded_query}&format=json&no_redirect=1&d=1&kd=-1"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        results = []

        # 获取百科摘要 (Abstract)
        if data.get('AbstractText'):
            results.append({
                'title': data.get('Heading', query),
                'url': data.get('AbstractURL', ''),
                'description': data.get('AbstractText', ''),
                'source': 'Abstract'
            })

        # 获取 RelatedTopics
        for topic in data.get('RelatedTopics', [])[:max_results]:
            if topic.get('Text') and topic.get('FirstURL'):
                results.append({
                    'title': topic.get('Text', '')[:150],
                    'url': topic.get('FirstURL', ''),
                    'description': topic.get('Text', ''),
                    'source': 'Related'
                })
            # 也检查 Icon
            elif topic.get('Icon') and topic.get('Icon').get('URL'):
                # 这是一个网站分类
                pass

        # 获取答案 (Answer)
        if data.get('Answer'):
            results.insert(0, {
                'title': 'Answer',
                'url': '',
                'description': data.get('Answer', ''),
                'source': 'Answer'
            })

        return results[:max_results]

    except Exception as e:
        return [{'error': str(e)}]


def search_duckduckgo_html(query: str, max_results: int = 10) -> list:
    """
    使用 DuckDuckGo HTML 搜索
    注意：这个接口可能被验证码拦截
    """
    import urllib.parse
    import urllib.request
    import re

    encoded_query = urllib.parse.quote(query)
    url = f"https://duckduckgo.com/html/?q={encoded_query}&kl=zh-cn"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode('utf-8', errors='replace')

        # 检查是否被验证码拦截
        if 'anomaly-modal' in html or 'bots use DuckDuckGo' in html:
            return [{'error': '搜索引擎要求验证，请稍后重试或使用其他搜索词'}]

        results = []

        # 解析搜索结果
        pattern = r'<a class="result__a" href="([^"]+)">([^<]+)</a>'
        for match in re.finditer(pattern, html):
            url = match.group(1)
            title = match.group(2).strip()
            results.append({
                'title': title,
                'url': url,
                'description': '',
                'source': 'HTML'
            })
            if len(results) >= max_results:
                break

        # 提取摘要
        snippet_pattern = r'<a class="result__snippet"[^>]*>([^<]+)</a>'
        snippets = re.findall(snippet_pattern, html)
        for i, snippet in enumerate(snippets):
            if i < len(results):
                results[i]['description'] = snippet.strip()

        return results

    except Exception as e:
        return [{'error': str(e)}]


def search_bing_rss(query: str, max_results: int = 10) -> list:
    """
    使用 Bing RSS 搜索
    """
    import urllib.parse
    import urllib.request
    import re

    encoded_query = urllib.parse.quote(query)
    url = f"https://www.bing.com/search?q={encoded_query}&format=rss"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            xml = response.read().decode('utf-8', errors='replace')

        results = []
        # 解析 RSS 中的 item
        items = re.findall(r'<item>(.*?)</item>', xml, re.DOTALL)
        for item in items[:max_results]:
            title_match = re.search(r'<title>(.*?)</title>', item)
            link_match = re.search(r'<link>(.*?)</link>', item)
            desc_match = re.search(r'<description>(.*?)</description>', item, re.DOTALL)

            if title_match:
                title = re.sub(r'<[^>]+>', '', title_match.group(1))  # 去除HTML标签
                link = link_match.group(1) if link_match else ''
                desc = re.sub(r'<[^>]+>', '', desc_match.group(1)[:200]) if desc_match else ''

                results.append({
                    'title': title,
                    'url': link,
                    'description': desc,
                    'source': 'Bing'
                })

        return results

    except Exception as e:
        return [{'error': str(e)}]


def search(query: str, max_results: int = 10, engine: str = 'auto') -> list:
    """
    综合搜索接口，自动选择可用的搜索引擎

    Args:
        query: 搜索关键词
        max_results: 最大结果数
        engine: 'auto', 'duckduckgo', 'bing'

    Returns:
        搜索结果列表
    """
    if engine == 'duckduckgo' or engine == 'auto':
        # 先尝试 Instant Answer API
        results = search_duckduckgo_instant(query, max_results)
        if results and 'error' not in results[0]:
            return results

        # 如果没结果或出错，尝试 HTML 搜索
        if not results or (results and 'error' in results[0]):
            html_results = search_duckduckgo_html(query, max_results)
            if html_results and 'error' not in html_results[0]:
                return html_results

    if engine == 'bing' or engine == 'auto':
        results = search_bing_rss(query, max_results)
        if results and 'error' not in results[0]:
            return results

    return results if results else [{'error': '所有搜索引擎均失败'}]


def format_results(results: list, verbose: bool = False) -> str:
    """格式化搜索结果为易读字符串"""
    if not results:
        return "未找到相关结果"

    if results and 'error' in results[0]:
        return f"搜索出错: {results[0]['error']}"

    lines = []
    for i, r in enumerate(results, 1):
        source = r.get('source', '')
        if verbose:
            lines.append(f"{i}. [{source}] {r['title']}")
            if r.get('url'):
                lines.append(f"   链接: {r['url']}")
            if r.get('description'):
                lines.append(f"   摘要: {r['description'][:100]}...")
            lines.append("")
        else:
            desc = r.get('description', '')
            if desc:
                lines.append(f"{i}. {r['title']} - {desc[:60]}...")
            else:
                lines.append(f"{i}. {r['title']}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description='网页搜索工具')
    parser.add_argument('query', nargs='?', help='搜索关键词')
    parser.add_argument('-n', '--max', type=int, default=10, help='最大结果数 (默认10)')
    parser.add_argument('-e', '--engine', choices=['auto', 'duckduckgo', 'bing'], default='auto', help='搜索引擎')
    parser.add_argument('-v', '--verbose', action='store_true', help='详细输出')
    parser.add_argument('--save', type=str, help='保存结果到文件(JSON格式)')

    args = parser.parse_args()

    if not args.query:
        print("请输入搜索关键词，例如: python search.py 天气")
        print("使用 --help 查看更多选项")
        return

    print(f"正在搜索: {args.query}", file=sys.stderr)

    results = search(args.query, max_results=args.max, engine=args.engine)

    if args.save:
        save_path = Path(args.save)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"结果已保存: {save_path}", file=sys.stderr)

    output = format_results(results, verbose=args.verbose)
    print(output)


if __name__ == '__main__':
    main()
