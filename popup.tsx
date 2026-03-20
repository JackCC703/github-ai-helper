import { useEffect, useState } from "react"

import { askAi, fetchDiff, testAiConnection } from "./lib/ai"
import {
  clearAiSettings,
  createDefaultAiSettings,
  getApiOriginPattern,
  hasRequiredAiSettings,
  loadAiSettings,
  maskApiKey,
  resolveAiApiUrl,
  sanitizeAiSettings,
  saveAiSettings,
  type AiSettings
} from "./lib/settings"

type ViewMode = "generate" | "settings"
type NoticeLevel = "success" | "error" | "info"
type Notice = {
  level: NoticeLevel
  text: string
}

type PermissionStatus = "checking" | "granted" | "missing" | "invalid"

const getPermissionStatusText = (status: PermissionStatus) => {
  switch (status) {
    case "granted":
      return "已授权"
    case "missing":
      return "未授权"
    case "invalid":
      return "地址无效"
    default:
      return "检查中"
  }
}

const getApiTargetLabel = (settings: AiSettings) => {
  try {
    return new URL(resolveAiApiUrl(settings)).origin
  } catch {
    return "未配置"
  }
}

const getNoticeStyle = (level: NoticeLevel) => {
  if (level === "success") {
    return {
      backgroundColor: "rgba(16, 185, 129, 0.14)",
      borderColor: "rgba(16, 185, 129, 0.4)",
      color: "#065f46"
    }
  }

  if (level === "error") {
    return {
      backgroundColor: "rgba(248, 113, 113, 0.16)",
      borderColor: "rgba(248, 113, 113, 0.45)",
      color: "#7f1d1d"
    }
  }

  return {
    backgroundColor: "rgba(56, 189, 248, 0.16)",
    borderColor: "rgba(56, 189, 248, 0.45)",
    color: "#0c4a6e"
  }
}

const getPrimaryButtonStyle = (disabled: boolean) => ({
  width: "100%",
  border: "none",
  borderRadius: 14,
  padding: "11px 14px",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 0.3,
  color: "#f8fafc",
  background: disabled
    ? "linear-gradient(140deg, #94a3b8 0%, #64748b 100%)"
    : "linear-gradient(140deg, #0f766e 0%, #0ea5e9 100%)",
  boxShadow: disabled ? "none" : "0 12px 24px rgba(14, 116, 144, 0.28)",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 180ms ease"
})

const getSecondaryButtonStyle = (disabled: boolean) => ({
  width: "100%",
  border: "1px solid rgba(15, 118, 110, 0.22)",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "#0f172a",
  backgroundColor: disabled ? "rgba(148, 163, 184, 0.14)" : "#ffffff",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 180ms ease"
})

const getTabButtonStyle = (active: boolean) => ({
  flex: 1,
  border: "none",
  borderRadius: 10,
  padding: "9px 8px",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.2,
  color: active ? "#ecfeff" : "#0f172a",
  background: active
    ? "linear-gradient(140deg, #155e75 0%, #2563eb 100%)"
    : "transparent",
  cursor: "pointer",
  transition: "all 180ms ease"
})

