import { type AiSettings, resolveAiApiUrl } from "./settings"

const AI_REQUEST_MAX_ATTEMPTS = 3
const AI_RETRY_DELAY_MS = 1200
const DIFF_CHAR_LIMIT = 15000

type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type DiffResult =
  | { ok: true; content: string }
  | { ok: false; message: string }

export type AIResult =
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
## 📝 描述
- 用 1-2 条概括这次改动解决了什么问题、核心变化是什么。

## 🛠 改动清单
- 按功能点或模块列出 2-4 条关键改动。

## 影响范围
- 说明受影响的页面、模块、接口、配置或流程。

额外要求：
- 如果 Diff 明显是前端改动，优先指出交互、文案、样式、状态流转变化。
- 如果 Diff 明显是后端或基础设施改动，优先指出接口、数据流、配置、兼容性变化。
- 如果改动很小，也必须完整输出整套模版。
`.trim()

const buildPrDescriptionUserPrompt = (diffContent: string) =>
  `请基于下面的 Git Diff 生成 PR 描述。\n\nGit Diff:\n${diffContent}`

export const resolveGitHubDiffUrl = (rawUrl: string) => {
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
    console.error("URL parse failed:", error)
    return null
  }
}

export const fetchDiff = async (url: string): Promise<DiffResult> => {
  const diffUrl = resolveGitHubDiffUrl(url)

  if (!diffUrl) {
    return {
      ok: false,
      message: "请在 GitHub Pull Request 或 Compare 页面使用"
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

    return { ok: true, content: text.slice(0, DIFF_CHAR_LIMIT) }
  } catch (error) {
    console.error("Fetch diff failed:", error)
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

const sleep = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

const isRetryableApiFailure = (status: number, errorMessage: string) => {
  const normalizedMessage = errorMessage.toLowerCase()

  return (
    status === 429 ||
    status === 503 ||
    normalizedMessage.includes("overloaded") ||
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("busy")
  )
}

const getApiOriginLabel = (settings: AiSettings) => {
  try {
    return new URL(resolveAiApiUrl(settings)).origin
  } catch {
    return resolveAiApiUrl(settings)
  }
}

const requestAi = async (
  settings: AiSettings,
  messages: ChatMessage[]
): Promise<AIResult> => {
  try {
    const apiUrl = resolveAiApiUrl(settings)

    for (
      let attemptIndex = 0;
      attemptIndex < AI_REQUEST_MAX_ATTEMPTS;
      attemptIndex += 1
    ) {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey.trim()}`
        },
        body: JSON.stringify({
          model: settings.model.trim(),
          messages,
          temperature: 0.3
        })
      })

      if (!response.ok) {
        const errorMessage = await getApiErrorMessage(response)
        const retryable = isRetryableApiFailure(response.status, errorMessage)
        const hasNextAttempt = attemptIndex < AI_REQUEST_MAX_ATTEMPTS - 1

        if (retryable && hasNextAttempt) {
          await sleep(AI_RETRY_DELAY_MS * (attemptIndex + 1))
          continue
        }

        if (retryable) {
          return {
            ok: false,
            message:
              `AI 服务当前繁忙，已自动重试 ${AI_REQUEST_MAX_ATTEMPTS} 次仍失败。` +
              `请稍后再试，或切换模型/接口。原始错误：${errorMessage}`
          }
        }

        return {
          ok: false,
          message: `AI API 请求失败：${errorMessage}`
        }
      }

      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content

      if (!content) {
        return {
          ok: false,
          message: "AI API 已返回响应，但没有拿到生成内容"
        }
      }

      return { ok: true, content }
    }

    return {
      ok: false,
      message: "AI API 请求失败：未获得有效响应"
    }
  } catch (error) {
    console.error("AI API request failed:", error)
    return {
      ok: false,
      message: `AI API 网络异常，请检查当前网络是否能访问 ${getApiOriginLabel(settings)}`
    }
  }
}

export const askAi = async (
  diffContent: string,
  settings: AiSettings
): Promise<AIResult> =>
  requestAi(settings, [
    {
      role: "system",
      content: prDescriptionSystemPrompt
    },
    {
      role: "user",
      content: buildPrDescriptionUserPrompt(diffContent)
    }
  ])

export const testAiConnection = async (
  settings: AiSettings
): Promise<AIResult> =>
  requestAi(settings, [
    {
      role: "system",
      content: "你是一个连接测试助手。"
    },
    {
      role: "user",
      content: "请只返回“连接成功”。"
    }
  ])
