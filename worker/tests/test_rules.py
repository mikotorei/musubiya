import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from worker import rules

ROOT = Path(__file__).resolve().parents[2]
OWNER = 262788924
BOT = {"login": "github-actions[bot]", "id": 41898282}


def utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def labeled(name, at, actor):
    return {"event": "labeled", "label": {"name": name}, "created_at": at, "actor": actor}


# 日付（日本時間）

def test_日本時間の0時で日が変わる():
    now = utc("2026-09-29T14:59:00")  # 日本時間 23:59
    assert rules.today(now) == "2026-09-29"
    assert rules.day_start(now) == utc("2026-09-28T15:00:00")
    assert rules.today(utc("2026-09-29T15:00:00")) == "2026-09-30"


def test_月の始まりは日本時間の1日0時():
    assert rules.month_start(utc("2026-09-30T16:00:00")) == utc("2026-09-30T15:00:00")  # 日本時間 10/1 1:00
    assert rules.month_start(utc("2026-09-15T00:00:00")) == utc("2026-08-31T15:00:00")


# 持ち主の判定と順番

def test_最後に着手可を付けたのが持ち主なら着手する():
    events = [labeled("着手可", "2026-09-29T01:00:00Z", {"id": OWNER})]
    assert rules.ready_labeled_at(events, OWNER) == utc("2026-09-29T01:00:00")


def test_持ち主以外が付けたら着手しない():
    events = [labeled("着手可", "2026-09-29T01:00:00Z", {"id": 999})]
    assert rules.ready_labeled_at(events, OWNER) is None


def test_最後に付けた人で決める():
    events = [
        labeled("着手可", "2026-09-29T01:00:00Z", {"id": OWNER}),
        {"event": "unlabeled", "label": {"name": "着手可"}, "created_at": "2026-09-29T02:00:00Z", "actor": {"id": OWNER}},
        labeled("着手可", "2026-09-29T03:00:00Z", {"id": 999}),
    ]
    assert rules.ready_labeled_at(events, OWNER) is None


def test_担当が付け直した着手可は持ち主の判定に数えない():
    events = [
        labeled("着手可", "2026-10-01T01:00:00Z", {"id": OWNER, "login": "mikotorei"}),
        labeled("作業中", "2026-10-01T01:01:00Z", BOT),
        labeled("着手可", "2026-10-01T01:10:00Z", BOT),  # 1回目の失敗の後、担当がもう一度挑戦するため
    ]
    assert rules.ready_labeled_at(events, OWNER) == utc("2026-10-01T01:00:00")
    # 持ち主以外の人が最後に付けたなら、担当の付け直しがあっても着手しない
    events.append(labeled("着手可", "2026-10-01T01:20:00Z", {"id": 999, "login": "someone"}))
    assert rules.ready_labeled_at(events, OWNER) is None
    # 担当が付けただけで、持ち主が一度も付けていなければ着手しない
    assert rules.ready_labeled_at([labeled("着手可", "2026-10-01T01:00:00Z", BOT)], OWNER) is None


def test_挑戦の回数は持ち主が付けてから担当が作業中を付けた回数():
    owner = {"id": OWNER, "login": "mikotorei"}
    events = [
        labeled("着手可", "2026-10-01T00:00:00Z", owner),
        labeled("作業中", "2026-10-01T00:01:00Z", BOT),
        labeled("着手可", "2026-10-01T00:10:00Z", BOT),
        labeled("作業中", "2026-10-01T00:11:00Z", BOT),
        labeled("作業中", "2026-10-01T00:12:00Z", owner),  # 手で付けたものは数えない
    ]
    ready = rules.ready_labeled_at(events, OWNER)
    assert rules.attempts_since(events, ready) == 2
    # 持ち主が付け直すと数え直し
    events.append(labeled("着手可", "2026-10-01T02:00:00Z", owner))
    ready = rules.ready_labeled_at(events, OWNER)
    assert rules.attempts_since(events, ready) == 0
    events.append(labeled("作業中", "2026-10-01T02:01:00Z", BOT))
    assert rules.attempts_since(events, ready) == 1


