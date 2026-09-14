const searchInput = document.getElementById("searchInput");
const posterGrid = document.getElementById("posterGrid");
const visibleCount = document.getElementById("visibleCount");
const emptyState = document.getElementById("emptyState");

const backupServerUrl = document.getElementById("backupServerUrl");
const backupServerToken = document.getElementById("backupServerToken");
const backupMessage = document.querySelector("[data-backup-message]");
const backupStateNodes = document.querySelectorAll("[data-backup-state]");
const backupTest = document.querySelector("[data-backup-test]");
const backupUpload = document.querySelector("[data-backup-upload]");
const backupRefresh = document.querySelector("[data-backup-refresh]");

/* 备份逻辑放在 backup-client.js。正常情况下 index.html 已经用 defer 先加载它；
 * 这里再兜底一次，避免页面 HTML 是旧版本（没有 script 标签）时整个面板失去响应。 */
const loadBackupClient = () =>
  window.AnimeVaultBackup
    ? Promise.resolve(window.AnimeVaultBackup)
    : new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "/static/backup-client.js";
        script.addEventListener("load", () => resolve(window.AnimeVaultBackup || null), { once: true });
        script.addEventListener("error", () => resolve(null), { once: true });
        document.head.appendChild(script);
      });

if (backupServerUrl instanceof HTMLInputElement && backupServerToken instanceof HTMLInputElement) {
  void loadBackupClient().then((backupApi) => {
    if (!backupApi) {
      setBackupMessageForMissingClient();
      return;
    }
    setUpBackupPanel(backupApi);
  });
}

const setBackupMessageForMissingClient = () => {
  if (backupMessage instanceof HTMLElement) {
    backupMessage.textContent =
      "备份脚本 /static/backup-client.js 加载失败，请刷新页面；如果仍然失败，请重启 python3 app.py。";
    backupMessage.dataset.state = "error";
  }
};

