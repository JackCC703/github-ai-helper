import { useState } from "react"

// 1. 在组件外部定义 API 调用函数，保持代码整洁
const fetchDiff = async (url: string) => {
  if (!url.includes("/pull/")) {
    alert("请在 GitHub Pull Request 页面使用我")
    return null
  }
  const diffUrl = `${url}.diff`
  try {
    const response = await fetch(diffUrl)
    const text = await response.text()
    return text.slice(0, 5000) // 截取一部分，防止文本太长
  } catch (error) {
    console.error("抓取失败:", error)
    return null
  }
}

const askKimi = async (diffContent: string, apiKey: string) => {
  try {
    const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "moonshot-v1-8k",
        messages: [
          { role: "system", content: "你是一个代码专家，请根据提供的 Git Diff 编写一份简短的 PR 描述，包含：## 改动点、## 影响范围。" },
          { role: "user", content: `这是代码改动：\n${diffContent}` }
        ],
        temperature: 0.3
      })
    })
    const data = await response.json()
    return data.choices[0].message.content
  } catch (e) {
    return "API 调用出错了，检查一下 Key 或网络"
  }
}

function IndexPopup() {
  const [url, setUrl] = useState("")
  const [result, setResult] = useState("") // 新增：保存 AI 生成的结果
  const [loading, setLoading] = useState(false) // 新增：加载状态

  const handleGenerate = async () => {
    // A. 获取 URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) return

    setUrl(tab.url)
    setLoading(true)

    // B. 抓取 Diff
    const diff = await fetchDiff(tab.url)

    if (diff) {
      // C. 调用 Kimi (记得换成你自己的 API Key)
      const aiText = await askKimi(diff, "")
      setResult(aiText)
    }

    setLoading(false)
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
        }}
      >
        {loading ? "AI 正在分析中..." : "一键生成 PR 描述"}
      </button>

      {/* 显示结果的区域 */}
      {result && (
        <div style={{
          marginTop: 16,
          padding: 8,
          backgroundColor: "#f6f8fa",
          borderRadius: 4,
          fontSize: 12,
          border: "1px solid #d0d7de"
        }}>
          <strong style={{ display: "block", marginBottom: 4 }}>AI 建议：</strong>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{result}</pre>
        </div>
      )}

      <p style={{ fontSize: 10, color: "#666", marginTop: 12 }}>当前页面: {url}</p>
    </div>
  )
}

export default IndexPopup