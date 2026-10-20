# imprint-client

**当前版本：0.1.0**（发版时改这一行即可；CI 以 git tag 为准自动写进工程配置。）

**imprint 生态的后台管理 / 运维控制台**（Tauri 桌面应用）。面向本机维护者：查看 Host、Shelves、Desk、Embed 运行态，启停 `imprint up/down`，可视化安装并启动 [imprint-embed-sidecar](https://github.com/SteamedBread2333/imprint-embed-sidecar)（setup → prepare → start），并跟踪 sidecar 日志。

这不是面向终端用户的记忆浏览产品；规则与图谱审计请用 [imprint-desk-plugin](https://github.com/SteamedBread2333/imprint-desk-plugin) 或 `imprint desk open`。

| | imprint-desk-plugin | imprint-client |
| --- | --- | --- |
| 受众 | 开发者 / 智能体协作者 — 审计规则与图谱 | 维护者 / 本机运维 — 服务态、启停栈、装 sidecar |
| 核心 | Host HTTP API 上的可视化 | `imprint` CLI 编排、健康探测、安装向导、日志 |
| 写 vault | 无 | 无；仅通过 CLI 启停与 embed 生命周期 |

相关仓库：

- [imprint](https://github.com/SteamedBread2333/imprint) — CLI、Host、MCP
- [imprint-embed-sidecar](https://github.com/SteamedBread2333/imprint-embed-sidecar) — 语义查重 sidecar
- [imprint-desk-plugin](https://github.com/SteamedBread2333/imprint-desk-plugin) — 浏览器内 vault 仪表盘

## Quick start

前置：本机已安装 **Rust**、**Node 20+**、**imprint** 可执行文件，以及 sidecar 所需的 **Python 3.11+**。

```bash
# 建议使用与 imprint.yaml 中 plugins.embed.package 一致的 sidecar 路径
# 例如并列克隆：imprint / imprint-embed-sidecar / imprint-client

cd imprint-client
npm install --legacy-peer-deps
npm run tauri dev
```

开发时 Vite 会在本机 `1420` 端口起**仅供 Tauri 内嵌 WebView 加载**的前端服务；终端若曾出现 `Local: http://localhost:1420/`，**不要用 Chrome 打开**，只用自动弹出的 **Imprint Console 桌面窗口**。

首次启动在欢迎页 **选择 imprint 项目根目录**（含 `imprint.yaml` 的目录）。若 `imprint` 不在 `PATH`，在 **设置** 中填写绝对路径（例如 `../imprint/imprint`）。

常用操作：

- **总览**：轮询 `imprint status` + `plugin list`，并探测 embed `/health` 的 `ready`
- **启动栈 / 停止栈**：`imprint up` / `imprint down`（不自动启 embed）
- **Embed sidecar**：向导执行 `scripts/setup.sh`、`imprint embed prepare`、`imprint plugin start embed`
- **Desk**：Host 已 up 后，在浏览器打开 desk URL

## Screenshots

> 截图由运行中 UI 同款的静态预览页生成（与 `src/App.css` 一致）。本地更新界面后可执行 `npm run screenshots` 重新导出。联调时建议已绑定 `../imprint` 并至少执行过一次 `imprint up`。

![服务总览：Host / Shelves / Desk / Embed / Vault](./assets/screenshots/dashboard.png)

*总览页 — 服务卡片、hint、启停栈与 embed 快捷操作。*

![Embed 安装向导与日志面板](./assets/screenshots/embed-wizard.png)

*Embed 页 — 分步 setup / prepare / start，下方为任务与 sidecar.log 输出。*

![设置：imprint 路径与 Hugging Face 镜像环境变量](./assets/screenshots/settings.png)

*设置页 — `imprint` 可执行文件、轮询间隔、`HF_ENDPOINT` / `IMPRINT_HF_ENDPOINT`。*

## 故障排查：embed `health check failed` / curl 4174 连不上

**常见根因：本机 `imprint` 可执行文件过旧。** 旧版对 embed 只等约 **8s** 健康检查，而 sidecar 首次 `--warm`（含 relate 模型）在 Mac 上常需 **10s+**。CLI 会报 `health check failed` 并 **kill 刚起来的 sidecar**，于是 `curl http://127.0.0.1:4174/health` 也会失败。

在 imprint 仓库 **重新编译** 后再用客户端或 CLI 启动（新版 embed 等待上限为 180s）：

```bash
cd /path/to/imprint
go build -o imprint ./cmd/imprint
# 设置页里 imprint 路径指向这个二进制
./imprint embed prepare          # 可选，先加载模型
./imprint plugin start embed
curl --noproxy '*' http://127.0.0.1:4174/health
```

日志里 11:37 的 `/health 200` 只说明**当时**起来过；一旦被旧 CLI 杀掉或你 `plugin stop`，进程就没了，**以当前 curl 为准**。

## 验收清单（MVP smoke）

1. `imprint down` 时 Dashboard 显示 Host stopped；执行 **启动栈** 后 Host listening、Shelves 状态更新。
2. Embed 向导：步骤 0 通过 Python 与 yaml 检查 → setup.sh → `embed prepare` → `plugin start embed`；`/health` 出现 `ready: true`（模型已缓存时较快）。
3. **停止 embed** 后卡片为 stopped；再次 **启动 embed** 可恢复。
4. sidecar 未 ready 时，imprint `add` 仍可降级 Jaccard（与 sidecar README 一致）。

## 开发

```bash
npm run build          # 前端
npm run tauri build    # 桌面 release 包
```

配置持久化位置（macOS）：`~/Library/Application Support/com.imprint.client/config.json`。

## License

MIT（与 imprint 生态保持一致时可随上游调整。）
