# Kling Image 4.0 候选证据

报告见 `../../docs/experiments/kling-image4-candidate-2026-11-18.md`。

`summary.json` 为脱敏验收与逐项费用，`manifest.json` 保留冻结prompt和输入SHA，`measurements.json`列出全部新图的像素/alpha/原始字节SHA。`contracts/`保留一手schema/报价。`qa/`两张并排预览可独立查看。

原始大图、供应商任务回执和上传URL只留在此本地目录，已由.gitignore排除；`comparison.html`在本机可打开全部原图，独立checkout没有这些被忽略的大图。媒体没有远程发布。

浏览器：`python3 -m http.server 3269 --bind 127.0.0.1 --directory evidence/kling-image4-20261118`，访问`http://127.0.0.1:3269/comparison.html`。

隔离runner、只读价格fixture、原始CLI回执和运行日志保存在本机 `/Users/tianyicai/.codex/artifacts/kling-image4-20261118/`。没有共享价格或环境修改。