def test_失敗の種類と_もう一度挑戦するか():
    base = dict(finish_reason=None, cannot_complete=None, claude_outcome="success", elapsed_seconds=60)
    assert rules.failure_kind(**{**base, "cannot_complete": "指示が曖昧"}) == "cannot"
    assert rules.failure_kind(**{**base, "finish_reason": "担当が完了できないと判断しました：x", "cannot_complete": "x"}) == "cannot"
    assert rules.failure_kind(**{**base, "claude_outcome": "failure", "elapsed_seconds": 39 * 60 + 5}) == "timeout"
    assert rules.failure_kind(**{**base, "claude_outcome": "failure"}) == "other"
    assert rules.failure_kind(**{**base, "finish_reason": "作業日誌（journal/<日付>.md）がありませんでした。"}) == "other"
    assert rules.failure_kind(**{**base, "cannot_complete": "  \n"}) == "other"
    # 1回目の other だけもう一度挑戦する。完了できない判断と時間切れは、1回目でも止める
    assert rules.retry_after_failure("other", 1)
    assert not rules.retry_after_failure("other", 2)
    assert not rules.retry_after_failure("cannot", 1)
    assert not rules.retry_after_failure("timeout", 1)


def test_再挑戦と停止のコメント():
    retry = rules.retry_comment("理由の文", 1, "https://example.com/run")
    assert retry.startswith("1回目の挑戦が失敗したので、もう一度挑戦します") and "2回まで" in retry
    assert "理由：理由の文" in retry and "https://example.com/run" in retry
    stop = rules.gave_up_comment("理由の文", "https://example.com/run")
    assert stop.startswith("2回失敗したので止めました。「案」に戻しました。")
    assert "付け直すと、数え直して" in stop and "理由：理由の文" in stop


def test_ほかのラベルや着手可が無ければ着手しない():
    assert rules.ready_labeled_at([labeled("案", "2026-09-29T01:00:00Z", {"id": OWNER})], OWNER) is None
    assert rules.ready_labeled_at([], OWNER) is None


def test_持ち主が書いた指示書だけ着手する():
    assert rules.written_by_owner({"user": {"id": OWNER}}, OWNER)
    assert not rules.written_by_owner({"user": {"id": 999}}, OWNER)
    assert not rules.written_by_owner({}, OWNER)
    assert "立て直して" in rules.not_owner_comment()


def test_担当に渡す指示書はタイトルと本文だけ():
    issue = {"title": "題", "body": "本文", "comments": 3, "comments_url": "https://example.com/c"}
    assert rules.issue_file(issue) == "# 題\n\n本文\n"
    assert rules.issue_file({"title": "題だけ", "body": None}) == "# 題だけ\n\n\n"


def test_着手可が付いた順_同時なら番号順():
    a = rules.Candidate(5, "a", utc("2026-09-29T02:00:00"))
    b = rules.Candidate(9, "b", utc("2026-09-29T01:00:00"))
    c = rules.Candidate(3, "c", utc("2026-09-29T02:00:00"))
    assert [x.number for x in rules.order_queue([a, b, c])] == [9, 3, 5]


# 上限

def test_今日の着手は担当が作業中を付けた回数():
    now = utc("2026-09-29T10:00:00")  # 日本時間 19:00
    events = [
        labeled("作業中", "2026-09-29T09:00:00Z", BOT),
        labeled("作業中", "2026-09-28T15:00:00Z", BOT),  # 日本時間 0:00 ちょうど（今日）
        labeled("作業中", "2026-09-28T14:59:59Z", BOT),  # 昨日
        labeled("作業中", "2026-09-29T09:30:00Z", {"login": "mikotorei", "id": OWNER}),  # 手で付けた
        labeled("承認待ち", "2026-09-29T09:40:00Z", BOT),
    ]
    assert rules.count_started_today(events, now) == 2