function setUpBackupPanel(backupApi) {
  const BACKUP_URL_KEY = "anime-vault-backup-url";
  const BACKUP_TOKEN_KEY = "anime-vault-backup-token";
  const SAVE_DEBOUNCE_MS = 400;
  const RELOAD_DELAY_MS = 1500;

  const backupButtons = [backupTest, backupUpload, backupRefresh].filter(
    (button) => button instanceof HTMLButtonElement
  );
  backupButtons.forEach((button) => {
    button.dataset.label = button.textContent;
  });

  let saveTimer = null;
  let checkSequence = 0;

  backupServerUrl.value = localStorage.getItem(BACKUP_URL_KEY) || "";
  backupServerToken.value = localStorage.getItem(BACKUP_TOKEN_KEY) || "";

  const readBackupConfig = () => ({
    url: backupServerUrl.value.trim(),
    token: backupServerToken.value.trim(),
    pageProtocol: window.location.protocol,
  });

  const saveBackupConfig = () => {
    localStorage.setItem(BACKUP_URL_KEY, backupServerUrl.value.trim());
    localStorage.setItem(BACKUP_TOKEN_KEY, backupServerToken.value.trim());
  };

  const scheduleBackupSave = () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      saveBackupConfig();
    }, SAVE_DEBOUNCE_MS);
  };

  /* 徽标同时出现在面板标题和面板内部，收起时也能看到连接状态。 */
  const setBackupState = (status) => {
    const text = backupApi.badgeText(status);
    const level = backupApi.badgeLevel(status);
    backupStateNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        node.textContent = text;
        node.dataset.state = level;
      }
    });
  };

  const setBackupMessage = (message, state = "info") => {
    if (backupMessage instanceof HTMLElement) {
      backupMessage.textContent = message;
      backupMessage.dataset.state = state;
    }
  };

  const setBackupBusy = (activeButton, busyLabel) => {
    backupButtons.forEach((button) => {
      button.disabled = Boolean(activeButton);
      button.textContent = button === activeButton ? busyLabel : button.dataset.label;
    });
  };

  /* 把操作失败的 reason 映射成徽标状态和提示语气。 */
  const describeBackupFailure = (error) => {
    const reason = error && error.reason;
    if (reason === "empty-url") return { status: "idle", state: "warning", hint: false };
    if (reason === "invalid-url" || reason === "invalidUrl") return { status: "invalidUrl", state: "warning", hint: false };
    if (reason === "config") return { status: "noToken", state: "warning", hint: false };
    if (reason === "blocked") return { status: "blocked", state: "error", hint: false };
    if (reason === "timeout") return { status: "timeout", state: "error", hint: true };
    if (reason === "network") return { status: "unreachable", state: "error", hint: true };
    if (reason === "empty") return { status: "empty", state: "warning", hint: false };
    if (reason === "local") return { status: null, state: "error", hint: false };
    if (reason === "remote") {
      const unauthorized = error.status === 401 || error.status === 403;
      return { status: unauthorized ? "unauthorized" : "serverError", state: "error", hint: !unauthorized };
    }
    return { status: "failed", state: "error", hint: true };
  };

  const reportBackupFailure = (error) => {
    const outcome = describeBackupFailure(error);
    const message = error && error.message ? error.message : "操作失败，请重试。";
    if (outcome.status) {
      setBackupState(outcome.status);
    }
    setBackupMessage(outcome.hint ? `${message} 也可以点击“测试连接”查看详细原因。` : message, outcome.state);
  };

  /* 检查连接：以带令牌访问 /api/backup 的真实结果为准。 */
  const runBackupCheck = async () => {
    const config = readBackupConfig();
    if (!config.url || !config.token) {
      setBackupState("idle");
      setBackupMessage("请先填写备份服务器地址和访问令牌，然后点击“测试连接”。", "warning");
      return null;
    }
    const sequence = ++checkSequence;
    setBackupState("checking");
    setBackupMessage("正在检查与备份服务器的连接…", "pending");
    const result = await backupApi.checkConnection(config);
    if (sequence !== checkSequence) {
      return null; /* 已经有更新的检查在进行，丢弃过期结果 */
    }
    setBackupState(result.status);
    const detail = result.detail && result.detail !== result.message ? `（${result.detail}）` : "";
    const state = result.ok ? "success" : result.level === "error" ? "error" : "warning";
    setBackupMessage(`${result.message}${detail}`, state);
    return result;
  };

  backupServerUrl.addEventListener("input", scheduleBackupSave);
  backupServerToken.addEventListener("input", scheduleBackupSave);
  backupServerUrl.addEventListener("change", () => {
    saveBackupConfig();
    void runBackupCheck();
  });
  backupServerToken.addEventListener("change", () => {
    saveBackupConfig();
    void runBackupCheck();
  });

  backupTest?.addEventListener("click", async () => {
    saveBackupConfig();
    setBackupBusy(backupTest, "检测中…");
    try {
      await runBackupCheck();
    } catch (error) {
      setBackupState("failed");
      setBackupMessage(error && error.message ? `检测失败：${error.message}` : "检测失败，请重试。", "error");
    } finally {
      setBackupBusy(null);
    }
  });

  backupUpload?.addEventListener("click", async () => {
    saveBackupConfig();
    setBackupBusy(backupUpload, "上传中…");
    setBackupState("checking");
    setBackupMessage("正在读取本地数据并上传到备份服务器…", "pending");
    try {
      const result = await backupApi.uploadBackup(readBackupConfig());
      setBackupState("ok");
      setBackupMessage(result.message, "success");
    } catch (error) {
      reportBackupFailure(error);
    } finally {
      setBackupBusy(null);
    }
  });

  backupRefresh?.addEventListener("click", async () => {
    saveBackupConfig();
    setBackupBusy(backupRefresh, "刷新中…");
    setBackupState("checking");
    setBackupMessage("正在从备份服务器下载数据并覆盖本地馆藏…", "pending");
    let reloading = false;
    try {
      const result = await backupApi.refreshFromBackup(readBackupConfig());
      setBackupState("ok");
      setBackupMessage(`${result.message} 页面即将重新加载…`, "success");
      reloading = true;
      window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    } catch (error) {
      reportBackupFailure(error);
    } finally {
      if (!reloading) {
        setBackupBusy(null);
      }
    }
  });

  /* 打开首页时自动检查一次，让连接状态无需手动操作即可见。 */
  if (backupServerUrl.value.trim() && backupServerToken.value.trim()) {
    void runBackupCheck();
  } else {
    setBackupState("idle");
  }
}

