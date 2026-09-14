/*
 * 备份服务器连接检查的单元测试。
 *
 * 运行方式：node --test tests/backup_client.test.mjs
 * 这些用例覆盖“有没有连上、为什么没连上”的判定逻辑，
 * 也就是页面上徽标和提示文案的依据。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const backup = require(path.join(here, "..", "static", "backup-client.js"));

const HEALTH_OK = { ok: true, service: "anime-vault-backup" };
const BACKUP_PAYLOAD = {
  format: "anime-vault-backup",
  version: 1,
  exported_at: 1757850000,
  anime: [{ slug: "a", title: "A" }, { slug: "b", title: "B" }],
  episode_progress: [],
  playback_activity: [],
  media_library_paths: [],
};

function jsonResponse(status, payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

/** 按 URL 分发的 fetch 假实现，同时记录调用，便于断言请求内容。 */
function fetchStub(routes) {
  const calls = [];
  const stub = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    const route = routes[target];
    if (route === undefined) {
      throw new TypeError("Failed to fetch");
    }
    return typeof route === "function" ? route(options) : route;
  };
  stub.calls = calls;
  return stub;
}

function networkFailure() {
  return () => {
    throw new TypeError("Failed to fetch");
  };
}

function hangingRequest() {
  return (options) =>
    new Promise((resolve, reject) => {
      const signal = options && options.signal;
      const abort = () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      };
      if (!signal) {
        return;
      }
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort);
      }
    });
}

const BASE = "http://192.168.1.20:8787";

test("resolveEndpoints 补全路径并支持各种写法", () => {
  assert.deepEqual(backup.resolveEndpoints("192.168.1.20:8787"), {
    backupUrl: `${BASE}/api/backup`,
    healthUrl: `${BASE}/health`,
    rootHealthUrl: `${BASE}/health`,
    host: "192.168.1.20:8787",
  });
  assert.equal(backup.resolveEndpoints("https://backup.example.com").backupUrl, "https://backup.example.com/api/backup");
  assert.equal(backup.resolveEndpoints("https://backup.example.com/").backupUrl, "https://backup.example.com/api/backup");
  assert.equal(backup.resolveEndpoints("https://backup.example.com/api/backup/").backupUrl, "https://backup.example.com/api/backup");
  assert.equal(backup.resolveEndpoints("http://host:8787/api/backup?x=1").backupUrl, `${BASE.replace("192.168.1.20", "host")}/api/backup`);
});

test("resolveEndpoints 保留反向代理子路径", () => {
  const endpoints = backup.resolveEndpoints("https://example.com/vault");
  assert.equal(endpoints.backupUrl, "https://example.com/vault/api/backup");
  assert.equal(endpoints.healthUrl, "https://example.com/vault/health");
  assert.equal(endpoints.rootHealthUrl, "https://example.com/health");
});

test("resolveEndpoints 拒绝空地址和非法协议", () => {
  assert.throws(() => backup.resolveEndpoints("   "), /请先填写备份服务器地址/);
  assert.throws(() => backup.resolveEndpoints("ftp://example.com"), /只支持 http/);
  assert.throws(() => backup.resolveEndpoints("http://exa mple.com"), /格式不正确/);
});

test("checkConnection 令牌有效且有备份时返回连接成功", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(200, BACKUP_PAYLOAD),
  });
  const result = await backup.checkConnection({ url: "192.168.1.20:8787", token: "secret", fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ok");
  assert.equal(result.badge, "已连接");
  assert.equal(result.level, "ok");
  assert.equal(result.animeCount, 2);
  assert.match(result.message, /连接成功/);
  assert.match(result.message, /2 部番剧/);
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, "Bearer secret");
});

test("checkConnection 把 404 且健康检查正常识别为已连接但暂无备份", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(404, { error: "No backup found" }),
    [`${BASE}/health`]: jsonResponse(200, HEALTH_OK),
  });
  const result = await backup.checkConnection({ url: `${BASE}/api/backup`, token: "secret", fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.status, "empty");
  assert.equal(result.badge, "已连接（暂无备份）");
  assert.match(result.message, /云端目前还没有备份记录/);
});

test("checkConnection 在没有备份服务时把 404 归因于路径错误", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(404, { error: "Not found" }),
    [`${BASE}/health`]: jsonResponse(404, { error: "Not found" }),
  });
  const result = await backup.checkConnection({ url: BASE, token: "secret", fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.status, "wrongPath");
  assert.match(result.message, /以 \/api\/backup 结尾/);
});

test("即使备份服务没有 /health 接口，也能从 404 内容判断是暂无备份", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(404, { error: "No backup found" }),
    [`${BASE}/health`]: jsonResponse(404, { error: "Not found" }),
  });
  const result = await backup.checkConnection({ url: BASE, token: "secret", fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.status, "empty");
  assert.match(result.message, /云端目前还没有备份记录/);
});

test("checkConnection 报告令牌无效", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(401, { error: "Unauthorized" }),
  });
  const result = await backup.checkConnection({ url: BASE, token: "wrong", fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.status, "unauthorized");
  assert.equal(result.badge, "令牌无效");
  assert.equal(result.level, "warn");
  assert.match(result.message, /--token/);
});

test("checkConnection 在服务器不可达时给出可操作提示", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: networkFailure(),
    [`${BASE}/health`]: networkFailure(),
  });
  const result = await backup.checkConnection({ url: BASE, token: "secret", fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.status, "unreachable");
  assert.equal(result.badge, "无法连接");
  assert.equal(result.level, "error");
  assert.match(result.message, /无法连接到 192.168.1.20:8787/);
  assert.match(result.message, /防火墙/);
});