def test_ジョブの時間は分単位で切り上げ_終わっていないものは数えない():
    jobs = [
        {"started_at": "2026-09-29T01:00:00Z", "completed_at": "2026-09-29T01:00:30Z"},  # 1分
        {"started_at": "2026-09-29T02:00:00Z", "completed_at": "2026-09-29T02:20:01Z"},  # 21分
        {"started_at": "2026-09-29T03:00:00Z", "completed_at": None},
        {"started_at": None, "completed_at": None},
    ]
    assert rules.job_minutes(jobs) == 22


def test_上限の判定():
    assert rules.limit_reason(19, 899) is None  # 既定は1日20件
    assert "上限（20件）" in rules.limit_reason(20, 0)
    assert "上限（900分）" in rules.limit_reason(0, 900)
    assert "900分" in rules.limit_reason(20, 950)  # 両方なら月の上限を先に伝える
    assert rules.limit_reason(4, 0, daily=5) is None
    assert "上限（5件）" in rules.limit_reason(5, 0, daily=5)


def test_設定値が0なら着手しない_止めるスイッチ():
    reason = rules.limit_reason(0, 0, daily=0)
    assert "0 のため、着手しません" in reason and "止めるスイッチ" in reason
    assert "WORKER_DAILY_LIMIT" in reason


def test_一日の上限はリポジトリの設定値から読む():
    assert rules.DAILY_LIMIT_VARIABLE == "WORKER_DAILY_LIMIT"
    assert rules.daily_limit(None) == (20, None)  # 設定が無い
    assert rules.daily_limit("") == (20, None)
    assert rules.daily_limit("  ") == (20, None)
    assert rules.daily_limit("5") == (5, None)
    assert rules.daily_limit(" 30 ") == (30, None)
    assert rules.daily_limit("0") == (0, None)  # 止めるスイッチ
    for bad in ("abc", "-1", "2.5", "１０件"):
        value, notice = rules.daily_limit(bad)
        assert value == 20 and "0以上の整数ではない" in notice


def test_月の上限は非公開リポジトリだけ():
    assert rules.monthly_limit(private=True) == 900
    assert rules.monthly_limit(private=False) is None
    assert rules.limit_reason(0, None, None) is None
    assert rules.limit_reason(2, 5000, None) is None
    assert "上限（20件）" in rules.limit_reason(20, None, None)  # 1日の上限は公開でも効く


# 提案を出せるか

def test_変更と作業日誌があれば出せる():
    assert rules.check_changes(["journal/2026-09-29.md", "CLAUDE.md"]) is None


def test_変更が無い_日誌が無い_ワークフローを変えたなら出さない():
    assert rules.check_changes([]) == "変更がありませんでした。"
    assert "作業日誌" in rules.check_changes(["CLAUDE.md"])
    assert "作業日誌" in rules.check_changes(["journal/memo.txt", "CLAUDE.md"])
    assert "ワークフロー" in rules.check_changes([".github/workflows/monitor.yml", "journal/2026-09-29.md"])


# 失敗の理由

def test_理由は分かっているものを優先する():
    base = dict(finish_reason=None, cannot_complete=None, claude_outcome="success", elapsed_seconds=10)
    assert rules.failure_reason(**{**base, "finish_reason": "作業日誌がありませんでした。"}) == "作業日誌がありませんでした。"
    assert rules.failure_reason(**{**base, "cannot_complete": " 指示が曖昧 \n"}) == "担当が完了できないと判断しました：指示が曖昧"


def test_40分近くで止まったら時間切れ():
    reason = rules.failure_reason(finish_reason=None, cannot_complete=None, claude_outcome="failure", elapsed_seconds=39 * 60 + 5)
    assert "上限（40分）" in reason and "分けて出し直して" in reason


