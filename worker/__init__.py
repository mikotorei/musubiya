"""担当（Issue に「着手可」が付いたら Claude Code が作業する仕組み）の手順。

ワークフローは .github/workflows/worker.yml（着手）と worker-done.yml（完了）。決まりは miko-hub の CLAUDE.md の「担当」。
miko-hub と、担当を配ったリポジトリで同じ中身に保つ。テストは pip install -r worker/requirements.txt のあと python -m pytest worker/tests。
"""
