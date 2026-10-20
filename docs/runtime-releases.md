# Runtime install (Imprint Console)

On first launch, Console installs three components. **imprint** goes to a **machine-wide path** (same for Terminal if you use that path or add it to PATH). **Python** and **sidecar** live under app data.

| Component | Location | Source |
| --- | --- | --- |
| **imprint CLI** | **`$(go env GOPATH)/bin/imprint`**（或 GOBIN） | Console 执行 **`go install`**（与终端一致），非 `{app_data}` |
| **Python 3.12** | `{app_data}/runtime/python/` | [python-build-standalone](https://github.com/astral-sh/python-build-standalone/releases) |
| **embed sidecar** | `{app_data}/runtime/embed-sidecar/` | `git clone` [imprint-embed-sidecar](https://github.com/SteamedBread2333/imprint-embed-sidecar) |

Imprint install (Go toolchain):

```bash
go install github.com/SteamedBread2333/imprint/cmd/imprint@latest
go install github.com/SteamedBread2333/imprint/cmd/imprint-mcp@latest
```

Console **Prepare runtime** / **Update imprint** runs the same for a pinned release tag. Ensure `~/go/bin` (or your GOBIN) is on PATH for Terminal and editors.

Embed config remains **`~/.imprint/embed.yaml`** (data only; CLI is not stored under `~/.imprint/bin`).

## Global embed config

Semantic dedup is configured in **`~/.imprint/embed.yaml`** (enabled, package path, port, model, thresholds). Project `imprint.yaml` must **not** contain `plugins.embed`.

Console writes `package` to the managed sidecar directory after `ensure_runtime`.

## Minimum imprint version

Use an imprint build that reads global `embed.yaml` (same release as Console docs). Older CLIs expect `plugins.embed` in each project.
