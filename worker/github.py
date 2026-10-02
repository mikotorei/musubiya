"""担当が使う GitHub API。ワークフローの標準のトークン（GITHUB_TOKEN）で呼ぶ。

トークンの値は Authorization ヘッダーにだけ使い、表示や記録には出さない。
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterator
from urllib.parse import quote

import requests

from . import rules

API_BASE = "https://api.github.com"
TIMEOUT = 20  # 秒
WORKFLOW_FILE = "worker.yml"


class GitHub:
    def __init__(self, repo: str, token: str):
        self.repo = repo
        self._repo_info: dict | None = None
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "miko-hub-worker",
            }
        )

    def _call(self, method: str, path: str, ok: tuple[int, ...] = (), **kwargs):
        res = self.session.request(method, API_BASE + path, timeout=TIMEOUT, **kwargs)
        if res.status_code in ok:
            return None
        if res.status_code >= 400:
            raise RuntimeError(f"GitHub API {method} {path.split('?')[0]} が HTTP {res.status_code} を返しました")
        return res.json() if res.content else None

    def _pages(self, path: str, key: str | None = None) -> Iterator[dict]:
        sep = "&" if "?" in path else "?"
        page = 1
        while True:
            data = self._call("GET", f"{path}{sep}per_page=100&page={page}")
            items = data[key] if key else data
            yield from items
            if len(items) < 100:
                return
            page += 1

    # リポジトリ
    def info(self) -> dict:
        """リポジトリの情報（持ち主の id・公開か非公開か）。1回の実行で1度だけ読む。"""
        if self._repo_info is None:
            self._repo_info = self._call("GET", f"/repos/{self.repo}")
        return self._repo_info

    # Issue
    def ready_issues(self) -> list[dict]:
        """「着手可」が付いた開いている Issue（プルリクエストは除く）。"""
        label = quote(rules.READY)
        return [
            issue
            for issue in self._pages(f"/repos/{self.repo}/issues?state=open&labels={label}")
            if "pull_request" not in issue
        ]

    def issue(self, number: int) -> dict:
        return self._call("GET", f"/repos/{self.repo}/issues/{number}")

    def issue_events(self, number: int) -> list[dict]:
        return list(self._pages(f"/repos/{self.repo}/issues/{number}/events"))

    def repo_events_since(self, since: datetime) -> list[dict]:
        """リポジトリ全体の Issue のイベントのうち、since 以降のもの（新しい順に読み、古くなったら止める）。"""
        events = []
        for event in self._pages(f"/repos/{self.repo}/issues/events"):
            if rules.parse_time(event["created_at"]) < since:
                break
            events.append(event)
        return events

    def relabel(self, number: int, remove: list[str], add: list[str]) -> None:
        current = {label["name"] for label in self.issue(number)["labels"]}
        for name in remove:
            if name in current:
                # 同じ時に別の実行が外していれば 404 になる（完了の付け替えは2つの起点から動きうる）
                self._call("DELETE", f"/repos/{self.repo}/issues/{number}/labels/{quote(name)}", ok=(404,))
        if add:
            self._call("POST", f"/repos/{self.repo}/issues/{number}/labels", json={"labels": add})

    def close_issue(self, number: int) -> None:
        """Issue を「完了」の扱いで閉じる。"""
        self._call("PATCH", f"/repos/{self.repo}/issues/{number}", json={"state": "closed", "state_reason": "completed"})

    def comment(self, number: int, body: str) -> None:
        self._call("POST", f"/repos/{self.repo}/issues/{number}/comments", json={"body": body})

    # 提案
    def create_pull(self, title: str, head: str, base: str, body: str) -> str:
        try:
            pull = self._call(
                "POST", f"/repos/{self.repo}/pulls", json={"title": title, "head": head, "base": base, "body": body}
            )
        except RuntimeError as e:
            raise RuntimeError(
                f"{e}。リポジトリの Settings → Actions → General の「Allow GitHub Actions to create and approve "
                f"pull requests」が有効か確かめてください（作業用の枝 {head} は push 済み）"
            ) from e
        return pull["html_url"]

    # Actions
    def worker_minutes_since(self, since: datetime) -> int:
        """since 以降に作られた担当の実行が使った分（終わったジョブだけ。ジョブごとに切り上げ）。"""
        return self.workflow_minutes_since(since, WORKFLOW_FILE)

    def workflow_minutes_since(self, since: datetime, workflow_file: str) -> int:
        """since 以降に作られた、あるワークフローの実行が使った分（担当と月の上限を共有するワークフローにも使う）。"""
        created = since.strftime("%Y-%m-%dT%H:%M:%S%z")
        created = created[:-2] + ":" + created[-2:]  # +0900 → +09:00
        total = 0
        path = f"/repos/{self.repo}/actions/workflows/{quote(workflow_file)}/runs?created=%3E%3D{quote(created)}"
        for run in self._pages(path, key="workflow_runs"):
            if run.get("conclusion") == "skipped":
                continue  # 条件に合わず何もしなかった実行（0分）
            jobs = self._call("GET", f"/repos/{self.repo}/actions/runs/{run['id']}/jobs")["jobs"]
            total += rules.job_minutes(jobs)
        return total

    def dispatch_worker(self, ref: str = "main") -> None:
        self._call("POST", f"/repos/{self.repo}/actions/workflows/{WORKFLOW_FILE}/dispatches", json={"ref": ref})
