# 调试日志

## 一、语音转录功能

### 问题描述
用户在尝试使用语音输入功能时，遇到了 `500 Internal Server Error` 和 `405 Method Not Allowed` 错误。经过多次排查，共发现四个主要问题。

### 排查过程与修复

#### 1. 鉴权错误 (401 Unauthorized)
**现象**：
后端日志显示 `openai.AuthenticationError: Error code: 401 - {'error': {'message': 'Incorrect API key provided...'}}`。

**原因**：
用户提供的 API Key 是 **AI Builder Space** 平台的专用密钥，而不是 OpenAI 官方的密钥。代码默认连接 `api.openai.com`，导致鉴权失败。

**修复**：
在 `server.py` 中配置 `Base URL` 指向 AI Builder Space 的网关：
```python
base_url = "https://space.ai-builders.com/api/v1"
client = AsyncOpenAI(api_key=api_key, base_url=base_url)
```

#### 2. 字段名不匹配 (422 Validation Error)
**现象**：
修复鉴权后，依然报错。检查 `openapi.json` 发现，AI Builder Space 的语音转录接口 `/v1/audio/transcriptions` 要求的字段名是 `audio_file`。

**原因**：
OpenAI SDK 的 `client.audio.transcriptions.create` 方法默认强制使用 `file` 作为字段名，无法修改。这导致服务器接收不到音频文件。

**修复**：
放弃使用 SDK 的封装方法，改用 `httpx` 手动发送 HTTP POST 请求，精确控制 multipart/form-data 的字段名：
```python
files = {
    'audio_file': (file.filename, audio_file, file.content_type or 'audio/webm')
}
# ... 使用 httpx.post 发送请求
```

#### 3. 文件关闭时机问题 (500 Internal Server Error)
**现象**：
改为 `httpx` 后，出现 500 错误。后端日志显示文件读取失败。

**原因**：
代码使用 `with open(temp_filename, "rb") as audio_file:` 打开临时文件，但在异步请求完成前文件可能已经关闭，导致 httpx 无法读取文件内容。

**修复**：
不再使用临时文件，直接将上传的文件内容读取到内存，使用 `BytesIO` 传递给 httpx：
```python
# 读取上传的文件内容到内存
audio_content = await file.read()
file_size = len(audio_content)

async with httpx.AsyncClient() as http_client:
    # 使用 BytesIO 将内存中的音频数据传递给 httpx
    audio_file = BytesIO(audio_content)
    
    files = {
        'audio_file': (filename, audio_file, file.content_type or 'audio/webm')
    }
    # ... 发送请求
```

#### 4. Base URL 配置错误 (405 Method Not Allowed)
**现象**：
修复文件关闭问题后，收到 `405 Method Not Allowed` 错误。错误响应来自 nginx，说明请求路径不正确。

**排查过程**：
1. 首先怀疑是 Vite 代理问题，修改前端代码在开发环境直接使用后端 URL
2. 检查 OpenAPI 规范，确认路径应为 `/v1/audio/transcriptions`
3. 尝试移除 `model` 参数（OpenAPI 规范中未定义）
4. 编写探测脚本 `test_api.py`，测试多个可能的 Base URL：
   - `https://space.ai-builders.com/api/v1` ❌ (405)
   - `https://space.ai-builders.com/v1` ❌ (405)
   - `https://space.ai-builders.com/api` ❌ (405)
   - `https://space.ai-builders.com/backend/v1` ✅ (400/500，说明路径正确)

**原因**：
根据 `openapi.json` 中的 `servers` 配置 `{"url": "/backend"}`，API 实际部署在 `/backend` 路径下，而不是 `/api` 路径。正确的 Base URL 应该是 `https://space.ai-builders.com/backend/v1`。

**修复**：
1. 更新 `.env` 文件中的 `BASE_URL`：
```env
BASE_URL=https://space.ai-builders.com/backend/v1
```

2. 更新 `server.py` 中所有 API 调用的默认 Base URL：
```python
base_url = os.getenv("BASE_URL", "https://space.ai-builders.com/backend/v1")
```

3. 移除 `model` 参数（OpenAPI 规范中未定义）：
```python
# 之前错误地添加了 model 参数
# data = {'model': 'whisper-1'}  # ❌ 移除

# 正确的请求（只包含 audio_file）
files = {
    'audio_file': (filename, audio_file, file.content_type or 'audio/webm')
}
headers = {
    "Authorization": f"Bearer {api_key}"
}
response = await http_client.post(
    f"{base_url}/audio/transcriptions",
    files=files,
    headers=headers,
    timeout=60.0,
    follow_redirects=True
)
```

