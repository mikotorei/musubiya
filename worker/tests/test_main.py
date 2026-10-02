"""待ち行列の選び方（連鎖して次の実行を起動する時も同じ関数を通る）。GitHub の代わりに偽物を使う。"""

from worker import __main__ as main

OWNER = 262788924


def labeled(name, at, actor_id):
    return {"event": "labeled", "label": {"name": name}, "created_at": at, "actor": {"id": actor_id}}


class FakeGitHub:
    def __init__(self, issues, events, private=False):
        self.issues = issues
        self.events = events
        self.private = private
        self.relabeled = []
        self.comments = []
        self.dispatched = 0

    def info(self):
        return {"owner": {"id": OWNER}, "private": self.private}

    def ready_issues(self):
        return self.issues

    def issue_events(self, number):
        return self.events[number]

    def issue(self, number):
        return next(i for i in self.issues if i["number"] == number)

    def relabel(self, number, remove, add):
        self.relabeled.append((number, tuple(remove), tuple(add)))

    def comment(self, number, body):
        self.comments.append((number, body))

    def repo_events_since(self, since):
        return []

    def worker_minutes_since(self, since):
        raise AssertionError("公開リポジトリでは使用時間を数えない")

    def dispatch_worker(self):
        self.dispatched += 1


def issue(number, author):
    return {"number": number, "title": f"題{number}", "body": "本文", "user": {"id": author}}


def fake():
    return FakeGitHub(
        issues=[issue(1, OWNER), issue(2, 999), issue(3, OWNER), issue(4, 999)],
        events={
            1: [labeled("着手可", "2026-09-30T02:00:00Z", OWNER)],
            2: [labeled("着手可", "2026-09-30T01:00:00Z", OWNER)],  # 持ち主以外が書いた
            3: [labeled("着手可", "2026-09-30T01:30:00Z", 999)],  # 持ち主以外が付けた
            4: [labeled("着手可", "2026-09-30T00:30:00Z", 999)],  # どちらも持ち主以外
        },
    )


def test_待ち行列は持ち主が書き持ち主が付けたものだけ():
    waiting, others = main.queue(fake())
    assert [c.number for c in waiting] == [1]
    assert others == [2]


def test_連鎖の起動も同じ条件で数える():
    gh = fake()
    gh.issues = [issue(2, 999), issue(3, OWNER)]
    main.next_run(gh)
    assert gh.dispatched == 0


def test_pickは持ち主以外が書いたものを案に戻し_タイトルと本文だけを渡す(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("GITHUB_RUN_ID", "5")
    monkeypatch.setenv("GITHUB_REPOSITORY", "mikotorei/example")
    monkeypatch.setenv("GITHUB_SERVER_URL", "https://github.com")
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "out"))
    gh = fake()
    assert main.pick(gh) == 0
    assert (2, ("着手可",), ("案",)) in gh.relabeled
    assert any(n == 2 and "持ち主以外が書いた" in body for n, body in gh.comments)
    assert (1, ("着手可",), ("作業中",)) in gh.relabeled
    assert (tmp_path / ".worker/issue.md").read_text(encoding="utf-8") == "# 題1\n\n本文\n"
    assert "issue=1\n" in (tmp_path / "out").read_text(encoding="utf-8")


# 提案が閉じた時（worker pr-closed）

class FakeIssues:
    def __init__(self, labels, state="open"):
        self.state = state
        self.labels = set(labels)
        self.closed = 0
        self.comments = []

    def issue(self, number):
        return {"state": self.state, "labels": [{"name": n} for n in self.labels]}

    def close_issue(self, number):
        self.state = "closed"
        self.closed += 1

    def relabel(self, number, remove, add):
        self.labels -= set(remove)
        self.labels |= set(add)

    def comment(self, number, body):
        self.comments.append((number, body))


def event(merged, ref="claude/issue-2-36729498995", repo="mikotorei/example"):
    return {
        "repository": {"full_name": "mikotorei/example", "default_branch": "main"},
        "pull_request": {
            "number": 3,
            "html_url": "https://github.com/mikotorei/example/pull/3",
            "merged": merged,
            "head": {"ref": ref, "repo": {"full_name": repo}},
            "base": {"ref": "main"},
        },
    }


def test_反映されたらIssueを閉じて完了にする():
    gh = FakeIssues({"承認待ち"})
    main.pr_closed(gh, event(merged=True))
    assert gh.state == "closed" and gh.closed == 1
    assert gh.labels == {"完了"}
    assert gh.comments == []


def test_本文のClosesで閉じていても完了にする_二重には閉じない():
    gh = FakeIssues({"承認待ち"}, state="closed")
    main.pr_closed(gh, event(merged=True))
    assert gh.closed == 0 and gh.labels == {"完了"}


