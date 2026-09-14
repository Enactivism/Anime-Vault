/*
 * Anime Vault 云端备份连接检查。
 *
 * 这个文件只包含与备份服务器通信有关的纯逻辑，不直接操作页面 DOM，
 * 因此浏览器（window.AnimeVaultBackup）和 Node 单元测试都可以加载它。
 *
 * 设计要点：
 * - 判定“连接成功”以带令牌访问 /api/backup 的真实结果为准，因为上传和
 *   刷新走的就是这条路径；/health 只用于区分失败原因。
 * - 带令牌 GET /api/backup 返回 404 表示“令牌正确，但云端还没有备份”，
 *   这是连接成功而不是失败。
 * - 每个请求都有超时时间，服务器不可达时不会一直停在“进行中”。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AnimeVaultBackup = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BACKUP_PATH = "/api/backup";
  const HEALTH_PATH = "/health";
  const DEFAULT_TEST_TIMEOUT_MS = 12000;
  const DEFAULT_TRANSFER_TIMEOUT_MS = 120000;
  const HEALTH_TIMEOUT_MS = 5000;
  const MAX_DETAIL_LENGTH = 180;

  /** 连接状态标识，供页面设置 data-state 与徽标文案。 */
  const STATES = {
    idle: "未测试",
    checking: "检测中",
    ok: "已连接",
    empty: "已连接",
    emptyHint: "已连接（暂无备份）",
    unauthorized: "令牌无效",
    unreachable: "无法连接",
    timeout: "连接超时",
    blocked: "被浏览器拦截",
    invalidUrl: "地址有误",
    noToken: "缺少令牌",
    wrongPath: "路径有误",
    wrongService: "不是备份服务",
    serverError: "服务器报错",
    failed: "连接失败",
  };

  const BADGE_TEXT = {
    idle: STATES.idle,
    checking: STATES.checking,
    ok: STATES.ok,
    empty: STATES.emptyHint,
    unauthorized: STATES.unauthorized,
    unreachable: STATES.unreachable,
    timeout: STATES.timeout,
    blocked: STATES.blocked,
    invalidUrl: STATES.invalidUrl,
    noToken: STATES.noToken,
    wrongPath: STATES.wrongPath,
    wrongService: STATES.wrongService,
    serverError: STATES.serverError,
    failed: STATES.failed,
  };

  /** 徽标颜色级别：ok / warn / error / idle。 */
  const BADGE_LEVEL = {
    idle: "idle",
    checking: "checking",
    ok: "ok",
    empty: "empty",
    unauthorized: "warn",
    noToken: "warn",
    invalidUrl: "warn",
    wrongPath: "warn",
    wrongService: "warn",
    unreachable: "error",
    timeout: "error",
    blocked: "error",
    serverError: "error",
    failed: "error",
  };

  function collapseWhitespace(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value).replace(/\s+/g, " ").trim();
  }

  function truncate(value, limit) {
    const text = collapseWhitespace(value);
    const max = limit || MAX_DETAIL_LENGTH;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function badgeText(status) {
    return BADGE_TEXT[status] || STATES.failed;
  }

  function badgeLevel(status) {
    return BADGE_LEVEL[status] || "error";
  }

  /**
   * 把用户填写的地址解析成实际请求地址。
   *
   * 支持这些写法：
   *   192.168.1.20:8787                 -> http://192.168.1.20:8787/api/backup
   *   https://backup.example.com        -> https://backup.example.com/api/backup
   *   https://example.com/vault         -> https://example.com/vault/api/backup
   *   https://example.com/api/backup/   -> https://example.com/api/backup
   *
   * 健康检查地址由备份地址推导（把结尾的 /api/backup 换成 /health），
   * 这样反向代理挂在子路径下时也能猜对。
   */
  function resolveEndpoints(rawUrl) {
    let value = collapseWhitespace(rawUrl);
    if (!value) {
      const error = new Error("请先填写备份服务器地址，例如 192.168.1.20:8787/api/backup");
      error.reason = "empty-url";
      throw error;
    }
    if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(value)) {
      value = `http://${value}`;
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch (error) {
      const failure = new Error("备份服务器地址格式不正确，请填写形如 https://backup.example.com/api/backup 的地址");
      failure.reason = "invalid-url";
      throw failure;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      const failure = new Error("备份服务器地址只支持 http:// 或 https://");
      failure.reason = "invalid-url";
      throw failure;
    }
    if (!parsed.hostname) {
      const failure = new Error("备份服务器地址缺少主机名或 IP");
      failure.reason = "invalid-url";
      throw failure;
    }

    parsed.search = "";
    parsed.hash = "";
    let path = parsed.pathname.replace(/\/+$/, "");
    if (!/\/api\/backup$/i.test(path)) {
      path = `${path}${BACKUP_PATH}`;
    }
    const origin = `${parsed.protocol}//${parsed.host}`;
    return {
      backupUrl: `${origin}${path}`,
      healthUrl: `${origin}${path.replace(/\/api\/backup$/i, HEALTH_PATH)}`,
      rootHealthUrl: `${origin}${HEALTH_PATH}`,
      host: parsed.host,
    };
  }

  /** 同一版本的备份服务在 /health 上返回的标识。 */
  function isBackupServicePayload(payload) {
    return Boolean(
      payload &&
        typeof payload === "object" &&
        (payload.service === "anime-vault-backup" || payload.ok === true)
    );
  }

  /** HTTPS 页面无法请求 http:// 地址，提前给出明确原因。 */
  function mixedContentReason(targetUrl, pageProtocol) {
    if (pageProtocol === "https:" && /^http:\/\//i.test(targetUrl)) {
      return "当前页面使用 HTTPS，浏览器会拦截对 http:// 备份服务器的请求。请改用 https:// 地址，或通过 http://127.0.0.1 访问 Anime Vault 后再试。";
    }
    return "";
  }

  function networkFailureMessage(endpoints) {
    return (
      `无法连接到 ${endpoints.host}：请确认备份服务器已启动、地址和端口正确、` +
      "防火墙或安全组已放行，并且备份服务允许跨域访问（Access-Control-Allow-Origin）。"
    );
  }

  function formatExportedAt(epochSeconds) {
    const value = Number(epochSeconds);
    if (!Number.isFinite(value) || value <= 0) {
      return "";
    }
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const pad = (number) => String(number).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  function describeHttpError(status) {
    if (status === 401) {
      return "令牌无效：备份服务器拒绝了该访问令牌（401）。请核对令牌与启动备份服务器时的 --token / BACKUP_TOKEN 是否完全一致。";
    }
    if (status === 403) {
      return "备份服务器拒绝访问（403）。请确认令牌权限或反向代理的访问控制配置。";
    }
    if (status === 405) {
      return "备份服务器不允许该请求方法（405）。请确认地址指向的是 /api/backup 接口。";
    }
    if (status === 413) {
      return "备份数据超过服务器允许的大小（413）。请检查备份服务端的 MAX_BACKUP_BYTES 限制。";
    }
    if (status >= 500) {
      return `备份服务器内部错误（HTTP ${status}）。请查看备份服务器日志。`;
    }
    return `备份服务器返回了未预期的状态码（HTTP ${status}）。`;
  }

  /**
   * 带超时的 JSON 请求。
   * 失败时抛出带 reason 字段的错误：timeout / network。
   */
  async function requestJson(url, options) {
    const settings = options || {};
    const fetchImpl = settings.fetchImpl;
    const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : 0;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timedOut = false;
    let timer = null;

    if (controller && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method: settings.method || "GET",
        headers: settings.headers || {},
        body: settings.body,
        cache: "no-store",
        redirect: "follow",
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      const failure = new Error(timedOut ? "请求超时" : collapseWhitespace(error && error.message));
      failure.reason = timedOut ? "timeout" : "network";
      failure.cause = error;
      throw failure;
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }

    let text = "";
    try {
      text = await response.text();
    } catch (error) {
      text = "";
    }

    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = null;
      }
    }

    return { response, status: response.status, ok: response.ok, text, payload };
  }

  function buildResult(status, message, extras) {
    const extra = extras || {};
    return {
      status,
      ok: status === "ok" || status === "empty",
      message,
      detail: extra.detail ? truncate(extra.detail) : "",
      badge: badgeText(status),
      level: badgeLevel(status),
      endpoints: extra.endpoints || null,
      health: extra.health || null,
      animeCount: Number.isInteger(extra.animeCount) ? extra.animeCount : null,
      exportedAt: Number.isFinite(Number(extra.exportedAt)) ? Number(extra.exportedAt) : null,
      checkedAt: Date.now(),
    };
  }

  /**
   * 探测 /health。只用于解释失败原因，失败不影响最终判定。
   * 返回 { reachable, isBackupService, status, payload } 或 null。
   */
  async function probeHealth(endpoints, options) {
    const settings = options || {};
    const candidates = [endpoints.healthUrl];
    if (endpoints.rootHealthUrl !== endpoints.healthUrl) {
      candidates.push(endpoints.rootHealthUrl);
    }
    for (const candidate of candidates) {
      try {
        const result = await requestJson(candidate, {
          fetchImpl: settings.fetchImpl,
          timeoutMs: Math.min(Number(settings.timeoutMs) || HEALTH_TIMEOUT_MS, HEALTH_TIMEOUT_MS),
        });
        if (result.ok) {
          return {
            url: candidate,
            reachable: true,
            isBackupService: isBackupServicePayload(result.payload),
            status: result.status,
            payload: result.payload,
          };
        }
      } catch (error) {
        // 继续尝试下一个候选地址；全部失败时返回“不可达”。
      }
    }
    return { url: endpoints.healthUrl, reachable: false, isBackupService: false, status: 0, payload: null };
  }

  /**
   * 检查备份服务器连通性和令牌。
   *
   * @param {{url: string, token: string, timeoutMs?: number,
   *          fetchImpl?: Function, pageProtocol?: string}} options
   * @returns {Promise<object>} 见 buildResult
   */
  async function checkConnection(options) {
    const settings = options || {};
    const fetchImpl = settings.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (typeof fetchImpl !== "function") {
      return buildResult("failed", "当前浏览器不支持 fetch，无法访问备份服务器。");
    }
    const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : DEFAULT_TEST_TIMEOUT_MS;

    let endpoints;
    try {
      endpoints = resolveEndpoints(settings.url);
    } catch (error) {
      return buildResult(error.reason === "empty-url" ? "idle" : "invalidUrl", error.message);
    }

    const token = collapseWhitespace(settings.token);
    if (!token) {
      return buildResult("noToken", "请填写备份服务器访问令牌（启动备份服务器时设置的 --token 值）。", { endpoints });
    }

    const blocked = mixedContentReason(endpoints.backupUrl, settings.pageProtocol);
    if (blocked) {
      return buildResult("blocked", blocked, { endpoints });
    }

    let probe;
    try {
      probe = await requestJson(endpoints.backupUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs,
        fetchImpl,
      });
    } catch (error) {
      if (error.reason === "timeout") {
        return buildResult(
          "timeout",
          `连接超时：${Math.round(timeoutMs / 1000)} 秒内没有收到 ${endpoints.host} 的响应。请确认地址和端口正确、服务器已启动，并且网络可以访问该主机。`,
          { endpoints, detail: error.message }
        );
      }
      const health = await probeHealth(endpoints, { fetchImpl, timeoutMs });
      const hint = health && health.reachable
        ? "服务器本身可以访问，但 /api/backup 接口请求失败：请确认地址以 /api/backup 结尾，并允许浏览器跨域访问。"
        : `${networkFailureMessage(endpoints)}如果浏览器控制台提示 CORS 或 Mixed Content，请按该提示调整地址或部署方式。`;
      return buildResult("unreachable", hint, { endpoints, health, detail: error.message });
    }

    if (probe.status === 401 || probe.status === 403) {
      return buildResult("unauthorized", describeHttpError(probe.status), {
        endpoints,
        detail: collapseWhitespace(probe.payload && probe.payload.error) || probe.text,
      });
    }

    if (probe.ok) {
      const payload = probe.payload;
      if (!payload || payload.format !== "anime-vault-backup") {
        return buildResult(
          "wrongService",
          `${endpoints.backupUrl} 可以访问，但返回的内容不是 Anime Vault 备份数据。请确认地址指向备份服务的 /api/backup 接口。`,
          { endpoints, detail: truncate(probe.text) }
        );
      }
      const animeCount = Array.isArray(payload.anime) ? payload.anime.length : 0;
      const exportedAt = Number(payload.exported_at);
      const when = formatExportedAt(exportedAt);
      return buildResult(
        "ok",
        `连接成功：令牌有效，云端已有备份（${animeCount} 部番剧${when ? `，备份时间 ${when}` : ""}）。`,
        { endpoints, animeCount, exportedAt }
      );
    }

    if (probe.status === 404) {
      // 404 有两种可能：令牌正确但云端还没有备份；或者地址路径不对。
      // 备份服务在“暂无备份”时返回 {"error": "No backup found"}，据此判定，
      // 这样即使备份服务没有 /health 接口也能给出正确结论。
      const bodyText =
        collapseWhitespace(probe.payload && probe.payload.error) || collapseWhitespace(probe.text);
      const noBackupYet = /no backup/i.test(bodyText);
      const health = await probeHealth(endpoints, { fetchImpl, timeoutMs });
      if (noBackupYet || (health && health.reachable && health.isBackupService)) {
        return buildResult(
          "empty",
          "连接成功：令牌有效，云端目前还没有备份记录。点击“上传备份”即可把本地馆藏保存到云端。",
          { endpoints, health, animeCount: 0 }
        );
      }
      return buildResult(
        "wrongPath",
        `服务器可以访问，但 ${endpoints.backupUrl} 返回 404。请确认地址以 /api/backup 结尾，且反向代理没有改写该路径。`,
        { endpoints, health, detail: bodyText }
      );
    }

    return buildResult("serverError", describeHttpError(probe.status), {
      endpoints,
      detail: collapseWhitespace(probe.payload && probe.payload.error) || probe.text,
    });
  }

  /** 上传前读取本地数据，用于统计和提示。 */
  async function loadLocalBackup(fetchImpl) {
    let result;
    try {
      result = await requestJson("/api/backup/export", {
        fetchImpl,
        timeoutMs: DEFAULT_TRANSFER_TIMEOUT_MS,
      });
    } catch (error) {
      const failure = new Error(
        error.reason === "timeout"
          ? "读取本地数据超时，请确认 Anime Vault 服务正在运行。"
          : "读取本地数据失败，请确认 Anime Vault 服务正在运行。"
      );
      failure.reason = "local";
      throw failure;
    }
    if (!result.ok) {
      const failure = new Error(
        (result.payload && result.payload.error) || "读取本地数据失败，请确认 Anime Vault 服务正在运行。"
      );
      failure.reason = "local";
      throw failure;
    }
    return { text: result.text, payload: result.payload };
  }

  /** 上传本地数据到备份服务器，返回统计信息。 */
  async function uploadBackup(options) {
    const settings = options || {};
    const fetchImpl = settings.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const endpoints = resolveEndpoints(settings.url);
    const token = collapseWhitespace(settings.token);
    if (!token) {
      const failure = new Error("请填写备份服务器访问令牌。");
      failure.reason = "config";
      throw failure;
    }
    const blocked = mixedContentReason(endpoints.backupUrl, settings.pageProtocol);
    if (blocked) {
      const failure = new Error(blocked);
      failure.reason = "blocked";
      throw failure;
    }

    const local = await loadLocalBackup(fetchImpl);
    const animeCount = local.payload && Array.isArray(local.payload.anime) ? local.payload.anime.length : 0;

    let remote;
    try {
      remote = await requestJson(endpoints.backupUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: local.text,
        timeoutMs: Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : DEFAULT_TRANSFER_TIMEOUT_MS,
        fetchImpl,
      });
    } catch (error) {
      if (error.reason === "timeout") {
        const failure = new Error(`上传超时：备份服务器在限定时间内没有响应，请检查网络后重试。`);
        failure.reason = "timeout";
        throw failure;
      }
      const failure = new Error(networkFailureMessage(endpoints));
      failure.reason = "network";
      throw failure;
    }

    if (!remote.ok) {
      const serverError = collapseWhitespace(remote.payload && remote.payload.error);
      const failure = new Error(
        serverError ? `${describeHttpError(remote.status)}（服务器提示：${truncate(serverError)}）` : describeHttpError(remote.status)
      );
      failure.reason = "remote";
      failure.status = remote.status;
      throw failure;
    }

    const updatedAt = formatExportedAt(remote.payload && remote.payload.updated_at);
    return {
      animeCount,
      updatedAt,
      message: `备份已上传：${animeCount} 部番剧${updatedAt ? `，云端时间 ${updatedAt}` : ""}。`,
    };
  }

  /** 从备份服务器下载备份并写入本地数据库。 */
  async function refreshFromBackup(options) {
    const settings = options || {};
    const fetchImpl = settings.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const endpoints = resolveEndpoints(settings.url);
    const token = collapseWhitespace(settings.token);
    if (!token) {
      const failure = new Error("请填写备份服务器访问令牌。");
      failure.reason = "config";
      throw failure;
    }
    const blocked = mixedContentReason(endpoints.backupUrl, settings.pageProtocol);
    if (blocked) {
      const failure = new Error(blocked);
      failure.reason = "blocked";
      throw failure;
    }

    let remote;
    try {
      remote = await requestJson(endpoints.backupUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : DEFAULT_TRANSFER_TIMEOUT_MS,
        fetchImpl,
      });
    } catch (error) {
      if (error.reason === "timeout") {
        const failure = new Error("下载超时：备份服务器在限定时间内没有响应，请检查网络后重试。");
        failure.reason = "timeout";
        throw failure;
      }
      const failure = new Error(networkFailureMessage(endpoints));
      failure.reason = "network";
      throw failure;
    }

    if (remote.status === 404) {
      const failure = new Error("云端还没有备份记录，请先点击“上传备份”。");
      failure.reason = "empty";
      throw failure;
    }
    if (remote.status === 401 || remote.status === 403) {
      const failure = new Error(describeHttpError(remote.status));
      failure.reason = "remote";
      failure.status = remote.status;
      throw failure;
    }
    if (!remote.ok) {
      const failure = new Error(
        collapseWhitespace(remote.payload && remote.payload.error) || describeHttpError(remote.status)
      );
      failure.reason = "remote";
      failure.status = remote.status;
      throw failure;
    }
    if (!remote.payload || remote.payload.format !== "anime-vault-backup") {
      const failure = new Error("云端返回的内容不是有效的 Anime Vault 备份，已取消刷新。");
      failure.reason = "remote";
      throw failure;
    }

    let local;
    try {
      local = await requestJson("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: remote.text,
        timeoutMs: DEFAULT_TRANSFER_TIMEOUT_MS,
        fetchImpl,
      });
    } catch (error) {
      const failure = new Error(
        error.reason === "timeout"
          ? "写入本地数据超时，请重试。"
          : "写入本地数据失败，请确认 Anime Vault 服务正在运行。"
      );
      failure.reason = "local";
      throw failure;
    }

    if (!local.ok) {
      const failure = new Error(
        collapseWhitespace(local.payload && local.payload.error) || "写入本地数据失败，备份格式可能不兼容。"
      );
      failure.reason = "local";
      throw failure;
    }

    const count = Number(local.payload && local.payload.anime_count);
    const animeCount = Number.isInteger(count) ? count : null;
    const when = formatExportedAt(remote.payload.exported_at);
    return {
      animeCount,
      exportedAt: remote.payload.exported_at,
      message: `已用云端数据刷新本地馆藏：${animeCount === null ? "导入完成" : `${animeCount} 部番剧`}${when ? `，备份时间 ${when}` : ""}。`,
    };
  }

  return {
    BACKUP_PATH,
    HEALTH_PATH,
    DEFAULT_TEST_TIMEOUT_MS,
    DEFAULT_TRANSFER_TIMEOUT_MS,
    STATES,
    badgeText,
    badgeLevel,
    resolveEndpoints,
    mixedContentReason,
    formatExportedAt,
    describeHttpError,
    checkConnection,
    uploadBackup,
    refreshFromBackup,
  };
});