document.querySelectorAll("[data-copy-subscription]").forEach((button) => {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const originalLabel = button.textContent;
  let resetTimer;

  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Clipboard copy failed");
    }
  };

  button.addEventListener("click", async () => {
    const value = button.dataset.copyValue || "";
    if (!value) {
      return;
    }

    window.clearTimeout(resetTimer);
    try {
      await copyText(value);
      button.textContent = "已复制 Animeko 订阅";
      resetTimer = window.setTimeout(() => {
        button.textContent = originalLabel;
      }, 1800);
    } catch {
      button.textContent = "复制失败，请手动复制";
      resetTimer = window.setTimeout(() => {
        button.textContent = originalLabel;
      }, 2400);
    }
  });
});

document.querySelectorAll("[data-delete-form]").forEach((form) => {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  form.addEventListener("submit", (event) => {
    const title = form.dataset.animeTitle || "这部番剧";
    if (!window.confirm(`确定删除“${title}”吗？删除后不可恢复。`)) {
      event.preventDefault();
    }
  });
});

if (searchInput && posterGrid && visibleCount && emptyState) {
  const cards = Array.from(posterGrid.querySelectorAll(".poster-card"));

  const updateFilter = () => {
    const keyword = searchInput.value.trim().toLowerCase();
    let visible = 0;

    cards.forEach((card) => {
      const matched = card.dataset.search?.includes(keyword) ?? false;
      card.hidden = !matched;
      if (matched) {
        visible += 1;
      }
    });

    visibleCount.textContent = String(visible);
    emptyState.hidden = visible !== 0;
  };

  searchInput.addEventListener("input", updateFilter);
  updateFilter();

  const prefetched = new Set();
  cards.forEach((card) => {
    const link = card.querySelector("a");
    if (!link) {
      return;
    }

    const prefetch = () => {
      if (prefetched.has(link.href)) {
        return;
      }

      const hint = document.createElement("link");
      hint.rel = "prefetch";
      hint.href = link.href;
      document.head.appendChild(hint);
      prefetched.add(link.href);
    };

    card.addEventListener("mouseenter", prefetch, { once: true });
    card.addEventListener("focusin", prefetch, { once: true });
  });
}

const playbackForm = document.querySelector("[data-playback-form]");

if (playbackForm instanceof HTMLFormElement) {
  const playbackInput = playbackForm.querySelector("[data-playback-input]");
  const editToggle = playbackForm.querySelector("[data-edit-toggle]");
  const saveButton = playbackForm.querySelector("[data-save-button]");

  if (
    playbackInput instanceof HTMLInputElement &&
    editToggle instanceof HTMLButtonElement &&
    saveButton instanceof HTMLButtonElement
  ) {
    let editing = false;

    const syncEditingState = () => {
      playbackForm.dataset.editing = editing ? "true" : "false";
      playbackInput.readOnly = !editing;
      editToggle.setAttribute("aria-pressed", editing ? "true" : "false");
      editToggle.classList.toggle("is-active", editing);
      saveButton.disabled = !editing;

      if (editing) {
        playbackInput.focus();
        playbackInput.setSelectionRange(
          playbackInput.value.length,
          playbackInput.value.length,
        );
      } else {
        playbackInput.blur();
      }
    };

    const openPlaybackUrl = () => {
      const targetUrl = playbackInput.value.trim();
      const trackingUrl = playbackForm.dataset.playbackOpenUrl;
      if (!targetUrl || !trackingUrl) {
        return;
      }
      window.open(trackingUrl, "_blank", "noopener,noreferrer");
    };

    editToggle.addEventListener("click", () => {
      editing = !editing;
      syncEditingState();
    });

    playbackInput.addEventListener("click", (event) => {
      if (editing) {
        return;
      }
      event.preventDefault();
      openPlaybackUrl();
    });

    playbackInput.addEventListener("keydown", (event) => {
      if (editing) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPlaybackUrl();
      }
    });

    playbackForm.addEventListener("submit", () => {
      editing = false;
    });

    syncEditingState();
  }
}

const episodesPanel = document.querySelector("[data-episodes-panel]");