def test_早く失敗したら実行の失敗():
    reason = rules.failure_reason(finish_reason=None, cannot_complete=None, claude_outcome="failure", elapsed_seconds=60)
    assert "途中で失敗" in reason
    assert "止まりました" in rules.failure_reason(finish_reason=None, cannot_complete=None, claude_outcome="", elapsed_seconds=None)


def test_長い理由は切り詰める():
    assert rules.shorten("あ" * 1200).endswith("…（以下略）")
    assert len(rules.shorten("あ" * 1200)) == 1000 + len("…（以下略）")


def test_案に戻すコメント():
    assert rules.revert_comment("理由の文", "https://example.com/run") == "「案」に戻しました。\n\n理由：理由の文\n\n実行ページ：https://example.com/run"


# 枝と提案

def test_作業用の枝の名前と_mainにはpushしない():
    assert rules.branch_name(12, "345") == "claude/issue-12-345"
    assert rules.is_work_branch("claude/issue-12-345")
    assert not rules.is_work_branch("main")
    assert not rules.is_work_branch("feature/x")


def test_提案にはIssueを閉じる記述を入れる():
    body = rules.pr_body("変更の説明", 7, "https://example.com/run")
    assert body.startswith("変更の説明")
    assert "\nCloses #7\n" in body
    assert "https://example.com/run" in body
    assert "説明を書きませんでした" in rules.pr_body("  ", 7, "u")


# ワークフローとの整合

def test_ラベルの名前はlabels_pyと同じ():
    if not (ROOT / "templates" / "labels.py").exists():
        pytest.skip("labels.py は miko-hub にだけある")
    sys.path.insert(0, str(ROOT / "templates"))
    import labels

    names = {label["name"] for label in labels.LABELS}
    assert {rules.IDEA, rules.READY, rules.WORKING, rules.REVIEW, rules.DONE} == names


def test_作業時間の上限はワークフローと同じ():
    text = (ROOT / ".github/workflows/worker.yml").read_text(encoding="utf-8")
    assert f"timeout-minutes: {rules.WORK_MINUTES}  # 作業時間の上限" in text


def workflow():
    return yaml.safe_load((ROOT / ".github/workflows/worker.yml").read_text(encoding="utf-8"))


def test_担当が動くジョブは読み取りのトークンだけ():
    jobs = workflow()["jobs"]
    assert jobs["work"]["permissions"] == {"contents": "read"}
    assert "env" not in jobs["work"]
    uses_claude = [s for s in jobs["work"]["steps"] if "claude-code-action" in s.get("uses", "")]
    assert len(uses_claude) == 1
    # ほかのジョブでは担当を動かさない
    for name in ("pick", "finish"):
        assert not any("claude-code-action" in s.get("uses", "") for s in jobs[name]["steps"])


def test_checkoutは資格情報を残さない():
    for job in workflow()["jobs"].values():
        for step in job["steps"]:
            if step.get("uses", "").startswith("actions/checkout@"):
                assert step["with"]["persist-credentials"] is False


def test_担当には指示書のファイルだけを読ませ_GitHubの読み取り道具を渡さない():
    step = next(s for s in workflow()["jobs"]["work"]["steps"] if "claude-code-action" in s.get("uses", ""))
    assert "コメントは読まず" in step["with"]["prompt"]
    args = step["with"]["claude_args"]
    assert "mcp__github" not in args and "Bash(gh" not in args
    assert "WebFetch" in args.split("--disallowedTools", 1)[1]


# 提案が閉じた時

def pull(ref="claude/issue-2-36729498995", repo="mikotorei/example", base="main", merged=True):
    return {
        "number": 3,
        "html_url": "https://github.com/mikotorei/example/pull/3",
        "merged": merged,
        "head": {"ref": ref, "repo": {"full_name": repo}},
        "base": {"ref": base},
    }