def test_反映されずに閉じたら案に戻してコメントする():
    gh = FakeIssues({"承認待ち"})
    main.pr_closed(gh, event(merged=False))
    assert gh.state == "open" and gh.closed == 0
    assert gh.labels == {"案"}
    assert len(gh.comments) == 1 and "反映されずに閉じられた" in gh.comments[0][1]


def test_承認待ちが無いIssueや担当以外の提案には触らない():
    for gh, ev in (
        (FakeIssues({"完了"}, state="closed"), event(merged=True)),  # 手で片づけ済み
        (FakeIssues({"案"}), event(merged=False)),
        (FakeIssues({"承認待ち"}), event(merged=True, ref="ccr-abc")),
        (FakeIssues({"承認待ち"}), event(merged=True, repo="someone/fork")),
    ):
        before = set(gh.labels)
        main.pr_closed(gh, ev)
        assert gh.labels == before and gh.closed == 0 and gh.comments == []


def test_ラベルを外す時に別の実行が先に外していても失敗しない():
    from worker.github import GitHub

    class Res:
        def __init__(self, status, data=None):
            self.status_code = status
            self._data = data
            self.content = b"x" if data is not None else b""

        def json(self):
            return self._data

    calls = []

    class Session:
        headers = {}

        def request(self, method, url, **kwargs):
            calls.append(method)
            if method == "GET":
                return Res(200, {"labels": [{"name": "承認待ち"}]})
            if method == "DELETE":
                return Res(404, {"message": "Label does not exist"})
            return Res(200, [])

    gh = GitHub("mikotorei/example", "t")
    gh.session = Session()
    gh.relabel(2, remove=["承認待ち"], add=["完了"])
    assert calls == ["GET", "DELETE", "POST"]


# 挑戦の回数と一日の上限（worker pick・worker fail）

OWNER_ACTOR = {"id": OWNER, "login": "mikotorei"}
BOT_ACTOR = {"id": 41898282, "login": "github-actions[bot]"}


def set_env(monkeypatch, tmp_path, daily=None):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("GITHUB_RUN_ID", "5")
    monkeypatch.setenv("GITHUB_REPOSITORY", "mikotorei/example")
    monkeypatch.setenv("GITHUB_SERVER_URL", "https://github.com")
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "out"))
    if daily is None:
        monkeypatch.delenv("WORKER_DAILY_LIMIT", raising=False)
    else:
        monkeypatch.setenv("WORKER_DAILY_LIMIT", daily)


class LabelGitHub(FakeGitHub):
    """relabel でラベルの付け外しをイベントとして残す偽物（担当が付けた記録になる）。"""

    def __init__(self, issues, events, started_today=0):
        super().__init__(issues, events)
        self.started_today = started_today

    def relabel(self, number, remove, add):
        super().relabel(number, remove, add)
        for name in add:
            self.events[number].append({"event": "labeled", "label": {"name": name}, "created_at": "2026-10-01T09:00:00Z", "actor": BOT_ACTOR})

    def repo_events_since(self, since):
        return [
            {"event": "labeled", "label": {"name": "作業中"}, "created_at": "2099-01-01T00:00:00Z", "actor": BOT_ACTOR}
        ] * self.started_today


def test_既に2回挑戦したIssueは作業せずに案に戻す(tmp_path, monkeypatch):
    set_env(monkeypatch, tmp_path)
    gh = LabelGitHub(
        issues=[issue(1, OWNER), issue(3, OWNER)],
        events={
            1: [
                labeled("着手可", "2026-10-01T00:00:00Z", OWNER),
                {"event": "labeled", "label": {"name": "作業中"}, "created_at": "2026-10-01T00:01:00Z", "actor": BOT_ACTOR},
                {"event": "labeled", "label": {"name": "作業中"}, "created_at": "2026-10-01T00:11:00Z", "actor": BOT_ACTOR},
            ],
            3: [labeled("着手可", "2026-10-01T00:30:00Z", OWNER)],
        },
    )
    main.pick(gh)
    assert (1, ("着手可",), ("案",)) in gh.relabeled
    assert any(n == 1 and "2回失敗したので止めました" in b for n, b in gh.comments)
    assert (3, ("着手可",), ("作業中",)) in gh.relabeled  # 次の Issue に進む
    assert "issue=3\n" in (tmp_path / "out").read_text(encoding="utf-8")


def test_一日の上限は設定値で決まり_0なら着手しない(tmp_path, monkeypatch):
    for daily, started, picked in (("0", 0, False), ("2", 2, False), ("2", 1, True), (None, 19, True), (None, 20, False)):
        set_env(monkeypatch, tmp_path, daily)
        gh = LabelGitHub(issues=[issue(1, OWNER)], events={1: [labeled("着手可", "2026-10-01T00:00:00Z", OWNER)]}, started_today=started)
        main.pick(gh)
        assert ((1, ("着手可",), ("作業中",)) in gh.relabeled) is picked, (daily, started)
        if not picked:
            assert (1, ("着手可",), ("案",)) in gh.relabeled
        if daily == "0":
            assert any("止めるスイッチ" in b for _, b in gh.comments)