test("checkConnection 在超时后返回超时状态而不是一直等待", async () => {
  const fetchImpl = fetchStub({ [`${BASE}/api/backup`]: hangingRequest() });
  const result = await backup.checkConnection({ url: BASE, token: "secret", fetchImpl, timeoutMs: 30 });

  assert.equal(result.status, "timeout");
  assert.equal(result.badge, "连接超时");
  assert.match(result.message, /连接超时/);
  assert.equal(fetchImpl.calls.length, 1);
});

test("checkConnection 预先拦截 HTTPS 页面对 http 地址的混合内容请求", async () => {
  const fetchImpl = fetchStub({});
  const result = await backup.checkConnection({
    url: "http://192.168.1.20:8787",
    token: "secret",
    fetchImpl,
    pageProtocol: "https:",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.level, "error");
  assert.match(result.message, /HTTPS/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("checkConnection 缺少令牌或地址非法时立即反馈", async () => {
  const fetchImpl = fetchStub({});
  const noToken = await backup.checkConnection({ url: BASE, token: "  ", fetchImpl });
  assert.equal(noToken.status, "noToken");
  assert.match(noToken.message, /访问令牌/);

  const badUrl = await backup.checkConnection({ url: "://", token: "secret", fetchImpl });
  assert.equal(badUrl.status, "invalidUrl");
  assert.equal(fetchImpl.calls.length, 0);
});

test("地址为空时回到未测试状态而不是报连接失败", async () => {
  const fetchImpl = fetchStub({});
  const result = await backup.checkConnection({ url: "", token: "", fetchImpl });

  assert.equal(result.status, "idle");
  assert.equal(result.badge, "未测试");
  assert.equal(result.ok, false);
  assert.match(result.message, /请先填写备份服务器地址/);
});

test("上传/刷新在配置不完整时抛出可识别的错误原因", async () => {
  const fetchImpl = fetchStub({});

  await assert.rejects(
    () => backup.uploadBackup({ url: "", token: "secret", fetchImpl }),
    (error) => {
      assert.equal(error.reason, "empty-url");
      return true;
    }
  );
  await assert.rejects(
    () => backup.refreshFromBackup({ url: BASE, token: "", fetchImpl }),
    (error) => {
      assert.equal(error.reason, "config");
      return true;
    }
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("checkConnection 识别出可访问但不是备份服务的地址", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(200, "<html>hello</html>"),
  });
  const result = await backup.checkConnection({ url: BASE, token: "secret", fetchImpl });

  assert.equal(result.status, "wrongService");
  assert.equal(result.ok, false);
  assert.match(result.message, /不是 Anime Vault 备份数据/);
});

test("uploadBackup 上传本地导出并返回统计信息", async () => {
  const fetchImpl = fetchStub({
    "/api/backup/export": jsonResponse(200, BACKUP_PAYLOAD),
    [`${BASE}/api/backup`]: (options) => {
      assert.equal(options.method, "PUT");
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.equal(JSON.parse(options.body).format, "anime-vault-backup");
      return jsonResponse(200, { ok: true, updated_at: 1757850000 });
    },
  });
  const result = await backup.uploadBackup({ url: BASE, token: "secret", fetchImpl });

  assert.equal(result.animeCount, 2);
  assert.match(result.message, /备份已上传：2 部番剧/);
});

test("uploadBackup 在上传被拒绝时抛出带原因的异常", async () => {
  const fetchImpl = fetchStub({
    "/api/backup/export": jsonResponse(200, BACKUP_PAYLOAD),
    [`${BASE}/api/backup`]: jsonResponse(401, { error: "Unauthorized" }),
  });

  await assert.rejects(
    () => backup.uploadBackup({ url: BASE, token: "wrong", fetchImpl }),
    (error) => {
      assert.equal(error.reason, "remote");
      assert.equal(error.status, 401);
      assert.match(error.message, /令牌无效/);
      return true;
    }
  );
});

test("refreshFromBackup 在云端没有备份时给出明确提示", async () => {
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(404, { error: "No backup found" }),
  });

  await assert.rejects(
    () => backup.refreshFromBackup({ url: BASE, token: "secret", fetchImpl }),
    (error) => {
      assert.equal(error.reason, "empty");
      assert.match(error.message, /请先点击“上传备份”/);
      return true;
    }
  );
});

test("refreshFromBackup 下载后写入本地接口并报告数量", async () => {
  let imported = "";
  const fetchImpl = fetchStub({
    [`${BASE}/api/backup`]: jsonResponse(200, BACKUP_PAYLOAD),
    "/api/backup/import": (options) => {
      imported = options.body;
      return jsonResponse(200, { ok: true, anime_count: 2 });
    },
  });
  const result = await backup.refreshFromBackup({ url: BASE, token: "secret", fetchImpl });

  assert.equal(JSON.parse(imported).format, "anime-vault-backup");
  assert.equal(result.animeCount, 2);
  assert.match(result.message, /2 部番剧/);
});

test("formatExportedAt 只格式化有效时间戳", () => {
  assert.equal(backup.formatExportedAt(0), "");
  assert.equal(backup.formatExportedAt(undefined), "");
  assert.equal(backup.formatExportedAt("abc"), "");
  assert.match(backup.formatExportedAt(1757850000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
