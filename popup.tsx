import { useState } from "react"

const kimiApiKey = process.env.PLASMO_PUBLIC_KIMI_API_KEY?.trim() ?? ""

type DiffResult =
  | { ok: true; content: string }
  | { ok: false; message: string }

type KimiResult =
  | { ok: true; content: string }
  | { ok: false; message: string }

const prDescriptionSystemPrompt = `
你是资深工程师，负责根据 Git Diff 生成统一、可直接粘贴到 GitHub 的 PR 描述。

请严格遵守以下要求：
1. 仅依据提供的 Diff 输出，不要臆测未出现的业务背景、测试结果、风险或需求来源。
2. 输出语言使用简体中文，格式使用 Markdown。
3. 必须严格按照下面的模版输出，保留所有一级标题，不能新增一级标题，不能输出标题以外的开场白或结尾。
4. 每个列表项尽量简洁、明确，优先描述真实改动和评审重点。
5. 如果某部分无法从 Diff 明确判断，请写“未从 Diff 中明确看出”。
6. 不要使用代码块包裹整个结果。

输出模版：
## 变更概述
- 用 1-2 条概括这次改动解决了什么问题、核心变化是什么。

## 主要改动
- 按功能点或模块列出 2-4 条关键改动。

## 影响范围
- 说明受影响的页面、模块、接口、配置或流程。

## 风险与回滚
- 风险：总结潜在风险；如无法判断则写“未从 Diff 中明确看出”。
- 回滚：说明回滚方式；如无法判断则写“回滚到变更前版本”。

## 测试说明
- 列出可从 Diff 推断出的测试、验证方式；如无法判断则写“未从 Diff 中明确看出”。

额外要求：
- 如果 Diff 明显是前端改动，优先指出交互、文案、样式、状态流转变化。
- 如果 Diff 明显是后端或基础设施改动，优先指出接口、数据流、配置、兼容性变化。
- 如果改动很小，也必须完整输出整套模版。
`.trim()

const buildPrDescriptionUserPrompt = (diffContent: string) =>
  `请基于下面的 Git Diff 生成 PR 描述。\n\nGit Diff:\n${diffContent}`

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
              content: prDescriptionSystemPrompt
            },
            {
              role: "user",
              content: buildPrDescriptionUserPrompt(diffContent)
            }
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