4. 前端代码优化（开发环境直接调用后端）：
```javascript
// 在开发环境中直接使用后端URL，避免代理问题
const apiUrl = import.meta.env.DEV 
  ? 'http://localhost:3001/api/transcribe' 
  : '/api/transcribe'
```

---

## 二、前端流式输出与换行显示问题

### 问题 1: 流式输出时换行符丢失

**现象**：
AI 回复中的换行符无法正常显示，所有内容都连在一起。

**原因分析**：
1. **SSE 格式冲突**：当 AI 回复包含换行符时，后端发送的格式 `data: {content}\n\n` 会被前端错误解析。例如 `data: 第一行\n第二行\n\n` 会被 `split('\n')` 分割，导致后续行不匹配 `data: ` 前缀而被忽略。
2. **前端解析问题**：使用 `split('\n')` 逐行处理 SSE 数据时，如果内容本身包含换行符，会导致解析错误。

**修复方案**：

**后端 (`server.py`)**：
- 发送前将换行符 `\n` 替换为特殊标记 `[NEWLINE]`，避免 SSE 格式冲突：
```python
if hasattr(delta, 'content') and delta.content:
    content = delta.content
    full_reply += content
    # 将换行符替换为特殊标记以避免SSE格式冲突
    encoded_content = content.replace('\n', '[NEWLINE]')
    yield f"data: {encoded_content}\n\n"
```

**前端 (`App.jsx`)**：
- 改进 SSE 解析逻辑，使用 `indexOf` 和 `substring` 正确提取数据块：
```javascript
// 按 SSE 格式解析：data: 开头，后面跟两个换行符表示结束
let dataStart = buffer.indexOf('data: ')
while (dataStart !== -1) {
  const dataContentStart = dataStart + 6 // 'data: ' 的长度
  const dataEnd = buffer.indexOf('\n\n', dataContentStart)
  
  if (dataEnd === -1) {
    // 还没有收到完整的数据，保留在 buffer 中
    break
  }
  
  const data = buffer.substring(dataContentStart, dataEnd)
  buffer = buffer.substring(dataEnd + 2)
  
  // 将后端的特殊标记 [NEWLINE] 替换回换行符
  const decodedData = data.replace(/\[NEWLINE\]/g, '\n')
  fullReply += decodedData
  // ... 更新 UI
}
```

**CSS (`App.css`)**：
- 移除 `white-space: pre-wrap`，因为使用 `dangerouslySetInnerHTML` 和 `<br>` 标签处理换行：
```css
.message-bubble {
  /* 不使用 white-space: pre-wrap，因为使用 dangerouslySetInnerHTML 和 <br> 标签处理换行 */
  word-wrap: break-word;
}
```

**Markdown 渲染 (`renderMarkdown`)**：
- 将 `\n` 转换为 `<br>` 标签：
```javascript
// 最后处理换行：将剩余的 \n 转换为 <br>
html = html.replace(/\n/g, '<br>')
```

---

### 问题 2: 对话历史刷新后丢失

**现象**：
刷新页面后，之前的对话历史全部消失。

**原因**：
对话历史（`conversation`、`aiQuestion`、`aiThinking`）只存储在 React state 中，没有持久化到 localStorage。

**修复方案**：

**添加存储函数** (`App.jsx`)：
```javascript
// 获取日期键（用于存储对话历史）
const getDateKey = (date) => {
  if (date) {
    return typeof date === 'string' ? date : date.toISOString().split('T')[0]
  }
  const today = getCurrentDate()
  return today.toISOString().split('T')[0]
}

// 保存对话历史到本地存储
const saveConversationHistory = (dateKey, conversationData, aiQuestionData, aiThinkingData) => {
  const key = `conversation_${dateKey}`
  const data = {
    conversation: conversationData || [],
    aiQuestion: aiQuestionData || null,
    aiThinking: aiThinkingData || null
  }
  localStorage.setItem(key, JSON.stringify(data))
}

// 从本地存储加载对话历史
const loadConversationHistory = (dateKey) => {
  const key = `conversation_${dateKey}`
  const saved = localStorage.getItem(key)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      return {
        conversation: parsed.conversation || [],
        aiQuestion: parsed.aiQuestion || null,
        aiThinking: parsed.aiThinking || null
      }
    } catch (e) {
      console.error('加载对话历史失败:', e)
    }
  }
  return { conversation: [], aiQuestion: null, aiThinking: null }
}
```