def fail_case(tmp_path, monkeypatch, attempts, cannot=None, outcome="failure", elapsed=60):
    set_env(monkeypatch, tmp_path)
    events = [labeled("着手可", "2026-10-01T00:00:00Z", OWNER)]
    for i in range(attempts):
        events.append({"event": "labeled", "label": {"name": "作業中"}, "created_at": f"2026-10-01T0{i + 1}:00:00Z", "actor": BOT_ACTOR})
        if i + 1 < attempts:
            events.append({"event": "labeled", "label": {"name": "着手可"}, "created_at": f"2026-10-01T0{i + 1}:30:00Z", "actor": BOT_ACTOR})
    gh = LabelGitHub(issues=[issue(1, OWNER)], events={1: events})
    work = tmp_path / ".worker"
    work.mkdir(exist_ok=True)
    for f in work.iterdir():
        f.unlink()
    if cannot:
        (work / "cannot-complete.md").write_text(cannot, encoding="utf-8")
    import time as _time

    main.fail(gh, 1, outcome, str(int(_time.time() - elapsed)))
    return gh


def test_1回目の失敗はもう一度挑戦し_次の実行で拾われる(tmp_path, monkeypatch):
    gh = fail_case(tmp_path, monkeypatch, attempts=1)
    assert gh.relabeled[-1] == (1, ("作業中",), ("着手可",))
    assert "1回目の挑戦が失敗したので、もう一度挑戦します" in gh.comments[-1][1]
    waiting, _ = main.queue(gh)  # 担当が付け直した着手可でも、持ち主が付けた順番のまま待ちに入る
    assert [(c.number, c.attempts) for c in waiting] == [(1, 1)]
    assert waiting[0].labeled_at.isoformat().startswith("2026-10-01T00:00")


def test_2回目の失敗は案に戻して止めた旨をコメントする(tmp_path, monkeypatch):
    gh = fail_case(tmp_path, monkeypatch, attempts=2)
    assert gh.relabeled[-1] == (1, ("作業中", "着手可"), ("案",))
    assert gh.comments[-1][1].startswith("2回失敗したので止めました")


def test_完了できない判断と時間切れは1回目でも止める(tmp_path, monkeypatch):
    gh = fail_case(tmp_path, monkeypatch, attempts=1, cannot="指示が曖昧です")
    assert gh.relabeled[-1][2] == ("案",)
    assert gh.comments[-1][1].startswith("「案」に戻しました。") and "完了できないと判断" in gh.comments[-1][1]
    gh = fail_case(tmp_path, monkeypatch, attempts=1, elapsed=40 * 60)
    assert gh.relabeled[-1][2] == ("案",) and "作業時間の上限" in gh.comments[-1][1]


# 予定どおりの停止は実行を「成功」で終える。もう一度挑戦するかの決まりは変えない（worker finish → worker fail）

import subprocess


def git_repo(tmp_path):
    """作業場所（finish が動くリポジトリ）を作り、最初のコミットを返す。"""
    repo = tmp_path / "repo"
    repo.mkdir()
    run = lambda *a: subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
    run("init", "-q", "-b", "main")
    run("config", "user.email", "t@example.com")
    run("config", "user.name", "t")
    (repo / ".gitignore").write_text(".worker/\n", encoding="utf-8")
    (repo / "page.md").write_text("old\n", encoding="utf-8")
    run("add", "-A")
    run("commit", "-q", "-m", "base")
    return repo, run("rev-parse", "HEAD"), run


def make_patch(repo, run, base, files):
    """担当の変更（files）を patch にして、作業場所を元に戻す（work ジョブの「変更をまとめる」と同じ作り方）。"""
    for name, text in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    run("add", "-A")
    patch = subprocess.run(["git", "diff", "--cached", "--binary", base], cwd=repo, check=True, capture_output=True).stdout
    run("reset", "-q", "--hard", base)
    run("clean", "-qfd", "-e", ".worker")
    return patch


# 場合 → (予定どおりの停止か, 1回目の失敗でもう一度挑戦するか)。上限の見直しで決めた再挑戦の決まり
STOP_CASES = {
    "変更が無い": ({}, None, True),
    "日誌が無い": ({"page.md": "new\n"}, None, True),
    "ワークフローの変更": ({".github/workflows/x.yml": "x\n", "journal/2026-10-01.md": "日誌\n"}, None, True),
    "完了できない判断": ({}, "指示が曖昧です", False),
}


