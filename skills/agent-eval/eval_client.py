#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent 评测系统客户端 CLI (eval_client.py)
专供 Claude Code、Cursor 等编码 Agent 使用的纯 Python 3 原生客户端（无外部第三方依赖）。
支持评测任务发现、拉起评测、进度自动轮询与 Bad Case 诊断报告输出，助力 Prompt 自优化循环。
"""

import sys
import os
import json
import time
import argparse
import urllib.request
import urllib.error

# 默认配置
DEFAULT_BASE_URL = os.environ.get("EVAL_BASE_URL", "http://localhost:8080").rstrip("/")
API_KEY = os.environ.get("EVAL_API_KEY", "")

def make_request(path: str, method: str = "GET", data: dict = None, base_url: str = None) -> dict:
    url = f"{base_url or DEFAULT_BASE_URL}{path}"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if API_KEY:
        headers["X-API-Key"] = API_KEY

    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content)
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_msg)
            print(f"[错误] HTTP {e.code}: {err_json.get('message', err_msg)}", file=sys.stderr)
        except Exception:
            print(f"[错误] HTTP {e.code}: {err_msg}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[错误] 无法连接到评测系统 ({url}): {e}", file=sys.stderr)
        sys.exit(1)

def cmd_list_tasks(args):
    """列出系统中所有已配置的评测任务"""
    res = make_request("/api/v1/openapi/tasks", base_url=args.base_url)
    tasks = res.get("data", [])
    if not tasks:
        print("评测系统中暂无已配置的任务。请先在控制台创建任务。")
        return

    print("=" * 80)
    print(f"{'Task ID':<8} | {'任务名称':<22} | {'场景':<16} | {'用例数':<8} | {'最近一次运行状态'}")
    print("-" * 80)
    for t in tasks:
        lr = t.get("latest_run")
        status_str = "未执行"
        if lr:
            pass_rate = lr.get("pass_rate", "0%")
            score = lr.get("machine_avg_score", 0.0)
            status_str = f"{lr.get('status')} (通过率:{pass_rate}, 均分:{score:.1f})"
        
        name = t.get("name", "")[:20]
        sc_name = (t.get("scenario_name") or "-")[:14]
        cases_count = t.get("total_cases", 0)
        print(f"#{t['id']:<7} | {name:<22} | {sc_name:<16} | {cases_count:<8} | {status_str}")
    print("=" * 80)
    print("\n💡 提示: 使用 `run --task <id> --wait` 可快速拉起评测并获取诊断报告。")

def cmd_trigger(args):
    """拉起评测任务并支持等待结果"""
    task_id = args.task
    payload = {
        "case_limit": args.limit,
        "failed_only": args.failed_only,
    }
    if args.cases:
        try:
            payload["case_ids"] = [int(x.strip()) for x in args.cases.split(",") if x.strip()]
        except ValueError:
            print("[错误] --cases 参数格式错误，应为逗号分隔的数字ID，如 --cases 1,2,3", file=sys.stderr)
            sys.exit(1)

    res = make_request(f"/api/v1/openapi/tasks/{task_id}/trigger", method="POST", data=payload, base_url=args.base_url)
    data = res.get("data", {})
    run_id = data.get("run_id")

    if run_id == 0 or data.get("status") == "ALL_PASSED":
        print(f"\n✨ {res.get('message', '所有用例均已通过，无需复测！')}\n")
        return

    task_name = data.get("task_name", f"Task #{task_id}")
    expected_cases = data.get("expected_cases", 0)
    mode_text = "仅重测上次失败项" if args.failed_only else ("指定用例" if args.cases else "全量/抽样")

    print(f"\n🚀 评测任务已启动: [{task_name}] (模式: {mode_text}, 预计执行 {expected_cases} 条用例)")
    print(f"📌 运行记录编号: Run #{run_id}")

    if not args.wait:
        print(f"👉 任务正在后台并发执行中。您可以随后运行以下命令查看进度与结果:")
        print(f"   python3 eval_client.py status --run {run_id}")
        print(f"   python3 eval_client.py summary --run {run_id}\n")
        return

    # 等待模式：自动轮询进度直到完成
    print("\n⏳ 正在自动轮询评测进度，请稍候...")
    start_time = time.time()
    last_completed = -1

    while True:
        status_res = make_request(f"/api/v1/openapi/runs/{run_id}/status", base_url=args.base_url)
        s_data = status_res.get("data", {})
        status = s_data.get("status")
        total = s_data.get("total_count", 0)
        completed = s_data.get("completed_count", 0)
        percent = s_data.get("progress_percent", "0%")
        is_finished = s_data.get("is_finished", False)

        if completed != last_completed or is_finished:
            bar_len = 25
            fill_len = int(bar_len * (completed / total)) if total > 0 else 0
            bar = "█" * fill_len + "░" * (bar_len - fill_len)
            print(f"\r进度: [{bar}] {percent} ({completed}/{total}) 状态: {status} ", end="", flush=True)
            last_completed = completed

        if is_finished:
            print("\n")
            break

        time.sleep(1.0)
        if time.time() - start_time > args.timeout:
            print(f"\n[超时] 评测任务耗时超过 {args.timeout} 秒未全部完成，请手动运行 summary 检查。", file=sys.stderr)
            sys.exit(1)

    # 打印最终 Markdown 诊断结果
    print("=" * 80)
    print("📋 评测完成，生成诊断报告:")
    print("=" * 80 + "\n")
    summary_res = make_request(f"/api/v1/openapi/runs/{run_id}/summary", base_url=args.base_url)
    sum_data = summary_res.get("data", {})
    md_report = sum_data.get("markdown_report", "")
    print(md_report)

def cmd_status(args):
    """单次查询进度"""
    res = make_request(f"/api/v1/openapi/runs/{args.run}/status", base_url=args.base_url)
    d = res.get("data", {})
    print(f"Run #{d.get('run_id')} 状态: {d.get('status')}")
    print(f"总用例: {d.get('total_count')}, 已完成: {d.get('completed_count')} (进度: {d.get('progress_percent')})")
    print(f"是否结束: {d.get('is_finished')}, 耗时: {d.get('latency_ms')}ms")

def cmd_summary(args):
    """获取详细诊断结果与报告"""
    res = make_request(f"/api/v1/openapi/runs/{args.run}/summary", base_url=args.base_url)
    d = res.get("data", {})
    if args.json:
        print(json.dumps(d, ensure_ascii=False, indent=2))
    else:
        print(d.get("markdown_report", ""))

def main():
    parser = argparse.ArgumentParser(description="Agent 评测系统 CLI 客户端 (面向 Prompt 自优化工具链)")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"评测服务基础地址 (默认: {DEFAULT_BASE_URL})")
    subparsers = parser.add_subparsers(dest="subcommand", help="子命令")

    # list
    sub_list = subparsers.add_parser("list", help="列出系统中所有配置好的评测任务")
    sub_list.set_defaults(func=cmd_list_tasks)

    # run
    sub_run = subparsers.add_parser("run", help="拉起指定评测任务")
    sub_run.add_argument("--task", required=True, type=int, help="要执行的评测任务 ID (可通过 list 命令查看)")
    sub_run.add_argument("--wait", action="store_true", help="阻塞自动轮询进度直到完成并直接打印报告")
    sub_run.add_argument("--failed-only", action="store_true", help="仅重跑上次运行失败/未通过的用例 (极大加速自优化循环)")
    sub_run.add_argument("--limit", type=int, default=0, help="限制本次执行用例数量进行快速抽样 (0为不限)")
    sub_run.add_argument("--cases", type=str, default="", help="指定用例 ID 列表，逗号分隔 (如: 101,102)")
    sub_run.add_argument("--timeout", type=int, default=300, help="等待超时时间(秒，默认300)")
    sub_run.set_defaults(func=cmd_trigger)

    # status
    sub_status = subparsers.add_parser("status", help="查询某次评测运行进度")
    sub_status.add_argument("--run", required=True, type=int, help="运行记录 ID (Run ID)")
    sub_status.set_defaults(func=cmd_status)

    # summary
    sub_sum = subparsers.add_parser("summary", help="获取评测诊断报告与 Bad Case 归因明细")
    sub_sum.add_argument("--run", required=True, type=int, help="运行记录 ID (Run ID)")
    sub_sum.add_argument("--json", action="store_true", help="以原始 JSON 格式输出")
    sub_sum.set_defaults(func=cmd_summary)

    args = parser.parse_args()
    if not args.subcommand:
        parser.print_help()
        sys.exit(0)

    args.func(args)

if __name__ == "__main__":
    main()