**自动保存机制**：
```javascript
// 自动保存对话历史到本地存储
useEffect(() => {
  const dateKey = selectedDate ? getDateKey(selectedDate) : getDateKey()
  saveConversationHistory(dateKey, conversation, aiQuestion, aiThinking)
}, [conversation, aiQuestion, aiThinking, selectedDate])
```

**初始加载**：
```javascript
useEffect(() => {
  // ... 加载 thoughts 等其他数据
  
  // 加载今天的对话历史
  const todayKey = getDateKey()
  const history = loadConversationHistory(todayKey)
  if (history.conversation.length > 0 || history.aiQuestion) {
    setConversation(history.conversation)
    setAiQuestion(history.aiQuestion)
    setAiThinking(history.aiThinking)
  }
}, [])
```

**切换日期时恢复**：
```javascript
useEffect(() => {
  if (selectedDate) {
    // ... 其他逻辑
    
    // 加载该日期的对话历史
    const dateKey = getDateKey(selectedDate)
    const history = loadConversationHistory(dateKey)
    setAiQuestion(history.aiQuestion)
    setAiThinking(history.aiThinking)
    setConversation(history.conversation)
  }
}, [selectedDate, thoughts.length])
```

---

### 问题 3: UI 按钮位置调整

**现象**：
"继续说点什么"按钮（`resume-conversation-btn`）显示在左侧固定位置，用户希望显示在对话正下方。

**修复方案**：

**JSX 结构调整** (`App.jsx`)：
- 将按钮从独立位置移动到 `conversation-flow` 内部：
```javascript
{conversation.length > 0 && (
  <div className="conversation-flow">
    {/* 对话消息 */}
    {conversation.map((msg, index) => (
      // ...
    ))}
    <div ref={conversationEndRef} />
    
    {/* 继续对话按钮 - 显示在对话下方 */}
    {conversationPaused && (
      <button
        type="button"
        onClick={handleResumeConversation}
        className="resume-conversation-btn"
        title="继续说点什么"
      >
        …
      </button>
    )}
  </div>
)}
```

- 当只有 `aiQuestion` 而没有对话历史时，也显示在问题下方：
```javascript
{conversation.length === 0 && aiQuestion && (
  <div className="initial-ai-question">
    <p dangerouslySetInnerHTML={renderMarkdown(aiQuestion)} />
    
    {conversationPaused && (
      <button className="resume-conversation-btn">…</button>
    )}
  </div>
)}
```

**CSS 样式调整** (`App.css`)：
```css
.resume-conversation-btn {
  /* 在对话流内部显示，不再使用固定定位 */
  margin: 20px auto 0;
  background: transparent;
  border: 1px solid var(--accent-color);
  color: var(--accent-color);
  /* ... 其他样式保持不变 */
}
```

---

## 总结

### 语音转录功能
对接第三方兼容 API 时，不能盲目依赖官方 SDK，必须仔细核对 `openapi.json` 文档，特别是：

1.  **Base URL**：必须仔细检查 `openapi.json` 中的 `servers` 配置，确认实际的 API 部署路径。不要假设路径结构（如 `/api/v1` vs `/backend/v1`）。可以通过编写探测脚本测试多个可能的 Base URL 来找到正确的配置。

2.  **字段名**：SDK 默认字段名是否与 API 要求一致（如 `file` vs `audio_file`）。当 SDK 无法自定义字段名时，应使用 `httpx` 等底层 HTTP 库手动构造请求。

3.  **文件处理**：使用临时文件时要注意文件关闭时机，避免在异步请求完成前关闭文件。推荐直接将文件内容读取到内存，使用 `BytesIO` 传递给 HTTP 客户端。

4.  **参数验证**：严格按照 OpenAPI 规范中的参数定义，不要添加规范中未定义的参数（如 `model` 参数），这可能导致 405 错误。

5.  **URL 格式**：注意尾部斜杠的处理，POST 请求通常更敏感。建议启用 `follow_redirects=True` 以处理潜在的网关重定向。

6.  **调试工具**：编写独立的测试脚本（如 `test_api.py`）可以帮助快速定位问题，特别是当多个 API 端点都失败时，可以通过测试 Chat API 等已知可用的端点来验证 Base URL 是否正确。

### 前端流式输出与显示
1. **SSE 格式处理**：当内容包含换行符时，需要使用特殊标记或编码方式避免格式冲突。
2. **数据持久化**：重要状态（如对话历史）应该及时保存到 localStorage，避免刷新丢失。
3. **UI 布局**：按钮等交互元素应该放在合适的容器内，使用相对定位而非固定定位，以保持布局的灵活性。