function IndexPopup() {
  const [activeView, setActiveView] = useState<ViewMode>("generate")
  const [settings, setSettings] = useState<AiSettings>(createDefaultAiSettings())
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>("checking")

  const [currentTabUrl, setCurrentTabUrl] = useState("")
  const [result, setResult] = useState("")
  const [loading, setLoading] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const updatePermissionStatus = async (nextSettings: AiSettings) => {
    if (!nextSettings.apiUrl.trim() && !nextSettings.baseUrl.trim()) {
      setPermissionStatus("missing")
      return false
    }

    let originPattern = ""

    try {
      originPattern = getApiOriginPattern(nextSettings)
    } catch {
      setPermissionStatus("invalid")
      return false
    }

    try {
      const granted = await chrome.permissions.contains({
        origins: [originPattern]
      })

      setPermissionStatus(granted ? "granted" : "missing")
      return granted
    } catch (error) {
      console.error("check permission failed:", error)
      setPermissionStatus("missing")
      return false
    }
  }

  const ensureApiPermission = async (
    nextSettings: AiSettings,
    requestIfMissing: boolean
  ) => {
    let originPattern = ""

    try {
      originPattern = getApiOriginPattern(nextSettings)
    } catch {
      setPermissionStatus("invalid")
      return false
    }

    try {
      const contains = await chrome.permissions.contains({
        origins: [originPattern]
      })

      if (contains) {
        setPermissionStatus("granted")
        return true
      }

      if (!requestIfMissing) {
        setPermissionStatus("missing")
        return false
      }

      const granted = await chrome.permissions.request({
        origins: [originPattern]
      })

      setPermissionStatus(granted ? "granted" : "missing")
      return granted
    } catch (error) {
      console.error("request permission failed:", error)
      setPermissionStatus("missing")
      return false
    }
  }

  useEffect(() => {
    let disposed = false

    const init = async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true
        })

        if (!disposed) {
          setCurrentTabUrl(tab?.url ?? "")
        }
      } catch (error) {
        console.error("read active tab failed:", error)
      }

      const loadedSettings = await loadAiSettings()

      if (disposed) return

      setSettings(loadedSettings)
      setSettingsLoaded(true)
      await updatePermissionStatus(loadedSettings)
    }

    void init()

    return () => {
      disposed = true
    }
  }, [])

  const handleGenerate = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab?.url) {
      setNotice({ level: "error", text: "没有找到当前页面，请刷新后再试。" })
      return
    }

    setCurrentTabUrl(tab.url)
    setNotice(null)
    setResult("")

    if (!hasRequiredAiSettings(settings)) {
      setActiveView("settings")
      setNotice({
        level: "error",
        text: "请先在设置页填写 API Key、接口地址和模型。"
      })
      return
    }

    const granted = await ensureApiPermission(settings, true)

    if (!granted) {
      setActiveView("settings")
      setNotice({
        level: "error",
        text: "尚未授权当前接口域名。请在设置页点击保存或授权后再试。"
      })
      return
    }

    setLoading(true)

    try {
      const diff = await fetchDiff(tab.url)

      if (!diff.ok) {
        setNotice({ level: "error", text: diff.message })
        return
      }

      const aiResult = await askAi(diff.content, settings)

      if (!aiResult.ok) {
        setNotice({ level: "error", text: aiResult.message })
        return
      }

      setResult(aiResult.content)
      setNotice({ level: "success", text: "PR 描述已生成，可直接粘贴回 GitHub。" })
    } finally {
      setLoading(false)
    }
  }

  const handlePaste = async () => {
    if (!result) return

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab?.id) {
      setNotice({ level: "error", text: "没有找到当前标签页。" })
      return
    }

    setPasting(true)

    try {
      const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [result],
        func: (content: string) => {
          const isVisibleInPage = (element: HTMLElement | null) =>
            Boolean(
              element &&
                (element.offsetWidth ||
                  element.offsetHeight ||
                  element.getClientRects().length)
            )

          const textareaSelectors = [
            "textarea#pull_request_body",
            "textarea[name='pull_request[body]']"
          ]

          const textarea =
            textareaSelectors
              .map((selector) =>
                document.querySelector<HTMLTextAreaElement>(selector)
              )
              .find((element) => Boolean(element && isVisibleInPage(element))) ??
            Array.from(
              document.querySelectorAll<HTMLTextAreaElement>("textarea")
            ).find((element) => {
              if (!isVisibleInPage(element)) return false

              const elementKey = `${element.id} ${element.name}`.toLowerCase()
              return (
                elementKey.includes("pull_request") &&
                elementKey.includes("body")
              )
            }) ??
            null

          if (!textarea) {
            return "没有找到 PR 描述输入框，请先打开 GitHub 的 PR 描述编辑框。"
          }

          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value"
          )?.set

          nativeSetter?.call(textarea, content)

          if (!nativeSetter) {
            textarea.value = content
          }

          textarea.dispatchEvent(new Event("input", { bubbles: true }))
          textarea.dispatchEvent(new Event("change", { bubbles: true }))
          textarea.focus()
          textarea.setSelectionRange(content.length, content.length)
          textarea.scrollIntoView({ behavior: "smooth", block: "center" })

          return "已粘贴到 GitHub PR 描述输入框。"
        }
      })

      setNotice({
        level: "success",
        text: injectionResult?.result ?? "粘贴完成。"
      })
    } catch (error) {
      console.error("paste failed:", error)
      setNotice({
        level: "error",
        text: "粘贴失败，请确认当前页面是 GitHub PR 页面且描述编辑框已展开。"
      })
    } finally {
      setPasting(false)
    }
  }

  const handleSaveSettings = async () => {
    const sanitized = sanitizeAiSettings(settings)

    if (!hasRequiredAiSettings(sanitized)) {
      setNotice({
        level: "error",
        text: "请完整填写 API Key、模型、以及 Base URL 或 API URL。"
      })
      return
    }

    setSaving(true)

    try {
      await saveAiSettings(sanitized)
      setSettings(sanitized)

      const granted = await ensureApiPermission(sanitized, true)

      if (granted) {
        setNotice({
          level: "success",
          text: "配置已保存，并已授权接口域名。"
        })
      } else {
        setNotice({
          level: "info",
          text: "配置已保存，但接口域名尚未授权，生成时会失败。"
        })
      }
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    const sanitized = sanitizeAiSettings(settings)

    if (!hasRequiredAiSettings(sanitized)) {
      setNotice({
        level: "error",
        text: "请先填写完整配置再测试连接。"
      })
      return
    }

    const granted = await ensureApiPermission(sanitized, true)

    if (!granted) {
      setNotice({
        level: "error",
        text: "需要先授权该接口域名后才能测试连接。"
      })
      return
    }

    setTesting(true)

    try {
      const connectionResult = await testAiConnection(sanitized)

      if (!connectionResult.ok) {
        setNotice({ level: "error", text: connectionResult.message })
        return
      }

      setNotice({
        level: "success",
        text: `连接成功：${connectionResult.content.trim()}`
      })
    } finally {
      setTesting(false)
    }
  }

  const handleGrantPermission = async () => {
    const granted = await ensureApiPermission(settings, true)

    if (granted) {
      setNotice({ level: "success", text: "接口域名授权成功。" })
      return
    }

    setNotice({
      level: "error",
      text: "接口域名授权未通过，请重试或检查接口地址是否正确。"
    })
  }

  const handleClearSettings = async () => {
    await clearAiSettings()

    const nextSettings = createDefaultAiSettings()
    setSettings(nextSettings)
    setResult("")
    setNotice({ level: "info", text: "本地配置已清空。" })
    await updatePermissionStatus(nextSettings)
  }

  const endpointLabel = (() => {
    try {
      return resolveAiApiUrl(settings)
    } catch {
      return "地址无效"
    }
  })()

  return (
    <div
      style={{
        width: 376,
        minHeight: 560,
        padding: 16,
        color: "#0f172a",
        fontFamily:
          '"Avenir Next", "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif',
        background:
          "radial-gradient(circle at 8% 0%, rgba(14, 165, 233, 0.25), transparent 28%), radial-gradient(circle at 90% 10%, rgba(20, 184, 166, 0.18), transparent 30%), #f3f9ff",
        animation: "fadeIn 260ms ease"
      }}>
      <style>
        {`
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(6px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>

      <div
        style={{
          borderRadius: 18,
          padding: "14px 14px 12px",
          border: "1px solid rgba(148, 163, 184, 0.28)",
          background:
            "linear-gradient(130deg, rgba(255,255,255,0.92) 0%, rgba(239, 246, 255, 0.9) 100%)",
          boxShadow: "0 14px 28px rgba(14, 116, 144, 0.12)"
        }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4
          }}>
          <strong style={{ fontSize: 15, letterSpacing: 0.3 }}>
            AI PR Helper
          </strong>
          <span
            style={{
              padding: "3px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              color:
                settingsLoaded && hasRequiredAiSettings(settings)
                  ? "#065f46"
                  : "#92400e",
              backgroundColor:
                settingsLoaded && hasRequiredAiSettings(settings)
                  ? "rgba(16,185,129,0.16)"
                  : "rgba(251,191,36,0.22)"
            }}>
            {settingsLoaded && hasRequiredAiSettings(settings) ? "可生成" : "待配置"}
          </span>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#334155",
            lineHeight: 1.45
          }}>
          把 GitHub Diff 一键整理成结构化 PR 描述，并直接回填。
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 6,
          borderRadius: 14,
          padding: 5,
          backgroundColor: "rgba(148, 163, 184, 0.2)",
          border: "1px solid rgba(148, 163, 184, 0.22)"
        }}>
        <button
          onClick={() => setActiveView("generate")}
          style={getTabButtonStyle(activeView === "generate")}>
          生成
        </button>
        <button
          onClick={() => setActiveView("settings")}
          style={getTabButtonStyle(activeView === "settings")}>
          设置
        </button>
      </div>

      {notice && (
        <div
          style={{
            marginTop: 10,
            borderRadius: 12,
            border: "1px solid",
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.45,
            ...getNoticeStyle(notice.level)
          }}>
          {notice.text}
        </div>
      )}

      {activeView === "generate" ? (
        <div
          style={{
            marginTop: 12,
            borderRadius: 16,
            padding: 12,
            backgroundColor: "rgba(255, 255, 255, 0.88)",
            border: "1px solid rgba(148, 163, 184, 0.26)",
            boxShadow: "0 12px 24px rgba(148, 163, 184, 0.12)"
          }}>
          <div
            style={{
              fontSize: 11,
              color: "#475569",
              marginBottom: 8,
              wordBreak: "break-all"
            }}>
            当前页面: {currentTabUrl || "未读取到标签页 URL"}
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            style={getPrimaryButtonStyle(loading)}>
            {loading ? "AI 正在分析 Diff..." : "一键生成 PR 描述"}
          </button>

          {result && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={handlePaste}
                disabled={pasting}
                style={getSecondaryButtonStyle(pasting)}>
                {pasting ? "正在粘贴..." : "一键粘贴到 GitHub 描述框"}
              </button>
            </div>
          )}

          <div
            style={{
              marginTop: 12,
              borderRadius: 12,
              padding: 10,
              border: "1px solid rgba(148, 163, 184, 0.26)",
              backgroundColor: "rgba(248, 250, 252, 0.9)"
            }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8
              }}>
              <strong style={{ fontSize: 12 }}>AI 输出预览</strong>
              <span style={{ fontSize: 11, color: "#475569" }}>
                {result ? "已生成" : "等待生成"}
              </span>
            </div>

            <pre
              style={{
                margin: 0,
                minHeight: 120,
                maxHeight: 240,
                overflow: "auto",
                padding: 8,
                borderRadius: 10,
                fontSize: 12,
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                backgroundColor: "#ffffff",
                border: "1px solid rgba(148, 163, 184, 0.24)"
              }}>
              {result || "生成后会在这里显示结构化 PR 描述。"}
            </pre>
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "#334155",
              lineHeight: 1.5,
              borderRadius: 12,
              padding: 10,
              backgroundColor: "rgba(255, 255, 255, 0.74)",
              border: "1px dashed rgba(51, 65, 85, 0.24)"
            }}>
            发送目标: {getApiTargetLabel(settings)} | 域名权限:
            {` ${getPermissionStatusText(permissionStatus)} | `}
            Key: {maskApiKey(settings.apiKey)}
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 12,
            borderRadius: 16,
            padding: 12,
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            border: "1px solid rgba(148, 163, 184, 0.26)",
            boxShadow: "0 12px 24px rgba(148, 163, 184, 0.12)"
          }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>
            配置仅保存在当前浏览器本地。点击保存时会按接口域名申请权限。
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 11, color: "#334155" }}>API Key</label>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, apiKey: event.target.value }))
              }
              placeholder="sk-..."
              style={{
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.4)",
                backgroundColor: "#fff",
                padding: "9px 10px",
                fontSize: 12
              }}
            />

            <label style={{ fontSize: 11, color: "#334155" }}>
              Base URL (可选，和 API URL 二选一)
            </label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, baseUrl: event.target.value }))
              }
              placeholder="https://api.moonshot.cn/v1"
              style={{
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.4)",
                backgroundColor: "#fff",
                padding: "9px 10px",
                fontSize: 12
              }}
            />

            <label style={{ fontSize: 11, color: "#334155" }}>
              API URL (可选，优先级高于 Base URL)
            </label>
            <input
              type="text"
              value={settings.apiUrl}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, apiUrl: event.target.value }))
              }
              placeholder="https://xxx/v1/chat/completions"
              style={{
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.4)",
                backgroundColor: "#fff",
                padding: "9px 10px",
                fontSize: 12
              }}
            />

            <label style={{ fontSize: 11, color: "#334155" }}>模型名</label>
            <input
              type="text"
              value={settings.model}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, model: event.target.value }))
              }
              placeholder="moonshot-v1-8k"
              style={{
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.4)",
                backgroundColor: "#fff",
                padding: "9px 10px",
                fontSize: 12
              }}
            />
          </div>

          <div
            style={{
              marginTop: 10,
              borderRadius: 10,
              padding: 9,
              fontSize: 11,
              lineHeight: 1.5,
              color: "#334155",
              border: "1px dashed rgba(51, 65, 85, 0.25)",
              backgroundColor: "rgba(248, 250, 252, 0.8)"
            }}>
            当前请求地址: {endpointLabel}
            <br />
            域名授权状态: {getPermissionStatusText(permissionStatus)}
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              style={getPrimaryButtonStyle(saving)}>
              {saving ? "正在保存..." : "保存配置"}
            </button>

            <button
              onClick={handleTestConnection}
              disabled={testing}
              style={getSecondaryButtonStyle(testing)}>
              {testing ? "测试中..." : "测试连接"}
            </button>

            {permissionStatus !== "granted" && (
              <button
                onClick={handleGrantPermission}
                style={getSecondaryButtonStyle(false)}>
                授权当前接口域名
              </button>
            )}

            <button
              onClick={handleClearSettings}
              style={{
                ...getSecondaryButtonStyle(false),
                borderColor: "rgba(244, 63, 94, 0.35)",
                color: "#881337"
              }}>
              清空本地配置
            </button>
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              lineHeight: 1.5,
              color: "#475569"
            }}>
            说明: 仅在你点击“生成/测试”时向配置的接口发请求，不会把 Diff 上传到开发者自建服务器。
          </div>
        </div>
      )}
    </div>
  )
}

export default IndexPopup
