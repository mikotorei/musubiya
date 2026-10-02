"""担当のワークフロー（.github/workflows/worker.yml・worker-done.yml）から呼ぶ手順。

    python -m worker pick                       待ち行列から1件選び「作業中」にする（上限なら「案」に戻す）
    python -m worker finish --issue N ...       担当の変更を作業用の枝に push し、提案を出して「承認待ち」にする
    python -m worker fail --issue N ...         「案」に戻し、理由をコメントする
    python -m worker next                       待ちが残っていれば、次の実行を起動する
    python -m worker pr-closed                  担当の提案が閉じた時：反映なら Issue を閉じて「完了」、反映なしなら「案」に戻す

環境変数：GITHUB_TOKEN・GITHUB_REPOSITORY・GITHUB_SERVER_URL・GITHUB_RUN_ID（Actions が入れる）、GITHUB_OUTPUT。
pr-closed は GITHUB_EVENT_PATH（pull_request_target の closed のイベント）を読む。

担当（Claude Code）とのやりとりは .worker/ のファイルで行う（.gitignore 済み。提案には入らない）。
担当は書き込みのトークンを持たない別のジョブで動き、変更は .worker/changes.patch として受け取る。
worker/ は miko-hub と、担当を配ったリポジトリ（onceworld-alpha）で同じ中身に保つ。依存は worker/requirements.txt。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from . import rules
from .github import GitHub

WORK = Path(".worker")
ISSUE_FILE = WORK / "issue.md"  # 指示書の本文（pick が書き、担当が読む）
PR_BODY_FILE = WORK / "pr-body.md"  # 提案の説明（担当が書く）
CANNOT_FILE = WORK / "cannot-complete.md"  # 完了できない理由（担当が書く）
REASON_FILE = WORK / "reason.txt"  # finish が見つけた、提案を出せない理由（fail が読む）
PATCH_FILE = WORK / "changes.patch"  # 担当の変更（担当のジョブが作り、finish が読む）


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"環境変数 {name} がありません")
    return value


def run_url() -> str:
    return f"{env('GITHUB_SERVER_URL')}/{env('GITHUB_REPOSITORY')}/actions/runs/{env('GITHUB_RUN_ID')}"


def output(**values) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    lines = "".join(f"{key}={value}\n" for key, value in values.items())
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(lines)
    else:
        print(lines, end="")


def queue(gh: GitHub) -> tuple[list[rules.Candidate], list[int]]:
    """持ち主が書き、持ち主が「着手可」を付けた開いている Issue を、付いた順に並べる。

    持ち主が「着手可」を付けたが、書いたのが持ち主以外の Issue の番号は、2つ目の戻り値で返す（着手しない）。
    担当がもう一度挑戦するために付け直した「着手可」の Issue も、持ち主が付けた時の順番のまま並ぶ。
    """
    owner_id = gh.info()["owner"]["id"]
    candidates, others = [], []
    for issue in gh.ready_issues():
        events = gh.issue_events(issue["number"])
        labeled_at = rules.ready_labeled_at(events, owner_id)
        if labeled_at is None:
            continue
        if not rules.written_by_owner(issue, owner_id):
            others.append(issue["number"])
            continue
        attempts = rules.attempts_since(events, labeled_at)
        candidates.append(rules.Candidate(issue["number"], issue["title"], labeled_at, attempts))
    return rules.order_queue(candidates), others


def pick(gh: GitHub) -> int:
    now = datetime.now(timezone.utc)
    waiting, others = queue(gh)
    for number in others:
        gh.relabel(number, remove=[rules.READY], add=[rules.IDEA])
        gh.comment(number, rules.revert_comment(rules.not_owner_comment(), run_url()))
        print(f"#{number} を「案」に戻しました（持ち主以外が書いた指示書）")
    # 念のための安全網：既に上限まで挑戦した Issue は、作業せずに「案」に戻す
    for candidate in [c for c in waiting if c.attempts >= rules.MAX_ATTEMPTS]:
        gh.relabel(candidate.number, remove=[rules.READY], add=[rules.IDEA])
        gh.comment(
            candidate.number,
            rules.gave_up_comment(f"この指示書には既に{candidate.attempts}回挑戦しています。", run_url()),
        )
        print(f"#{candidate.number} を「案」に戻しました（挑戦の上限）")
    waiting = [c for c in waiting if c.attempts < rules.MAX_ATTEMPTS]
    if not waiting:
        print("着手可の指示書はありません")
        output(issue="")
        return 0

    started = rules.count_started_today(gh.repo_events_since(rules.day_start(now)), now)
    monthly = rules.monthly_limit(gh.info()["private"])
    minutes = gh.worker_minutes_since(rules.month_start(now)) if monthly is not None else None
    print(f"今日の着手：{started}件／今月の使用：{'数えない（公開リポジトリ）' if minutes is None else f'{minutes}分'}")
    shared_minutes, reserved = 0, 0
    if monthly is not None:
        # 月の上限を共有するワークフロー（例：miko-hub の整理）の使用と、その残りの実行のために確保する分
        for workflow_file in rules.shared_workflows(os.environ.get(rules.SHARED_WORKFLOWS_VARIABLE)):
            used = gh.workflow_minutes_since(rules.month_start(now), workflow_file)
            shared_minutes += used
            print(f"共有する {workflow_file} の今月の使用：{used}分")
        reserved, notice = rules.reserved_minutes(os.environ.get(rules.RESERVED_MINUTES_VARIABLE))
        if notice:
            print(f"::warning::{notice}")
        if reserved:
            print(f"共有するワークフローの残りの実行のために確保する分：{reserved}分")
    daily, notice = rules.daily_limit(os.environ.get(rules.DAILY_LIMIT_VARIABLE))
    if notice:
        print(f"::warning::{notice}")
    print(f"一日の上限：{daily}件")
    reason = rules.limit_reason(started, minutes, monthly, daily, shared_minutes, reserved)
    if reason:
        for candidate in waiting:
            gh.relabel(candidate.number, remove=[rules.READY], add=[rules.IDEA])
            gh.comment(candidate.number, rules.revert_comment(reason, run_url()))
            print(f"#{candidate.number} を「案」に戻しました（上限）")
        output(issue="")
        return 0

    chosen = waiting[0]
    gh.relabel(chosen.number, remove=[rules.READY], add=[rules.WORKING])
    WORK.mkdir(exist_ok=True)
    ISSUE_FILE.write_text(rules.issue_file(gh.issue(chosen.number)), encoding="utf-8")
    print(f"#{chosen.number} に着手します（{chosen.attempts + 1}回目の挑戦・待ち {len(waiting) - 1}件）")
    output(
        issue=chosen.number,
        branch=rules.branch_name(chosen.number, env("GITHUB_RUN_ID")),
        date=rules.today(now),
        started_at=int(time.time()),
    )
    return 0


def git(*args: str, cwd: str | None = None, token: str | None = None) -> str:
    """git を動かす。token は push のときだけ、環境変数の設定として渡す（引数やファイルには残さない）。"""
    env_vars = None
    if token:
        basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        env_vars = {
            **os.environ,
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": f"http.{env('GITHUB_SERVER_URL')}/.extraheader",
            "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {basic}",
        }
    result = subprocess.run(
        ["git", "-c", "core.quotepath=false", *args], capture_output=True, text=True, encoding="utf-8", cwd=cwd, env=env_vars
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {args[0]} が失敗しました：{result.stderr.strip()[:500]}")
    return result.stdout


def changed_paths(cwd: str) -> list[str]:
    paths = []
    for line in git("status", "--porcelain", "-uall", cwd=cwd).splitlines():
        path = line[3:]
        paths.append(path.split(" -> ", 1)[-1])
    return paths


def finish(gh: GitHub, number: int, branch: str, base: str) -> int:
    def refuse(reason: str) -> int:
        """思わぬ形で提案を出せない時。実行を「失敗」にする（fail が「案」に戻すか、もう一度挑戦するかを決める）。"""
        WORK.mkdir(exist_ok=True)
        REASON_FILE.write_text(reason, encoding="utf-8")
        print(reason, file=sys.stderr)
        return 1

    def stop(reason: str) -> int:
        """予定どおりに止まった時（担当が完了できないと判断・変更が無い・日誌が無い・ワークフローの変更を含む）。

        実行は「成功」で終え、stopped の印を出す。印があれば fail の手順が動く。
        fail が読むもの（理由のファイル・完了できない理由のファイル）は refuse と同じなので、
        「案」に戻すか、もう一度挑戦するかの決まりは変わらない。変わるのは実行の結果の色だけ。
        """
        WORK.mkdir(exist_ok=True)
        REASON_FILE.write_text(reason, encoding="utf-8")
        output(stopped="true")
        print(f"予定どおり止まりました：{reason}")
        return 0

    if CANNOT_FILE.exists():
        return stop("担当が完了できないと判断しました：" + rules.shorten(CANNOT_FILE.read_text(encoding="utf-8").strip()))
    if not PATCH_FILE.exists():
        return refuse("担当の変更を受け取れませんでした。実行ページで確かめてください。")
    if not rules.is_work_branch(branch):
        return refuse(f"作業用の枝ではない（{branch}）ため push しません。担当は main に直接反映しません。")

    # 担当の変更は、このジョブが動かしているプログラム（main の worker/）とは別の作業場所に当てる。
    # 変更がこのジョブの後の手順（fail・next）に混ざらないようにするため
    place = tempfile.mkdtemp(prefix="worker-proposal-")
    git("worktree", "add", "--detach", place, base)
    patch = str(PATCH_FILE.resolve())
    if PATCH_FILE.stat().st_size:
        git("apply", "--index", "--binary", patch, cwd=place)
    problem = rules.check_changes(changed_paths(place))
    if problem:
        return stop(problem)

    title = gh.issue(number)["title"]
    git("config", "user.name", rules.BOT_LOGIN, cwd=place)
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com", cwd=place)
    git("add", "-A", cwd=place)
    git("commit", "-q", "-m", f"{title}（#{number}）", cwd=place)
    git("push", "-q", "origin", f"HEAD:refs/heads/{branch}", cwd=place, token=env("GITHUB_TOKEN"))

    claude_body = PR_BODY_FILE.read_text(encoding="utf-8") if PR_BODY_FILE.exists() else None
    url = gh.create_pull(title, branch, "main", rules.pr_body(claude_body, number, run_url()))
    gh.relabel(number, remove=[rules.WORKING], add=[rules.REVIEW])
    print(f"提案を出しました：{url}")
    return 0


def fail(gh: GitHub, number: int, claude_outcome: str, started_at: str) -> int:
    elapsed = time.time() - int(started_at) if started_at.isdigit() else None
    facts = dict(
        finish_reason=REASON_FILE.read_text(encoding="utf-8") if REASON_FILE.exists() else None,
        cannot_complete=CANNOT_FILE.read_text(encoding="utf-8") if CANNOT_FILE.exists() else None,
        claude_outcome=claude_outcome,
        elapsed_seconds=elapsed,
    )
    reason = rules.failure_reason(**facts)
    kind = rules.failure_kind(**facts)
    events = gh.issue_events(number)
    ready_at = rules.ready_labeled_at(events, gh.info()["owner"]["id"])
    attempts = rules.attempts_since(events, ready_at) if ready_at else rules.MAX_ATTEMPTS
    if rules.retry_after_failure(kind, attempts):
        # 担当が「着手可」を付け直す。持ち主の判定では数えないので、順番と挑戦の数え方は持ち主が付けた時のまま
        gh.relabel(number, remove=[rules.WORKING], add=[rules.READY])
        gh.comment(number, rules.retry_comment(reason, attempts, run_url()))
        print(f"#{number} は{attempts}回目の挑戦が失敗したため、もう一度挑戦します：{reason}")
        return 0
    gh.relabel(number, remove=[rules.WORKING, rules.READY], add=[rules.IDEA])
    if attempts >= rules.MAX_ATTEMPTS:
        gh.comment(number, rules.gave_up_comment(reason, run_url()))
    else:
        gh.comment(number, rules.revert_comment(reason, run_url()))
    print(f"#{number} を「案」に戻しました（{attempts}回目・{kind}）：{reason}")
    return 0


def next_run(gh: GitHub) -> int:
    waiting, _ = queue(gh)
    if waiting:
        gh.dispatch_worker()
        print(f"待ちが {len(waiting)}件あるため、次の実行を起動しました")
    else:
        print("待ちはありません")
    return 0


def pr_closed(gh: GitHub, event: dict) -> int:
    """担当の提案が閉じた時。本文の「Closes #番号」が効かなくても、枝の名前から Issue を決めて片づける。

    反映された：Issue が開いていれば「完了」の扱いで閉じ、「承認待ち」→「完了」。
    反映されずに閉じた：「承認待ち」→「案」に戻し、その旨をコメントする。
    「承認待ち」が付いていない Issue（手で片づけ済み・本文の「Closes」で閉じて付け替え済み）には触らない。
    """
    repository = event["repository"]
    proposal = rules.closed_proposal(event["pull_request"], repository["full_name"], repository["default_branch"])
    if proposal is None:
        print("担当の提案ではないため、何もしません")
        return 0
    issue = gh.issue(proposal.issue)
    labels = {label["name"] for label in issue["labels"]}
    if rules.REVIEW not in labels:
        print(f"#{proposal.issue} に「{rules.REVIEW}」が無いため、何もしません")
        return 0
    if proposal.merged:
        if issue["state"] == "open":
            gh.close_issue(proposal.issue)
        gh.relabel(proposal.issue, remove=[rules.REVIEW], add=[rules.DONE])
        print(f"提案 #{proposal.pull} が反映されたため、#{proposal.issue} を閉じて「{rules.DONE}」にしました")
    else:
        gh.relabel(proposal.issue, remove=[rules.REVIEW], add=[rules.IDEA])
        gh.comment(proposal.issue, rules.not_merged_comment(proposal.pull, proposal.url))
        print(f"提案 #{proposal.pull} が反映されずに閉じられたため、#{proposal.issue} を「{rules.IDEA}」に戻しました")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="python -m worker")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("pick")
    p_finish = sub.add_parser("finish")
    p_finish.add_argument("--issue", type=int, required=True)
    p_finish.add_argument("--branch", required=True)
    p_finish.add_argument("--base", required=True)  # 担当が作業を始めたコミット
    p_fail = sub.add_parser("fail")
    p_fail.add_argument("--issue", type=int, required=True)
    p_fail.add_argument("--claude-outcome", default="")
    p_fail.add_argument("--started-at", default="")
    sub.add_parser("next")
    sub.add_parser("pr-closed")
    args = parser.parse_args(argv)

    gh = GitHub(env("GITHUB_REPOSITORY"), env("GITHUB_TOKEN"))
    try:
        if args.command == "pick":
            return pick(gh)
        if args.command == "finish":
            return finish(gh, args.issue, args.branch, args.base)
        if args.command == "fail":
            return fail(gh, args.issue, args.claude_outcome, args.started_at)
        if args.command == "pr-closed":
            with open(env("GITHUB_EVENT_PATH"), encoding="utf-8") as f:
                return pr_closed(gh, json.load(f))
        return next_run(gh)
    except RuntimeError as e:
        if args.command == "finish":
            WORK.mkdir(exist_ok=True)
            REASON_FILE.write_text(f"提案を出す途中で失敗しました：{e}", encoding="utf-8")
        print(e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