if (episodesPanel instanceof HTMLElement) {
  const configToggle = episodesPanel.querySelector("[data-episodes-config-toggle]");
  const configForm = episodesPanel.querySelector("[data-episodes-config-form]");

  if (
    configToggle instanceof HTMLButtonElement &&
    configForm instanceof HTMLFormElement
  ) {
    const syncConfigState = (open) => {
      configForm.hidden = !open;
      configToggle.setAttribute("aria-expanded", open ? "true" : "false");
      configToggle.classList.toggle("is-active", open);
    };

    syncConfigState(false);
    configToggle.addEventListener("click", () => {
      syncConfigState(configForm.hidden);
    });
  }
}

const supportedImageExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
]);

const imageUploads = document.querySelectorAll("[data-image-upload]");

imageUploads.forEach((upload) => {
  const dropzone = upload.querySelector("[data-upload-dropzone]");
  const input = upload.querySelector("[data-upload-input]");
  const fileStatus = upload.querySelector("[data-upload-file]");
  const preview = upload.querySelector("[data-upload-preview]");
  const previewImage = upload.querySelector("[data-upload-preview-image]");

  if (
    !(dropzone instanceof HTMLElement) ||
    !(input instanceof HTMLInputElement) ||
    !(fileStatus instanceof HTMLElement) ||
    !(preview instanceof HTMLElement) ||
    !(previewImage instanceof HTMLImageElement)
  ) {
    return;
  }

  let previewUrl = "";

  const revokePreview = () => {
    if (!previewUrl) {
      return;
    }
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  };

  const clearPreview = () => {
    revokePreview();
    preview.hidden = true;
    previewImage.removeAttribute("src");
  };

  const isSupportedImage = (file) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return supportedImageExtensions.has(extension);
  };

  const syncSelectedFile = (file) => {
    if (!file) {
      fileStatus.textContent = "未选择文件";
      dropzone.dataset.state = "idle";
      clearPreview();
      return;
    }

    if (!isSupportedImage(file)) {
      input.value = "";
      fileStatus.textContent = "文件格式不支持，请选择常见图片格式。";
      dropzone.dataset.state = "error";
      clearPreview();
      return;
    }

    fileStatus.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    dropzone.dataset.state = "selected";
    revokePreview();
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    preview.hidden = false;
  };

  const applyFiles = (fileList) => {
    const [file] = Array.from(fileList);
    if (!file) {
      syncSelectedFile(null);
      return;
    }

    if (typeof DataTransfer === "function") {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }

    syncSelectedFile(file);
  };

  input.addEventListener("change", () => {
    applyFiles(input.files ?? []);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.dataset.dragging = "true";
    });
  });

  ["dragleave", "dragend", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => {
      dropzone.dataset.dragging = "false";
    });
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    applyFiles(event.dataTransfer?.files ?? []);
  });

  window.addEventListener("beforeunload", revokePreview);
  syncSelectedFile(input.files?.[0] ?? null);
});


const syncResourceTypeControls = (form) => {
  const controls = Array.from(form.querySelectorAll("[data-resource-type]"));
  if (!controls.length) {
    return;
  }

  const sync = () => {
    const selected = controls.find((control) =>
      control instanceof HTMLInputElement && control.checked
    );
    const playlistSelected = selected instanceof HTMLInputElement && selected.value === "playlist";
    const urlListSelected = selected instanceof HTMLInputElement && selected.value === "url_list";
    form.querySelectorAll("[data-resource-link]").forEach((field) => {
      field.hidden = playlistSelected || urlListSelected;
    });
    form.querySelectorAll("[data-resource-playlist]").forEach((field) => {
      field.hidden = !playlistSelected;
    });
    form.querySelectorAll("[data-resource-url-list]").forEach((field) => {
      field.hidden = !urlListSelected;
    });
    form.querySelectorAll("[data-resource-import-offset]").forEach((field) => {
      field.hidden = !(playlistSelected || urlListSelected);
    });
  };

  controls.forEach((control) => control.addEventListener("change", sync));
  sync();
};

document.querySelectorAll("form").forEach((form) => syncResourceTypeControls(form));