def test_枝の名前からIssue番号を取る():
    assert rules.issue_from_branch("claude/issue-2-36729498995") == 2
    assert rules.issue_from_branch(rules.branch_name(15, "7")) == 15
    for ref in ("main", "claude/issue-x-1", "claude/issue-2", "feature/claude/issue-2-1", "claude/issue-2-1/extra", ""):
        assert rules.issue_from_branch(ref) is None


def test_担当の提案だけを片づける():
    got = rules.closed_proposal(pull(), "mikotorei/example", "main")
    assert got == rules.ClosedProposal(2, 3, "https://github.com/mikotorei/example/pull/3", True)
    assert rules.closed_proposal(pull(merged=False), "mikotorei/example", "main").merged is False
    assert rules.closed_proposal(pull(repo="someone/fork"), "mikotorei/example", "main") is None  # よそのリポジトリから
    assert rules.closed_proposal(pull(base="dev"), "mikotorei/example", "main") is None  # 既定の枝以外へ
    assert rules.closed_proposal(pull(ref="ccr-abc"), "mikotorei/example", "main") is None  # 担当の枝ではない
    assert rules.closed_proposal({"number": 1, "head": {"ref": "claude/issue-2-1", "repo": None}, "base": {"ref": "main"}}, "mikotorei/example", "main") is None


def test_反映されずに閉じた時のコメント():
    text = rules.not_merged_comment(3, "https://github.com/mikotorei/example/pull/3")
    assert "提案 #3 が反映されずに閉じられた" in text and "「案」に戻しました" in text
    assert "https://github.com/mikotorei/example/pull/3" in text


def done_workflow():
    return yaml.safe_load((ROOT / ".github/workflows/worker-done.yml").read_text(encoding="utf-8"))


def test_完了のワークフローは既定の枝のプログラムで動く():
    wf = done_workflow()
    on = wf.get("on", wf.get(True))  # YAML 1.1 では on が True になる
    assert on["pull_request_target"]["types"] == ["closed"]
    assert "pull_request" not in on  # 提案の枝のワークフローで動かさない
    job = wf["jobs"]["proposal"]
    assert job["permissions"] == {"contents": "read", "issues": "write"}
    assert "head.repo.full_name == github.repository" in job["if"]
    checkout = job["steps"][0]
    assert checkout["with"]["ref"] == "${{ github.event.repository.default_branch }}"
    assert checkout["with"]["persist-credentials"] is False
    assert any(s.get("run") == "python -m worker pr-closed" for s in job["steps"])


def test_一日の上限の設定値をpickに渡す():
    step = next(s for s in workflow()["jobs"]["pick"]["steps"] if s.get("run") == "python -m worker pick")
    assert step["env"][rules.DAILY_LIMIT_VARIABLE] == "${{ vars.WORKER_DAILY_LIMIT }}"


def test_予定どおりの停止でもfailの手順が動く():
    step = next(s for s in workflow()["jobs"]["finish"]["steps"] if str(s.get("run", "")).startswith("python -m worker fail"))
    condition = " ".join(step["if"].split())
    assert "steps.finish.outputs.stopped == 'true'" in condition
    assert "needs.work.result != 'success'" in condition and "steps.finish.outcome != 'success'" in condition


def test_月の上限を共有するワークフローと確保する分の設定():
    assert rules.shared_workflows(None) == [] and rules.shared_workflows(" a.yml, ,b.yml ") == ["a.yml", "b.yml"]
    assert rules.reserved_minutes(None) == (0, None) and rules.reserved_minutes(" 250 ") == (250, None)
    value, notice = rules.reserved_minutes("-5")
    assert value == 0 and "WORKER_RESERVED_MINUTES" in notice
    assert rules.limit_reason(0, 600, shared_minutes=100, reserved=199) is None
    reason = rules.limit_reason(0, 600, shared_minutes=100, reserved=200)
    assert "上限（900分" in reason and "担当 600分" in reason and "200分" in reason
    assert rules.limit_reason(0, 5000, None, shared_minutes=100, reserved=200) is None  # 公開は見ない
