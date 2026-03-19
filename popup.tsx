import { useState } from "react"

const kimiApiKey = process.env.PLASMO_PUBLIC_KIMI_API_KEY?.trim() ?? ""

type DiffResult =
  | { ok: true; content: string }
  | { ok: false; message: string }

type KimiResult =
  | { ok: true; content: string }
  | { ok: false; message: string }

const resolveGitHubDiffUrl = (rawUrl: string) => {
  try {
    const parsedUrl = new URL(rawUrl)
    const pullMatch = parsedUrl.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/
    )

    if (pullMatch) {
      return `${parsedUrl.origin}/${pullMatch[1]}/${pullMatch[2]}/pull/${pullMatch[3]}.diff`
    }

    if (parsedUrl.pathname.includes("/compare/")) {
      return `${parsedUrl.origin}${parsedUrl.pathname}.diff`
    }

    return null
  } catch (error) {
    console.error("URL 解析失败:", error)
    return null
  }
}

const fetchDiff = async (url: string): Promise<DiffResult> => {
  const diffUrl = resolveGitHubDiffUrl(url)

  if (!diffUrl) {
    return {
      ok: false,
      message: "请在 GitHub Pull Request 或 Compare 页面使用我"
    }
  }

  try {
    const response = await fetch(diffUrl)

    if (!response.ok) {
      return {
        ok: false,
        message: `抓取 Diff 失败，GitHub 返回了 ${response.status} ${response.statusText}`
      }
    }

    const text = await response.text()

    if (!text.trim()) {
      return {
        ok: false,
        message: "抓取到的 Diff 为空，请确认当前页面是可访问的 GitHub PR 或 Compare 页面"
      }
    }

    return { ok: true, content: text.slice(0, 15000) } // 截取一部分，防止文本太长
  } catch (error) {
    console.error("抓取失败:", error)

    return {
      ok: false,
      message: "抓取 Diff 时网络异常，请检查当前网络是否能访问 GitHub"
    }
  }
}

const getApiErrorMessage = async (response: Response) => {
  try {
    const data = await response.json()

    return (
      data?.error?.message ||
      data?.message ||
      `${response.status} ${response.statusText}`
    )
  } catch {
    return `${response.status} ${response.statusText}`
  }
}

const askKimi = async (diffContent: string): Promise<KimiResult> => {
  if (!kimiApiKey) {
    return {
      ok: false,
      message:
        "未配置 Kimi API Key。请在项目根目录创建 .env，并设置 PLASMO_PUBLIC_KIMI_API_KEY=你的密钥"
    }
  }

  try {
    const response = await fetch(
      "https://api.moonshot.cn/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${kimiApiKey}`
        },
        body: JSON.stringify({
          model: "moonshot-v1-8k",
          messages: [
            {
              role: "system",
              content:
                "你是一个代码专家，请根据提供的 Git Diff 编写一份简短的 PR 描述，包含：## 改动点、## 影响范围。"
            },
            { role: "user", content: `这是代码改动：\n${diffContent}` }
          ],
          temperature: 0.3
        })
      }
    )

    if (!response.ok) {
      const errorMessage = await getApiErrorMessage(response)

      return {
        ok: false,
        message: `Kimi API 请求失败：${errorMessage}`
      }
    }

    const data = await response.json()

    const content = data?.choices?.[0]?.message?.content

    if (!content) {
      return {
        ok: false,
        message: "Kimi API 已返回响应，但没有拿到生成内容"
      }
    }

    return { ok: true, content }
  } catch (error) {
    console.error("Kimi API 调用失败:", error)

    return {
      ok: false,
      message:
        "Kimi API 网络异常，请检查当前网络是否能访问 https://api.moonshot.cn"
    }
  }
}

function IndexPopup() {
  const [url, setUrl] = useState("")
  const [result, setResult] = useState("")
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [pasting, setPasting] = useState(false)

  const handleGenerate = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) return

    setUrl(tab.url)
    setLoading(true)
    setResult("")
    setStatus("")

    const diff = await fetchDiff(tab.url)

    if ("message" in diff) {
      setStatus(diff.message)
      setLoading(false)
      return
    }

    const aiResult = await askKimi(diff.content)

    if ("message" in aiResult) {
      setStatus(aiResult.message)
      setLoading(false)
      return
    }

    setResult(aiResult.content)
    setLoading(false)
  }

  const handlePaste = async () => {
    if (!result) return

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      setStatus("没有找到当前标签页")
      return
    }

    setPasting(true)
    setStatus("")

    try {
      const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [result],
        func: (content: string) => {
          const isVisible = (element: HTMLElement | null) => {
            if (!element) return false
            return Boolean(
              element.offsetWidth ||
              element.offsetHeight ||
              element.getClientRects().length
            )
          }

          const textareaSelectors = [
            "textarea#pull_request_body",
            "textarea[name='pull_request[body]']"
          ]

          const textarea =
            textareaSelectors
              .map((selector) =>
                document.querySelector<HTMLTextAreaElement>(selector)
              )
              .find((element) => Boolean(element && isVisible(element))) ??
            Array.from(
              document.querySelectorAll<HTMLTextAreaElement>("textarea")
            ).find((element) => {
              if (!isVisible(element)) return false

              const elementKey = `${element.id} ${element.name}`.toLowerCase()
              return (
                elementKey.includes("pull_request") &&
                elementKey.includes("body")
              )
            }) ??
            null

          if (!textarea) {
            return "没有找到 PR 描述输入框，请先打开 GitHub 的 PR 描述编辑框"
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

          return "已粘贴到 GitHub PR 描述输入框"
        }
      })

      setStatus(injectionResult?.result ?? "粘贴完成")
    } catch (error) {
      console.error("粘贴失败:", error)
      setStatus("粘贴失败，请确认当前页面是 GitHub PR 页面并已打开描述输入框")
    } finally {
      setPasting(false)
    }
  }

  return (
    <div style={{ padding: 16, width: 300 }}>
      <h3 style={{ marginBottom: 12 }}>AI PR Helper</h3>

      <button
        onClick={handleGenerate}
        disabled={loading}
        style={{
          width: "100%",
          padding: "8px",
          cursor: loading ? "not-allowed" : "pointer",
          backgroundColor: "#2ea44f",
          color: "white",
          border: "none",
          borderRadius: "4px"
        }}>
        {loading ? "AI 正在分析中..." : "一键生成 PR 描述"}
      </button>

      {result && (
        <>
          <button
            onClick={handlePaste}
            disabled={pasting}
            style={{
              width: "100%",
              padding: "8px",
              marginTop: 12,
              cursor: pasting ? "not-allowed" : "pointer",
              backgroundColor: "#0969da",
              color: "white",
              border: "none",
              borderRadius: "4px"
            }}>
            {pasting ? "正在粘贴..." : "一键粘贴到 PR 描述"}
          </button>

          <div
            style={{
              marginTop: 16,
              padding: 8,
              backgroundColor: "#f6f8fa",
              borderRadius: 4,
              fontSize: 12,
              border: "1px solid #d0d7de"
            }}>
            <strong style={{ display: "block", marginBottom: 4 }}>
              AI 建议：
            </strong>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{result}</pre>
          </div>
        </>
      )}

      {status && (
        <p
          style={{
            fontSize: 12,
            color: "#57606a",
            marginTop: 12,
            marginBottom: 0
          }}>
          {status}
        </p>
      )}

      <p style={{ fontSize: 10, color: "#666", marginTop: 12 }}>
        当前页面: {url}
      </p>
    </div>
  )
}

export default IndexPopup