document.querySelectorAll("[data-playlist-dropzone]").forEach((dropzone) => {
  const input = dropzone.querySelector("[data-playlist-input]");
  const status = dropzone.querySelector("[data-playlist-status]");
  if (!(input instanceof HTMLInputElement) || !(status instanceof HTMLElement)) {
    return;
  }

  const applyFile = (file) => {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".m3u8")) {
      input.value = "";
      status.textContent = "文件格式不支持，请选择 .m3u8 文件。";
      dropzone.dataset.state = "error";
      return;
    }
    status.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    dropzone.dataset.state = "selected";
  };

  input.addEventListener("change", () => applyFile(input.files?.[0]));
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.dataset.dragging = "true";
    });
  });
  ["dragleave", "dragend", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => {
      dropzone.dataset.dragging = "false";
    });
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    if (typeof DataTransfer === "function") {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
    applyFile(file);
  });
});


const syncPlaybackModeControls = (container) => {
  const modeControls = Array.from(container.querySelectorAll("[data-playback-mode]"));
  if (!modeControls.length) {
    return;
  }

  const getMode = () => {
    const checkedRadio = modeControls.find((control) => control instanceof HTMLInputElement && control.type === "radio" && control.checked);
    if (checkedRadio instanceof HTMLInputElement) {
      return checkedRadio.value;
    }
    const select = modeControls.find((control) => control instanceof HTMLSelectElement);
    if (select instanceof HTMLSelectElement) {
      return select.value;
    }
    return "online";
  };

  const sync = () => {
    const localMode = getMode() === "local";
    container.querySelectorAll("[data-online-config]").forEach((field) => {
      field.hidden = localMode;
    });
    container.querySelectorAll("[data-local-config]").forEach((field) => {
      field.hidden = !localMode;
    });
  };

  modeControls.forEach((control) => control.addEventListener("change", sync));
  sync();
};

document.querySelectorAll("form").forEach((form) => syncPlaybackModeControls(form));

const localPlayer = document.querySelector("[data-local-player]");

