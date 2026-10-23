const projectRoot = process.cwd();

const graph = {
  generated_at: "2026-10-22T00:00:00Z",
  nodes: [
    {
      id: "r-001",
      kind: "rule",
      claim: "Use violet for primary actions",
      scope: ["design"],
      confidence: 0.85,
      status: "active",
      reinforcement_count: 1,
      supersedes: [],
      related: [],
      conflicts_with: [],
      evidence_log: [],
      referenced_by: [],
    },
  ],
  edges: [],
};

const snapshot = (hostUp = true, shelvesEnabled = true) => ({
  project: projectRoot,
  vault: `${projectRoot}/vault.db`,
  hint: "",
  host: { port: 9470, listening: hostUp, rules: 1 },
  shelves: { enabled: shelvesEnabled, indexed: shelvesEnabled, roots: ["docs"] },
  embed: { id: "embed", enabled: false, package: "", port: 0, running: false, healthy: false },
  embedHealth: null,
  hostUrl: "http://127.0.0.1:9470",
  sidecarLogPath: "",
  yamlError: "",
});

async function installDeskFixture(options: { hostUp?: boolean; shelvesEnabled?: boolean; failGateway?: boolean } = {}) {
  await $('[data-testid="nav-dashboard"]').click();
  const deskResult = {
      ...graph,
      ok: true,
      vault: "/tmp/imprint-console-e2e/vault.db",
      shelves: {
        enabled: options.shelvesEnabled ?? true,
        indexed: options.shelvesEnabled ?? true,
        chunk_count: options.shelvesEnabled === false ? 0 : 1,
      },
      hits: [{ id: "doc-001", path: "docs/architecture.md", heading: "Architecture", score: 1, snippet: "Typed gateway" }],
      id: "doc-001",
      path: "docs/architecture.md",
      heading: "Architecture",
      content: "# Architecture\n\nTyped gateway with **sanitized Markdown**.",
      referenced_rules: [{ id: "r-001" }],
      resolved_sources: [],
  };
  await browser.execute((value) => {
    window.__IMPRINT_E2E__ = value;
  }, {
    snapshot: snapshot(options.hostUp ?? true, options.shelvesEnabled ?? true),
    deskResult: options.failGateway ? undefined : deskResult,
    deskError: options.failGateway
      ? { code: "host_unavailable", message: "fixture gateway failure", source: "host" }
      : undefined,
  });

  const expectedHostUp = options.hostUp ?? true;
  await browser.waitUntil(async () =>
    (await $('[data-testid="open-audit"]').isEnabled()) === expectedHostUp,
  );
}

describe("built-in Audit workspace", () => {
  let originalConfig: Record<string, unknown>;

  before(async () => {
    originalConfig = await browser.tauri.execute(({ core }) => core.invoke("get_config"));
    await browser.tauri.execute(
      ({ core }, cfg) => core.invoke("save_app_config", { cfg }),
      { ...originalConfig, projectRoot, pollIntervalMs: 100, locale: "en" },
    );
    await browser.refresh();
  });

  beforeEach(async () => {
    await $('[data-testid="nav-dashboard"]').click();
    await browser.executeAsync((done) => {
      const request = indexedDB.deleteDatabase("imprint-desk");
      request.onsuccess = () => done();
      request.onerror = () => done();
      request.onblocked = () => done();
    });
  });

  after(async () => {
    await browser.execute(() => { delete window.__IMPRINT_E2E__; });
    await browser.tauri.execute(
      ({ core }, cfg) => core.invoke("save_app_config", { cfg }),
      originalConfig,
    );
  });

  it("drives rules, graph, documents, unified graph, and URL state in the macOS Tauri window", async () => {
    await installDeskFixture();
    await $('[data-testid="nav-audit"]').click();
    await expect($('[data-testid="rules-workspace"]')).toBeDisplayed();

    const search = await $('[data-testid="audit-search"]');
    await search.setValue("violet");
    await expect($('[data-testid="graph-legend"]')).toBeDisplayed();
    await expect($('[data-testid="graph-resizer"]')).toBeDisplayed();
    expect(await browser.getUrl()).toContain("q=violet");

    await $("label=List").click();
    await expect($('[data-testid="rule-r-001"]')).toBeDisplayed();
    await $('[data-testid="rule-r-001"]').click();
    await expect($('[data-testid="rule-detail"]')).toHaveText(expect.stringContaining("Use violet for primary actions"));

    await $('[data-testid="audit-help"]').click();
    await expect($('[data-testid="audit-help-lines"]')).toBeDisplayed();
    await browser.keys("Escape");

    await $("label=Graph").click();
    await expect($("svg")).toBeDisplayed();

    await $("label=Documents").click();
    const docsSearch = await $('input[placeholder="Search indexed Markdown"]');
    await docsSearch.setValue("gateway");
    await expect($('[data-testid="doc-hit-doc-001"]')).toBeDisplayed();
    await expect($('[data-testid="doc-preview"]')).toHaveText(expect.stringContaining("sanitized Markdown"));

    await $("label=Unified").click();
    await expect($('[data-testid="unified-workspace"]')).toBeDisplayed();
  });

  it("shows a stopped-Host state without contacting the gateway", async () => {
    await installDeskFixture({ hostUp: false });
    await $('[data-testid="nav-audit"]').click();
    await expect($('[data-testid="audit-page"]')).toHaveText(expect.stringContaining("Host is stopped"));
  });

  it("disables document modes when Shelves is disabled", async () => {
    await installDeskFixture({ shelvesEnabled: false });
    await $('[data-testid="nav-audit"]').click();
    await expect($('input[value="docs"]')).not.toBeEnabled();
    await expect($('input[value="unified"]')).not.toBeEnabled();
  });

  it("surfaces structured gateway failures inside the Audit boundary", async () => {
    await installDeskFixture({ failGateway: true });
    await $('[data-testid="nav-audit"]').click();
    await expect($('[data-testid="audit-page"]')).toHaveText(expect.stringContaining("fixture gateway failure"));
  });
});