def test_予定どおりの停止は成功で終え_再挑戦の決まりは変わらない(tmp_path, monkeypatch):
    for case, (files, cannot, retry_first) in STOP_CASES.items():
        case_dir = tmp_path / case
        case_dir.mkdir()
        repo, base, run = git_repo(case_dir)
        patch = make_patch(repo, run, base, files)
        set_env(monkeypatch, repo)
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        work = repo / ".worker"
        work.mkdir()
        (work / "changes.patch").write_bytes(patch)
        if cannot:
            (work / "cannot-complete.md").write_text(cannot, encoding="utf-8")

        assert main.finish(None, 1, "claude/issue-1-5", base) == 0, case  # 実行の色は「成功」
        assert "stopped=true\n" in (repo / "out").read_text(encoding="utf-8"), case
        reason = (work / "reason.txt").read_text(encoding="utf-8")

        # finish が残した理由で決める再挑戦の決まりは、今までの決まりと同じ
        facts = dict(finish_reason=reason, cannot_complete=cannot, claude_outcome="success", elapsed_seconds=60)
        kind = main.rules.failure_kind(**facts)
        assert main.rules.retry_after_failure(kind, 1) is retry_first, case
        assert main.rules.retry_after_failure(kind, 2) is False, case

        # fail の手順を通しても同じ（1回目）
        events = [labeled("着手可", "2026-10-01T00:00:00Z", OWNER),
                  {"event": "labeled", "label": {"name": "作業中"}, "created_at": "2026-10-01T01:00:00Z", "actor": BOT_ACTOR}]
        gh = LabelGitHub(issues=[issue(1, OWNER)], events={1: events})
        main.fail(gh, 1, "success", "")
        expected = ("着手可",) if retry_first else ("案",)
        assert gh.relabeled[-1][2] == expected, case


def test_変更を受け取れない時は今までどおり実行を失敗にする(tmp_path, monkeypatch):
    repo, base, run = git_repo(tmp_path)
    set_env(monkeypatch, repo)
    assert main.finish(None, 1, "claude/issue-1-5", base) == 1  # .worker/changes.patch が無い
    assert "stopped" not in (repo / "out").read_text(encoding="utf-8") if (repo / "out").exists() else True


class PrivateGitHub(LabelGitHub):
    """非公開リポジトリ：担当と、月の上限を共有するワークフローの使用時間を返す偽物。"""

    def __init__(self, issues, events, worker_minutes, shared):
        super().__init__(issues, events)
        self.private = True
        self.worker_minutes = worker_minutes
        self.shared = shared
        self.asked = []

    def worker_minutes_since(self, since):
        return self.worker_minutes

    def workflow_minutes_since(self, since, workflow_file):
        self.asked.append(workflow_file)
        return self.shared[workflow_file]


def test_月の上限は共有するワークフローの使用と確保する分を先に差し引く(tmp_path, monkeypatch):
    cases = (
        # (担当, 共有の使用, 確保, 共有の設定, 着手するか)
        (500, 100, 299, "shared.yml", True),
        (500, 100, 300, "shared.yml", False),
        (899, 0, 0, None, True),  # 共有しなければ今までどおり
        (900, 0, 0, None, False),
        (500, 100, 300, None, True),  # 共有の設定が無ければ数えない（確保は効く分だけ）
    )
    for worker, used, reserved, shared, picked in cases:
        set_env(monkeypatch, tmp_path)
        if shared is None:
            monkeypatch.delenv("WORKER_SHARED_WORKFLOWS", raising=False)
        else:
            monkeypatch.setenv("WORKER_SHARED_WORKFLOWS", shared)
        monkeypatch.setenv("WORKER_RESERVED_MINUTES", str(reserved) if shared else "0")
        gh = PrivateGitHub([issue(1, OWNER)], {1: [labeled("着手可", "2026-10-01T00:00:00Z", OWNER)]},
                           worker, {"shared.yml": used})
        main.pick(gh)
        assert ((1, ("着手可",), ("作業中",)) in gh.relabeled) is picked, (worker, used, reserved, shared)
        if not picked:
            assert any("900分" in b for _, b in gh.comments)
        assert gh.asked == ([shared] if shared else [])


def test_公開リポジトリは共有の設定があっても使用時間を数えない(tmp_path, monkeypatch):
    set_env(monkeypatch, tmp_path)
    monkeypatch.setenv("WORKER_SHARED_WORKFLOWS", "shared.yml")
    monkeypatch.setenv("WORKER_RESERVED_MINUTES", "9999")
    gh = LabelGitHub([issue(1, OWNER)], {1: [labeled("着手可", "2026-10-01T00:00:00Z", OWNER)]})
    main.pick(gh)  # FakeGitHub.worker_minutes_since は呼ばれると失敗する
    assert (1, ("着手可",), ("作業中",)) in gh.relabeled