if (localPlayer instanceof HTMLElement) {
  const video = localPlayer.querySelector("[data-local-video]");
  const stage = localPlayer.querySelector("[data-local-player-stage]");
  const title = localPlayer.querySelector("[data-local-player-title]");
  const lastPlayedValue = document.querySelector("[data-last-played-value]");
  const episodeLinks = Array.from(document.querySelectorAll("[data-local-episode]"));
  const toggleButtons = Array.from(localPlayer.querySelectorAll("[data-player-toggle]"));
  const seekInput = localPlayer.querySelector("[data-player-seek]");
  const currentTimeText = localPlayer.querySelector("[data-player-current]");
  const durationText = localPlayer.querySelector("[data-player-duration]");
  const volumeInput = localPlayer.querySelector("[data-player-volume]");
  const volumeIcon = localPlayer.querySelector("[data-player-volume-icon]");
  const speedSelect = localPlayer.querySelector("[data-player-speed]");
  const fullscreenButton = localPlayer.querySelector("[data-player-fullscreen]");
  const prevButton = localPlayer.querySelector("[data-player-prev]");
  const nextButton = localPlayer.querySelector("[data-player-next]");
  const mpvLink = localPlayer.querySelector("[data-mpv-link]");

  if (video instanceof HTMLVideoElement) {
    const formatTime = (seconds) => {
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return "00:00";
      }
      const wholeSeconds = Math.floor(seconds);
      const hours = Math.floor(wholeSeconds / 3600);
      const minutes = Math.floor((wholeSeconds % 3600) / 60);
      const secs = wholeSeconds % 60;
      const paddedMinutes = String(minutes).padStart(2, "0");
      const paddedSeconds = String(secs).padStart(2, "0");
      return hours > 0
        ? `${hours}:${paddedMinutes}:${paddedSeconds}`
        : `${paddedMinutes}:${paddedSeconds}`;
    };

    const setRangeProgress = (input, value) => {
      if (input instanceof HTMLInputElement) {
        input.style.setProperty("--progress", `${Math.max(0, Math.min(1, value)) * 100}%`);
      }
    };

    const activeEpisodeIndex = () => episodeLinks.findIndex((link) =>
      link.classList.contains("episode-card--active"),
    );

    const activeEpisodeLink = () => {
      const activeIndex = activeEpisodeIndex();
      const activeLink = episodeLinks[activeIndex];
      return activeLink instanceof HTMLAnchorElement ? activeLink : null;
    };

    const parseProgressNumber = (value) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : 0;
    };

    const readLinkProgress = (link) => ({
      position: parseProgressNumber(link.dataset.progressPosition),
      duration: parseProgressNumber(link.dataset.progressDuration),
      completed: link.dataset.progressCompleted === "1",
    });

    const progressLabelFor = (position, completed) => {
      if (completed) {
        return "已看完";
      }
      if (position > 0) {
        return `看到 ${formatTime(position)}`;
      }
      return "";
    };

    const writeLinkProgress = (link, position, duration, completed) => {
      link.dataset.progressPosition = String(Math.max(0, position));
      link.dataset.progressDuration = String(Math.max(0, duration));
      link.dataset.progressCompleted = completed ? "1" : "0";
      const progressLabel = link.querySelector("[data-progress-label]");
      if (progressLabel instanceof HTMLElement) {
        const labelText = progressLabelFor(position, completed);
        progressLabel.textContent = labelText;
        progressLabel.hidden = !labelText;
      }
    };

    const syncEpisodeButtons = () => {
      const activeIndex = activeEpisodeIndex();
      if (prevButton instanceof HTMLButtonElement) {
        prevButton.disabled = activeIndex <= 0;
      }
      if (nextButton instanceof HTMLButtonElement) {
        nextButton.disabled = episodeLinks.length === 0 || activeIndex >= episodeLinks.length - 1;
      }
    };

    const syncPlaybackButtons = () => {
      const playing = !video.paused && !video.ended;
      toggleButtons.forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) {
          return;
        }
        button.textContent = playing ? "暂停" : "▶";
        button.setAttribute("aria-label", playing ? "暂停" : "播放");
      });
      localPlayer.dataset.playing = playing ? "true" : "false";
      showPlayerControls({ persistent: !playing });
    };

    const syncTime = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const progress = duration > 0 ? video.currentTime / duration : 0;
      if (currentTimeText instanceof HTMLElement) {
        currentTimeText.textContent = formatTime(video.currentTime);
      }
      if (durationText instanceof HTMLElement) {
        durationText.textContent = formatTime(duration);
      }
      if (seekInput instanceof HTMLInputElement) {
        seekInput.value = String(Math.round(progress * Number(seekInput.max || 1000)));
        setRangeProgress(seekInput, progress);
      }
    };

    const syncVolume = () => {
      const volume = video.muted ? 0 : video.volume;
      if (volumeInput instanceof HTMLInputElement) {
        volumeInput.value = String(volume);
        setRangeProgress(volumeInput, volume);
      }
      if (volumeIcon instanceof HTMLElement) {
        volumeIcon.textContent = volume === 0 ? "静音" : "音量";
      }
    };

    let controlsHideTimer = 0;

    const setControlsVisible = (visible) => {
      localPlayer.dataset.controlsVisible = visible ? "true" : "false";
    };

    const queueControlsHide = () => {
      window.clearTimeout(controlsHideTimer);
      if (video.paused || video.ended) {
        setControlsVisible(true);
        return;
      }
      controlsHideTimer = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2200);
    };

    const showPlayerControls = ({ persistent = false } = {}) => {
      window.clearTimeout(controlsHideTimer);
      setControlsVisible(true);
      if (!persistent) {
        queueControlsHide();
      }
    };

    const progressUrl = localPlayer.dataset.progressUrl || "";
    let pendingResumeTime = null;
    let saveProgressTimer = 0;
    let lastSavedAt = 0;
    let currentEpisodeLoaded = false;
    let watchedSeconds = 0;
    let lastPlaybackSample = null;

    const normalizedProgress = (completed = false) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      let position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const finished = completed || (duration > 0 && position >= Math.max(0, duration - 2));
      if (finished && duration > 0) {
        position = duration;
      }
      return { position, duration, completed: finished };
    };

    const persistProgress = ({ completed = false, immediate = false } = {}) => {
      const link = activeEpisodeLink();
      if (!link || !progressUrl) {
        return;
      }
      if (!currentEpisodeLoaded && !completed) {
        return;
      }

      const episodeNumber = link.getAttribute("data-episode-number") || "";
      if (!episodeNumber) {
        return;
      }

      const progress = normalizedProgress(completed);
      writeLinkProgress(link, progress.position, progress.duration, progress.completed);
      window.clearTimeout(saveProgressTimer);

      const body = new URLSearchParams({
        episode_number: episodeNumber,
        position_seconds: progress.position.toFixed(3),
        duration_seconds: progress.duration.toFixed(3),
        watched_seconds: watchedSeconds.toFixed(3),
        completed: progress.completed ? "1" : "0",
      });

      const send = () => {
        lastSavedAt = Date.now();
        fetch(progressUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          keepalive: true,
        }).catch(() => {});
      };

      if (immediate) {
        send();
        return;
      }

      const elapsed = Date.now() - lastSavedAt;
      if (elapsed >= 5000) {
        send();
        return;
      }
      saveProgressTimer = window.setTimeout(send, Math.max(800, 5000 - elapsed));
    };

    const resumeTimeFor = (link) => {
      const progress = readLinkProgress(link);
      if (progress.completed) {
        return 0;
      }
      const duration = progress.duration || 0;
      if (duration > 0 && duration - progress.position <= 5) {
        return 0;
      }
      return progress.position > 3 ? progress.position : 0;
    };

    const applyPendingResume = () => {
      if (pendingResumeTime === null) {
        return;
      }
      const resumeTime = pendingResumeTime;
      pendingResumeTime = null;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (resumeTime > 0 && duration > 0) {
        video.currentTime = Math.min(resumeTime, Math.max(0, duration - 2));
      }
      syncTime();
    };

    const playEpisode = (link, options = {}) => {
      persistProgress({ immediate: true });
      const episodeNumber = link.getAttribute("data-episode-number") || "";
      const episodeTitle = link.getAttribute("data-episode-title") || `第 ${episodeNumber} 集`;
      episodeLinks.forEach((item) => item.classList.remove("episode-card--active"));
      link.classList.add("episode-card--active");
      if (title instanceof HTMLElement) {
        title.textContent = episodeTitle;
      }
      if (lastPlayedValue instanceof HTMLElement) {
        lastPlayedValue.textContent = episodeNumber || "未播放";
      }
      if (mpvLink instanceof HTMLAnchorElement) {
        mpvLink.href = link.href.replace("/local-episode/", "/mpv-playlist/");
        mpvLink.hidden = false;
      }
      localPlayer.hidden = false;
      pendingResumeTime = options.resume === false ? null : resumeTimeFor(link);
      currentEpisodeLoaded = false;
      lastPlaybackSample = null;
      video.src = link.href;
      video.load();
      syncEpisodeButtons();
      syncTime();
      showPlayerControls();
      video.play().catch(() => {});
      if (stage instanceof HTMLElement) {
        stage.focus({ preventScroll: true });
      }
      if (options.scroll !== false) {
        localPlayer.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    const togglePlayback = () => {
      if (!video.currentSrc && episodeLinks[0] instanceof HTMLAnchorElement) {
        playEpisode(episodeLinks[0]);
        return;
      }
      if (video.paused || video.ended) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    const playRelativeEpisode = (offset) => {
      const activeIndex = activeEpisodeIndex();
      const targetIndex = activeIndex === -1 && offset > 0 ? 0 : activeIndex + offset;
      const targetLink = episodeLinks[targetIndex];
      if (targetLink instanceof HTMLAnchorElement) {
        playEpisode(targetLink, { scroll: false });
      }
    };

    episodeLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        playEpisode(link);
      });
    });

    toggleButtons.forEach((button) => {
      button.addEventListener("click", togglePlayback);
    });

    video.addEventListener("click", togglePlayback);

    if (mpvLink instanceof HTMLAnchorElement) {
      mpvLink.addEventListener("click", (event) => {
        if (mpvLink.hidden || mpvLink.getAttribute("href") === "#") {
          event.preventDefault();
        }
      });
    }

    if (seekInput instanceof HTMLInputElement) {
      seekInput.addEventListener("input", () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const max = Number(seekInput.max || 1000);
        const ratio = max > 0 ? Number(seekInput.value) / max : 0;
        if (duration > 0) {
          video.currentTime = ratio * duration;
        }
        setRangeProgress(seekInput, ratio);
      });
    }

    if (volumeInput instanceof HTMLInputElement) {
      volumeInput.addEventListener("input", () => {
        const volume = Number(volumeInput.value);
        video.volume = Math.max(0, Math.min(1, volume));
        video.muted = video.volume === 0;
        syncVolume();
      });
    }

    if (speedSelect instanceof HTMLSelectElement) {
      speedSelect.addEventListener("change", () => {
        video.playbackRate = Number(speedSelect.value) || 1;
      });
    }

    if (prevButton instanceof HTMLButtonElement) {
      prevButton.addEventListener("click", () => playRelativeEpisode(-1));
    }

    if (nextButton instanceof HTMLButtonElement) {
      nextButton.addEventListener("click", () => playRelativeEpisode(1));
    }

    if (fullscreenButton instanceof HTMLButtonElement && stage instanceof HTMLElement) {
      fullscreenButton.addEventListener("click", () => {
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
          return;
        }
        if (stage.requestFullscreen) {
          stage.requestFullscreen().catch(() => {});
        } else if (typeof video.webkitEnterFullscreen === "function") {
          video.webkitEnterFullscreen();
        }
      });
    }

    if (stage instanceof HTMLElement) {
      ["mousemove", "pointermove", "focusin"].forEach((eventName) => {
        stage.addEventListener(eventName, () => showPlayerControls());
      });
      stage.addEventListener("touchstart", () => showPlayerControls(), { passive: true });
      stage.addEventListener("mouseleave", () => queueControlsHide());
      stage.addEventListener("keydown", (event) => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLSelectElement) {
          return;
        }
        showPlayerControls();
        if (event.key === " " || event.key.toLowerCase() === "k") {
          event.preventDefault();
          togglePlayback();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          persistProgress();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          video.currentTime = Math.min(video.duration || video.currentTime + 5, video.currentTime + 5);
          persistProgress();
        } else if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          fullscreenButton?.click();
        } else if (event.key.toLowerCase() === "m") {
          event.preventDefault();
          video.muted = !video.muted;
          syncVolume();
        }
      });
    }

    video.addEventListener("loadedmetadata", () => {
      currentEpisodeLoaded = true;
      applyPendingResume();
      syncTime();
    });
    video.addEventListener("timeupdate", () => {
      if (!video.paused && !video.seeking && Number.isFinite(video.currentTime)) {
        if (lastPlaybackSample !== null) {
          const delta = video.currentTime - lastPlaybackSample;
          if (delta > 0 && delta <= 4) {
            watchedSeconds += delta;
          }
        }
        lastPlaybackSample = video.currentTime;
      }
      syncTime();
      persistProgress();
    });
    video.addEventListener("durationchange", syncTime);
    video.addEventListener("play", () => {
      lastPlaybackSample = Number.isFinite(video.currentTime) ? video.currentTime : null;
      syncPlaybackButtons();
    });
    video.addEventListener("pause", () => {
      lastPlaybackSample = null;
      syncPlaybackButtons();
      persistProgress({ immediate: true });
    });
    video.addEventListener("seeking", () => {
      lastPlaybackSample = null;
    });
    video.addEventListener("seeked", () => {
      lastPlaybackSample = Number.isFinite(video.currentTime) ? video.currentTime : null;
      persistProgress({ immediate: true });
    });
    video.addEventListener("volumechange", syncVolume);
    video.addEventListener("ratechange", () => {
      if (speedSelect instanceof HTMLSelectElement) {
        speedSelect.value = String(video.playbackRate);
      }
    });

    video.addEventListener("ended", () => {
      persistProgress({ completed: true, immediate: true });
      const activeIndex = activeEpisodeIndex();
      const nextLink = episodeLinks[activeIndex + 1];
      if (nextLink instanceof HTMLAnchorElement) {
        playEpisode(nextLink, { scroll: false });
      } else {
        syncPlaybackButtons();
      }
    });

    window.addEventListener("beforeunload", () => {
      persistProgress({ immediate: true });
    });

    const initialLink = activeEpisodeLink();
    if (initialLink) {
      pendingResumeTime = resumeTimeFor(initialLink);
      if (video.readyState >= 1) {
        currentEpisodeLoaded = true;
        applyPendingResume();
      }
    }

    syncEpisodeButtons();
    syncPlaybackButtons();
    syncTime();
    syncVolume();
  }
}
