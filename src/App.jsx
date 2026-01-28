import { useState, useEffect, useRef } from 'react'
import './App.css'
import { 
  setEmbedding, 
  getEmbedding, 
  deleteEmbedding, 
  needsReembedding,
  getAllEmbeddings,
  cosineSimilarity
} from './embeddingStore'

// Markdown 渲染函数
const renderMarkdown = (text) => {
  if (!text) return { __html: '' }
  
  let html = text
  
  // 先转义HTML特殊字符，防止XSS
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // 处理加粗：**text** 或 __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
  
  // 处理斜体：*text* 或 _text_（但不在加粗内部，且不是列表标记）
  // 避免匹配列表项开头的 - 或 *
  html = html.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
  html = html.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>')
  
  // 处理列表项：- 开头的内容（每行单独处理）
  const lines = html.split('\n')
  const processedLines = []
  let inList = false
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 检查是否是列表项（- 开头，后面跟空格）
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        processedLines.push('<ul>')
        inList = true
      }
      // 移除列表标记，保留内容
      const content = line.replace(/^[-*]\s+/, '')
      processedLines.push(`<li>${content}</li>`)
    } else {
      if (inList) {
        processedLines.push('</ul>')
        inList = false
      }
      processedLines.push(line)
    }
  }
  
  if (inList) {
    processedLines.push('</ul>')
  }
  
  html = processedLines.join('\n')
  
  // 最后处理换行：将剩余的 \n 转换为 <br>
  html = html.replace(/\n/g, '<br>')
  
  return { __html: html }
}

function App() {
  const [thoughts, setThoughts] = useState([]) // 已定稿的卡片
  const [conversation, setConversation] = useState([]) // 当前对话流（临时）
  const [inputValue, setInputValue] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingContent, setEditingContent] = useState('')
  const [selectedDate, setSelectedDate] = useState(null)
  const [dailySummary, setDailySummary] = useState('')
  const [aiQuestion, setAiQuestion] = useState(null) // 单独存储AI问题
  const [aiThinking, setAiThinking] = useState(null) // 存储AI思考内容（不显示给用户）
  const [isLoadingSummary, setIsLoadingSummary] = useState(false)
  const [isLoadingAI, setIsLoadingAI] = useState(false)
  const [futureDateMessage, setFutureDateMessage] = useState('')
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [todaySealed, setTodaySealed] = useState(false) // 今天是否已封存
  const [showSummaryConfirm, setShowSummaryConfirm] = useState(false) // 显示总结确认对话框
  const [showFarewell, setShowFarewell] = useState(false) // 显示道别界面
  const [conversationPaused, setConversationPaused] = useState(false) // 对话是否已暂停（点击了"今天就到这吧"）
  const [showClearConversationConfirm, setShowClearConversationConfirm] = useState(false) // 显示清除对话确认对话框
  const inputRef = useRef(null)
  const [isRecording, setIsRecording] = useState(false)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const prevSelectedDateRef = useRef(null) // 跟踪上一次的 selectedDate，用于切换日期时保存旧数据
  const [isLoadingTagging, setIsLoadingTagging] = useState(false) // 打标签和embedding的加载状态
  const [isLoadingCrossInsight, setIsLoadingCrossInsight] = useState(false) // 历史洞察加载状态

  // 语音输入处理
  const handleVoiceInput = async () => {
    if (isRecording) {
      console.log('停止录音...')
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop()
        setIsRecording(false)
      }
    } else {
      console.log('开始录音...')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mediaRecorder = new MediaRecorder(stream)
        mediaRecorderRef.current = mediaRecorder
        audioChunksRef.current = []

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data)
            console.log(`收集到音频块: ${event.data.size} bytes`)
          }
        }

        mediaRecorder.onstop = async () => {
          console.log('录音结束，正在处理...')
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          console.log(`生成的音频 Blob 大小: ${audioBlob.size} bytes, 类型: ${audioBlob.type}`)
          
          if (audioBlob.size === 0) {
            console.error('录音失败: 音频文件为空')
            alert('录音失败: 未采集到音频数据')
            return
          }

          const formData = new FormData()
          formData.append('file', audioBlob, 'recording.webm')

          setInputValue(prev => prev + (prev ? ' ' : '') + '正在转录...')
          
          try {
            // 在开发环境中直接使用后端URL，避免代理问题
            const apiUrl = import.meta.env.DEV 
              ? 'http://localhost:3001/api/transcribe' 
              : '/api/transcribe'
            console.log('发送请求到', apiUrl)
            const response = await fetch(apiUrl, {
              method: 'POST',
              body: formData,
            })
            
            console.log(`响应状态: ${response.status} ${response.statusText}`)

            if (response.ok) {
              const data = await response.json()
              console.log('转录结果:', data)
              if (data.text) {
                setInputValue(prev => {
                  const cleanPrev = prev.replace('正在转录...', '').trim()
                  return cleanPrev + (cleanPrev ? ' ' : '') + data.text
                })
              } else {
                console.warn('转录结果中没有 text 字段')
                setInputValue(prev => prev.replace('正在转录...', '').trim())
              }
            } else {
              const errorText = await response.text()
              console.error('转录请求失败:', errorText)
              setInputValue(prev => prev.replace('正在转录...', '').trim())
              console.error('Transcription failed')
            }
          } catch (error) {
            setInputValue(prev => prev.replace('正在转录...', '').trim())
            console.error('Error sending audio:', error)
          }
          
          stream.getTracks().forEach(track => track.stop())
        }

        mediaRecorder.start()
        setIsRecording(true)
      } catch (error) {
        console.error('Error accessing microphone:', error)
        alert('无法访问麦克风: ' + error.message)
      }
    }
  }

  // 获取当前"今天"的日期
  const getCurrentDate = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }

  // 获取保存想法的时间戳（如果选择了日期，使用选择的日期）
  const getCurrentTimestamp = () => {
    if (selectedDate) {
      // 如果选择了日期，使用选择的日期作为时间戳
      const date = new Date(selectedDate)
      // 设置为当天的某个时间（比如下午2点），而不是午夜
      date.setHours(14, 0, 0, 0)
      return date.toISOString()
    }
    // 否则使用当前真实时间
    return new Date().toISOString()
  }

  // 获取今日的想法
  const getTodayThoughts = (thoughtsList = thoughts) => {
    const today = getCurrentDate()
    return thoughtsList.filter((thought) => {
      const thoughtDate = new Date(thought.createdAt)
      thoughtDate.setHours(0, 0, 0, 0)
      return thoughtDate.getTime() === today.getTime()
    })
  }

  // 处理总结按钮点击（显示确认对话框）
  const handleSummaryClick = () => {
    const todayThoughts = getTodayThoughts()
    if (todayThoughts.length === 0) {
      return
    }
    setShowSummaryConfirm(true)
  }

  // 确认总结后执行（接口1：今日洞察）
  const handleConfirmSummary = async () => {
    setShowSummaryConfirm(false)
    const todayThoughts = getTodayThoughts()
    if (todayThoughts.length === 0) {
      setDailySummary('')
      return
    }

    setIsLoadingSummary(true)
    try {
      // 调试：打印发送的想法内容
      console.log('发送给AI的今日想法:', todayThoughts.map(t => t.content))
      
      // 调用接口1：今日洞察
      const response = await fetch('/api/insight', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ thoughts: todayThoughts }),
      })

      const data = await response.json()

      if (response.ok && data.question) {
        // 只保存计数部分到dailySummary，AI问题单独保存
        const summaryText = `今天你记录了 ${todayThoughts.length} 条想法。`
        setDailySummary(summaryText)
        setAiQuestion(data.question) // 单独保存AI问题
        setAiThinking(data.thinking || '') // 保存思考内容（不显示给用户）
        // 调试：打印AI返回的问题和思考内容
        console.log('AI返回的问题:', data.question)
        console.log('AI思考内容（不显示）:', data.thinking)
      } else {
        const summaryText = `今天你记录了 ${todayThoughts.length} 条想法。`
        setDailySummary(summaryText)
        setAiQuestion(null)
        setAiThinking(null)
      }
    } catch (error) {
      console.error('获取今日总结失败:', error)
      const summaryText = `今天你记录了 ${todayThoughts.length} 条想法。`
      setDailySummary(summaryText)
      setAiQuestion(null)
      setAiThinking(null)
    } finally {
      setIsLoadingSummary(false)
    }
  }

  // 取消总结
  const handleCancelSummary = () => {
    setShowSummaryConfirm(false)
  }

  // AI 生成回复（接口2：对话接口）
  const generateAIResponse = async (userMessage, currentConversationLength, conversationHistory) => {
    setIsLoadingAI(true)
    try {
      // 获取当前上下文的想法（今日或选择的日期）
      const contextThoughts = selectedDate ? getThoughtsByDate(selectedDate) : getTodayThoughts()
      
      // 调试：打印发送的数据
      console.log('generateAIResponse - contextThoughts:', contextThoughts.length)
      console.log('generateAIResponse - aiQuestion:', aiQuestion)
      console.log('generateAIResponse - aiThinking:', aiThinking ? '存在' : '不存在')
      console.log('generateAIResponse - conversationHistory:', conversationHistory)
      console.log('generateAIResponse - userMessage:', userMessage)
      
      // 确保有初始问题（思考内容可以为空，但问题必须有）
      if (!aiQuestion) {
        console.error('缺少初始问题', { aiQuestion, aiThinking })
        setIsLoadingAI(false)
        return null
      }
      
      // 如果思考内容为空，使用默认值
      const thinkingContent = aiThinking || '基于用户想法生成的引导性问题'
      
      // 调用接口2：对话接口（流式输出）
      console.log('准备发送请求到 /api/conversation（流式）')
      
      const response = await fetch('/api/conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          thoughts: contextThoughts, // 发送想法作为上下文
          initialQuestion: aiQuestion, // 初始问题
          thinking: thinkingContent, // 思考内容（不显示给用户）
          conversation: conversationHistory, // 对话历史
          currentMessage: userMessage // 当前用户消息
        }),
      })
      
      console.log('收到响应，状态码:', response.status)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: '请求失败' }))
        throw new Error(errorData.detail || '请求失败')
      }

      // 检查是否是流式响应
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('text/event-stream')) {
        // 流式接收
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let fullReply = ''
        let buffer = ''
        
        // 创建一个临时消息用于流式显示
        const tempMessageId = Date.now()
        setConversation(prev => [
          ...prev,
          { role: 'ai', content: '', timestamp: tempMessageId, streaming: true }
        ])
        
        try {
          let done = false
          while (!done) {
            const result = await reader.read()
            done = result.done
            
            if (result.value) {
              buffer += decoder.decode(result.value, { stream: true })
              
              // 按 SSE 格式解析：data: 开头，后面跟两个换行符表示结束
              let dataStart = buffer.indexOf('data: ')
              while (dataStart !== -1) {
                // 找到 data: 后面的内容，直到遇到两个连续的换行符
                const dataContentStart = dataStart + 6 // 'data: ' 的长度
                const dataEnd = buffer.indexOf('\n\n', dataContentStart)
                
                if (dataEnd === -1) {
                  // 还没有收到完整的数据，保留在 buffer 中
                  break
                }
                
                // 提取数据内容
                const data = buffer.substring(dataContentStart, dataEnd)
                buffer = buffer.substring(dataEnd + 2) // 移除已处理的部分（包括两个换行符）
                
                const trimmedData = data.trim()
                if (trimmedData === '[DONE]') {
                  // 流式输出完成
                  done = true
                  break
                }
                if (trimmedData.startsWith('[ERROR]')) {
                  // 错误信息
                  const errorMsg = trimmedData.slice(7)
                  console.error('流式输出错误:', errorMsg)
                  setConversation(prev => prev.filter(msg => msg.timestamp !== tempMessageId))
                  throw new Error(errorMsg)
                }
                if (data) {
                  // 将后端的特殊标记 [NEWLINE] 替换回换行符
                  const decodedData = data.replace(/\[NEWLINE\]/g, '\n')
                  // 拼接解码后的数据，保留换行符
                  fullReply += decodedData
                  // 实时更新最后一条消息
                  setConversation(prev => {
                    const newConv = [...prev]
                    const lastIndex = newConv.length - 1
                    if (lastIndex >= 0 && newConv[lastIndex].timestamp === tempMessageId) {
                      newConv[lastIndex] = {
                        ...newConv[lastIndex],
                        content: fullReply,
                        streaming: true
                      }
                    }
                    return newConv
                  })
                }
                
                // 继续查找下一个 data: 
                dataStart = buffer.indexOf('data: ')
              }
            }
          }
          
          // 流式输出完成，移除streaming标记
          setConversation(prev => {
            const newConv = [...prev]
            const lastIndex = newConv.length - 1
            if (lastIndex >= 0 && newConv[lastIndex].timestamp === tempMessageId) {
              newConv[lastIndex] = {
                ...newConv[lastIndex],
                content: fullReply.trim(),
                streaming: false
              }
            }
            return newConv
          })
          
          return fullReply.trim()
        } catch (error) {
          console.error('流式读取错误:', error)
          // 如果流式读取失败，移除临时消息
          setConversation(prev => prev.filter(msg => msg.timestamp !== tempMessageId))
          throw error
        }
      } else {
        // 非流式响应（兼容旧版本）
        const data = await response.json()
        if (data.reply) {
          return data.reply
        }
        return null
      }
    } catch (error) {
      console.error('AI回复生成失败:', error)
      return null
    } finally {
      setIsLoadingAI(false)
    }
  }

  // 从dailySummary中提取AI的问题
  const extractAIQuestion = (summary) => {
    if (!summary) return null
    // 格式：今天你记录了 X 条想法。问题内容
    const match = summary.match(/今天你记录了 \d+ 条想法。(.+)/)
    return match ? match[1] : null
  }

  // 获取日期键（用于存储对话历史）
  const getDateKey = (date) => {
    const targetDate = date || getCurrentDate()
    if (typeof targetDate === 'string') {
      return targetDate
    }
    // 使用本地时间格式化：YYYY-MM-DD
    const year = targetDate.getFullYear()
    const month = String(targetDate.getMonth() + 1).padStart(2, '0')
    const day = String(targetDate.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // 保存对话历史到本地存储
  const saveConversationHistory = (dateKey, conversationData, aiQuestionData, aiThinkingData, isPaused) => {
    const key = `conversation_${dateKey}`
    const data = {
      conversation: conversationData || [],
      aiQuestion: aiQuestionData || null,
      aiThinking: aiThinkingData || null,
      isPaused: isPaused || false
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
          aiThinking: parsed.aiThinking || null,
          isPaused: parsed.isPaused || false
        }
      } catch (e) {
        console.error('加载对话历史失败:', e)
      }
    }
    return {
      conversation: [],
      aiQuestion: null,
      aiThinking: null,
      isPaused: false
    }
  }

  // 检查今天是否已封存
  const checkTodaySealed = () => {
    const todayKey = getDateKey()
    const sealedDate = localStorage.getItem('sealedDate')
    return sealedDate === todayKey
  }

  // 标记今天为已封存
  const sealToday = () => {
    const todayKey = getDateKey()
    localStorage.setItem('sealedDate', todayKey)
    setTodaySealed(true)
  }

  // 从本地存储加载数据
  useEffect(() => {
    const savedThoughts = localStorage.getItem('thoughts')
    if (savedThoughts) {
      try {
        const parsedThoughts = JSON.parse(savedThoughts)
        setThoughts(parsedThoughts)
      } catch (e) {
        console.error('加载数据失败:', e)
      }
    }
    
    // 检查今天是否已封存
    setTodaySealed(checkTodaySealed())
    
    // 加载今天的对话历史
    const todayKey = getDateKey()
    const history = loadConversationHistory(todayKey)
    if (history.conversation.length > 0 || history.aiQuestion) {
      setConversation(history.conversation)
      setAiQuestion(history.aiQuestion)
      setAiThinking(history.aiThinking)
      setConversationPaused(history.isPaused)
    }
    
    // 初始化 prevSelectedDateRef（今天，即 null）
    // 必须在加载完数据后再设置，这样后续的保存才能正常工作
    prevSelectedDateRef.current = null
  }, [])

  // 自动聚焦输入框并滚动到底部
  useEffect(() => {
    if (inputRef.current && !editingId) {
      inputRef.current.focus()
      // 滚动到底部，让文本从底部开始显示
      inputRef.current.scrollTop = inputRef.current.scrollHeight
      // 同时调整高度
      adjustTextareaHeight(inputRef.current)
    }
  }, [editingId, conversation])

  // 调整 textarea 高度的函数
  const adjustTextareaHeight = (textarea) => {
    if (!textarea) return
    textarea.style.height = 'auto' // 重置高度
    const scrollHeight = textarea.scrollHeight
    const lineHeight = 36 // 24px * 1.5
    const minHeight = lineHeight // 1行
    const maxHeight = lineHeight * 5 // 最高 5 行
    textarea.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`
  }

  // 保存到本地存储
  const saveThoughts = (newThoughts) => {
    localStorage.setItem('thoughts', JSON.stringify(newThoughts))
    setThoughts(newThoughts)
  }

  // 自动打标签和生成embedding
  const tagAndEmbedThought = async (thought) => {
    try {
      setIsLoadingTagging(true)
      const response = await fetch('/api/tag-and-embedding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ thought }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: '请求失败' }))
        console.error('打标签或生成embedding失败:', errorData.detail)
        return
      }

      const data = await response.json()
      
      // 保存embedding到本地存储
      setEmbedding(thought.id, data.embedding, thought.content, data.model)
      
      // 保存标签到想法对象（可选，如果需要显示标签）
      // 这里我们暂时不修改thoughts结构，标签可以单独存储或后续添加
      console.log(`想法 ${thought.id} 已打标签:`, data.tags)
      console.log(`想法 ${thought.id} 已生成embedding，维度:`, data.embedding.length)
      
    } catch (error) {
      console.error('打标签或生成embedding出错:', error)
    } finally {
      setIsLoadingTagging(false)
    }
  }

  // 处理用户输入
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!inputValue.trim()) return
    
    // 如果今天已封存，不允许输入
    if (todaySealed && !selectedDate) {
      return
    }

    const userMessage = inputValue.trim()
    setInputValue('')

    // 调试：打印当前状态
    console.log('handleSubmit - dailySummary:', dailySummary)
    console.log('handleSubmit - aiQuestion:', aiQuestion)
    console.log('handleSubmit - aiThinking:', aiThinking)
    console.log('handleSubmit - conversation.length:', conversation.length)

    // 判断是否应该进入对话模式：
    // 1. 如果有对话历史，说明已经开始了对话，应该继续对话
    // 2. 如果有AI问题（aiQuestion），说明已经触发了AI总结，应该进入对话模式
    // 只有在既没有对话历史，也没有AI问题的情况下，才保存为卡片
    const shouldEnterConversation = conversation.length > 0 || aiQuestion
    
    if (!shouldEnterConversation) {
      console.log('没有AI总结或对话历史，直接保存为卡片')
      const newThought = {
        id: Date.now(),
        content: userMessage,
        createdAt: getCurrentTimestamp() // 如果选择了日期，使用选择的日期
      }
      const updatedThoughts = [...thoughts, newThought]
      saveThoughts(updatedThoughts)
      
      // 异步打标签和生成embedding（不阻塞保存）
      tagAndEmbedThought(newThought).catch(err => {
        console.error('后台打标签失败:', err)
      })
      
      return
    }

    // 如果有AI总结，进入对话模式
    console.log('进入对话模式，准备调用AI')
    // 如果是第一次回复且有AI引导问题，先将AI问题加入对话流
    let newConversation = [...conversation]
    if (conversation.length === 0 && aiQuestion) {
      newConversation = [
        { role: 'ai', content: aiQuestion, timestamp: Date.now() }
      ]
    }

    // 立即添加用户消息到对话流，让用户看到自己的输入变成气泡
    newConversation = [
      ...newConversation,
      { role: 'user', content: userMessage, timestamp: Date.now() }
    ]
    setConversation(newConversation)

    // AI 生成回复（流式输出）
    // 注意：传入的 conversationHistory 不包含当前用户消息，因为后端会单独添加 currentMessage
    // 但为了前端显示，我们已经将用户消息添加到 newConversation 中
    const conversationHistoryForAPI = newConversation.slice(0, -1) // 移除最后一条（当前用户消息）
    console.log('调用 generateAIResponse（流式）')
    
    // 流式输出会在 generateAIResponse 内部更新 conversation
    // 所以这里不需要再次添加AI回复
    const aiReply = await generateAIResponse(userMessage, newConversation.length, conversationHistoryForAPI)
    console.log('generateAIResponse 完成，最终回复长度:', aiReply ? aiReply.length : 0)
    
    if (!aiReply) {
      console.error('generateAIResponse 返回 null，AI回复失败')
      // 如果流式输出失败，移除可能创建的临时消息
      setConversation(prev => prev.filter(msg => !msg.streaming))
    }
  }


  // 删除想法
  const handleDelete = (id) => {
    setShowDeleteConfirm(id)
  }

  const confirmDelete = () => {
    if (showDeleteConfirm) {
      const updatedThoughts = thoughts.filter((thought) => thought.id !== showDeleteConfirm)
      saveThoughts(updatedThoughts)
      // 删除对应的embedding
      deleteEmbedding(showDeleteConfirm)
      setShowDeleteConfirm(null)
    }
  }

  const cancelDelete = () => {
    setShowDeleteConfirm(null)
  }

  // 开始编辑
  const handleStartEdit = (thought) => {
    setEditingId(thought.id)
    setEditingContent(thought.content)
  }

  // 保存编辑
  const handleSaveEdit = (id) => {
    if (editingContent.trim()) {
      const updatedThoughts = thoughts.map((thought) =>
        thought.id === id
          ? { ...thought, content: editingContent.trim() }
          : thought
      )
      saveThoughts(updatedThoughts)
      
      // 重新生成embedding（内容已变化）
      const editedThought = updatedThoughts.find(t => t.id === id)
      if (editedThought && needsReembedding(id, editedThought.content)) {
        tagAndEmbedThought(editedThought).catch(err => {
          console.error('重新生成embedding失败:', err)
        })
      }
      
      setEditingId(null)
      setEditingContent('')
    }
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingContent('')
  }

  // 获取指定日期的想法
  const getThoughtsByDate = (date) => {
    if (!date) return thoughts
    const targetDate = new Date(date)
    targetDate.setHours(0, 0, 0, 0)
    return thoughts.filter((thought) => {
      const thoughtDate = new Date(thought.createdAt)
      thoughtDate.setHours(0, 0, 0, 0)
      return thoughtDate.getTime() === targetDate.getTime()
    })
  }

  // 获取有记录的日期
  const getDatesWithThoughts = () => {
    const datesSet = new Set()
    thoughts.forEach((thought) => {
      const date = new Date(thought.createdAt)
      date.setHours(0, 0, 0, 0)
      datesSet.add(date.getTime())
    })
    return Array.from(datesSet).map((timestamp) => new Date(timestamp))
  }

  // 获取指定日期的记录数量
  const getThoughtCountByDate = (date) => {
    const targetDate = new Date(date)
    targetDate.setHours(0, 0, 0, 0)
    return thoughts.filter((thought) => {
      const thoughtDate = new Date(thought.createdAt)
      thoughtDate.setHours(0, 0, 0, 0)
      return thoughtDate.getTime() === targetDate.getTime()
    }).length
  }

  // 获取当月所有日期的最大记录数（用于归一化热力图）
  const getMaxThoughtCountInMonth = () => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    let maxCount = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day)
      const count = getThoughtCountByDate(date)
      if (count > maxCount) {
        maxCount = count
      }
    }
    return maxCount
  }

  // 根据记录数量计算热力图颜色强度（0-1）
  const getHeatmapIntensity = (count, maxCount) => {
    if (count === 0) return 0
    if (maxCount === 0) return 0
    // 使用平方根函数使颜色分布更平滑
    return Math.sqrt(count / maxCount)
  }

  // 生成日历数据
  const generateCalendar = () => {
    const today = getCurrentDate()
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    const datesWithThoughts = getDatesWithThoughts()
    const todayTimestamp = new Date(today.getFullYear(), today.getMonth(), today.getDate()).setHours(0, 0, 0, 0)
    const maxCount = getMaxThoughtCountInMonth()
    
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1
      const date = new Date(currentYear, currentMonth, day)
      date.setHours(0, 0, 0, 0)
      const dateTimestamp = date.getTime()
      const thoughtCount = getThoughtCountByDate(date)
      const hasThoughts = thoughtCount > 0
      const isToday = currentYear === today.getFullYear() && 
                      currentMonth === today.getMonth() && 
                      dateTimestamp === todayTimestamp
      const isSelected = selectedDate && dateTimestamp === selectedDate.getTime()
      const isFuture = dateTimestamp > todayTimestamp
      const heatmapIntensity = getHeatmapIntensity(thoughtCount, maxCount)
      
      return {
        day,
        date,
        hasThoughts,
        thoughtCount,
        heatmapIntensity,
        isToday,
        isSelected,
        isFuture,
      }
    })
  }

  // 处理日历点击
  const handleCalendarClick = (date) => {
    const today = getCurrentDate()
    const dateTimestamp = date.getTime()
    const todayTimestamp = today.getTime()
    
    // 未来日期处理
    if (dateTimestamp > todayTimestamp) {
      // 点击未来日期时，暂时清空当前显示的内容
      setConversation([])
      setAiQuestion(null)
      setDailySummary(null)
      
      // 设置提示语，不再设置计时器，使其持久显示
      setFutureDateMessage('别急，未来还未来呢')
      setSelectedDate(date) // 记录选中的未来日期，以便隐藏输入框
      return
    }

    // 点击有效日期时，清除未来日期的提示
    setFutureDateMessage('')

    // 如果点击的是今日，始终取消选择（今日是默认视图）
    if (dateTimestamp === todayTimestamp) {
      setSelectedDate(null)
      return
    }

    // 其他日期：如果已选中则取消，否则选中
    if (selectedDate && dateTimestamp === selectedDate.getTime()) {
      setSelectedDate(null)
    } else {
      setSelectedDate(date)
    }
  }

  // 切换年月
  const changeMonth = (direction) => {
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11)
        setCurrentYear(currentYear - 1)
      } else {
        setCurrentMonth(currentMonth - 1)
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0)
        setCurrentYear(currentYear + 1)
      } else {
        setCurrentMonth(currentMonth + 1)
      }
    }
    setSelectedDate(null) // 切换月份时清除选择
  }

  // 获取显示的想法列表（根据选中日期过滤）
  const displayThoughts = selectedDate ? getThoughtsByDate(selectedDate) : getTodayThoughts()

  // 初始状态欢迎语
  const [showWelcome, setShowWelcome] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setShowWelcome(false), 2000)
    return () => clearTimeout(timer)
  }, [])


  // 历史洞察（跨日期呼应分析）- 作为AI对话的起始
  const handleCrossDateInsight = async () => {
    const todayThoughts = getTodayThoughts()
    if (todayThoughts.length === 0) {
      alert('今日还没有记录任何想法')
      return
    }

    setIsLoadingCrossInsight(true)
    try {
      // 获取所有历史想法（排除今日）
      const today = getCurrentDate()
      const allHistoryThoughts = thoughts.filter((thought) => {
        const thoughtDate = new Date(thought.createdAt)
        thoughtDate.setHours(0, 0, 0, 0)
        return thoughtDate.getTime() < today.getTime()
      })

      if (allHistoryThoughts.length === 0) {
        // 如果没有历史记录，设置一个简单的AI问题
        setAiQuestion('还没有历史记录，让我们从今天开始吧。')
        setAiThinking('')
        setConversation([])
        setIsLoadingCrossInsight(false)
        return
      }

      // 在embedding阶段就去重：按内容去重，保留日期最新的
      const contentMap = new Map() // key: 内容, value: thought对象
      allHistoryThoughts.forEach(thought => {
        const existing = contentMap.get(thought.content)
        if (!existing) {
          // 第一次遇到这个内容，直接添加
          contentMap.set(thought.content, thought)
        } else {
          // 已存在，比较日期，保留更新的
          const existingDate = new Date(existing.createdAt).getTime()
          const currentDate = new Date(thought.createdAt).getTime()
          if (currentDate > existingDate) {
            // 当前日期更新，替换
            contentMap.set(thought.content, thought)
          }
        }
      })
      const uniqueHistoryThoughts = Array.from(contentMap.values())
      
      console.log(`历史想法去重：${allHistoryThoughts.length} 条 → ${uniqueHistoryThoughts.length} 条`)

      // 获取去重后历史想法的embedding（从本地存储）
      const historyThoughtsWithEmbeddings = []
      for (const thought of uniqueHistoryThoughts) {
        const embedding = getEmbedding(thought.id)
        historyThoughtsWithEmbeddings.push({
          id: thought.id,
          content: thought.content,
          createdAt: thought.createdAt,
          embedding: embedding ? embedding.vector : null  // 如果有embedding就传递，没有就传null让后端计算
        })
      }

      // 调用后端接口
      const response = await fetch('/api/cross-date-insight', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          todayThoughts: todayThoughts,
          historyThoughts: historyThoughtsWithEmbeddings  // 传递包含embedding的历史想法
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: '请求失败' }))
        throw new Error(errorData.detail || '请求失败')
      }

      const data = await response.json()
      
      // 如果后端重新计算了某些想法的embedding，保存到本地存储
      if (data.computedEmbeddings && data.computedEmbeddings.length > 0) {
        console.log(`收到 ${data.computedEmbeddings.length} 个重新计算的embedding，正在保存...`)
        for (const item of data.computedEmbeddings) {
          // 找到对应的想法内容（用于计算hash）- 使用去重后的列表
          const thought = uniqueHistoryThoughts.find(t => t.id === item.thoughtId)
          if (thought) {
            setEmbedding(item.thoughtId, item.embedding, thought.content, item.model)
            console.log(`已保存想法 ${item.thoughtId} 的embedding`)
          }
        }
      }
      
      // 将历史洞察结果作为AI对话的起始
      // 如果有呼应关系，使用洞察总结作为AI问题；如果没有，使用默认提示
      let newAiQuestion = ''
      let newAiThinking = ''
      
      if (data.echoes && data.echoes.length > 0) {
        // 构建一个包含呼应关系的AI问题
        const echoSummary = data.summary
        newAiQuestion = `${echoSummary}`
        newAiThinking = JSON.stringify(data.echoes) // 保存呼应关系数据，供后续对话使用
      } else {
        // 没有呼应关系，使用默认提示
        newAiQuestion = data.summary
        newAiThinking = ''
      }
      
      // 设置状态
      setAiQuestion(newAiQuestion)
      setAiThinking(newAiThinking)
      
      // 清空之前的对话，开始新的对话
      setConversation([])
      setConversationPaused(false)
      
      // 立即保存到本地存储（确保持久化）
      const dateKey = selectedDate ? getDateKey(selectedDate) : getDateKey()
      saveConversationHistory(dateKey, [], newAiQuestion, newAiThinking, false)
      
    } catch (error) {
      console.error('历史洞察失败:', error)
      alert('历史洞察失败: ' + error.message)
    } finally {
      setIsLoadingCrossInsight(false)
    }
  }

  // 处理选择日期的AI洞察（接口1：今日洞察）
  const handleSelectedDateInsight = async () => {
    if (!selectedDate) return
    
    // 获取用户选择的日期当天的所有想法
    const dateThoughts = getThoughtsByDate(selectedDate)
    if (dateThoughts.length === 0) {
      return
    }

    setIsLoadingSummary(true)
    try {
      // 格式化选择的日期为 YYYY-MM-DD
      const selectedDateStr = selectedDate.toISOString().split('T')[0]
      
      // 调试：打印发送的数据
      console.log('选择的日期:', selectedDateStr)
      console.log('该日期的想法:', dateThoughts.map(t => t.content))
      
      // 调用接口1：今日洞察
      const response = await fetch('/api/insight', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          thoughts: dateThoughts,
          selectedDate: selectedDateStr // 传递选择的日期
        }),
      })

      const data = await response.json()

      if (response.ok && data.question) {
        const summaryText = `这天你记录了 ${dateThoughts.length} 条想法。`
        setDailySummary(summaryText)
        setAiQuestion(data.question) // 单独保存AI问题
        setAiThinking(data.thinking || '') // 保存思考内容（不显示给用户）
        // 调试：打印AI返回的问题和思考内容
        console.log('AI返回的问题:', data.question)
        console.log('AI思考内容（不显示）:', data.thinking)
      } else {
        const summaryText = `这天你记录了 ${dateThoughts.length} 条想法。`
        setDailySummary(summaryText)
        setAiQuestion(null)
        setAiThinking(null)
      }
    } catch (error) {
      console.error('获取AI洞察失败:', error)
      const summaryText = `这天你记录了 ${dateThoughts.length} 条想法。`
      setDailySummary(summaryText)
      setAiQuestion(null)
      setAiThinking(null)
    } finally {
      setIsLoadingSummary(false)
    }
  }

  // 自动保存对话历史到本地存储（只在对话内容变化时保存）
  useEffect(() => {
    // 如果没有任何内容，不进行保存（防止初始化时覆盖已有内容）
    if (conversation.length === 0 && !aiQuestion) {
      return
    }

    // 跳过初始加载时的保存（此时 prevSelectedDateRef.current 还是 null，表示还未初始化）
    if (prevSelectedDateRef.current === null && conversation.length === 0) {
      return
    }
    
    // 保存到当前选中的日期（使用 ref 中的值，而不是 state，避免在切换日期时错误保存）
    const currentDateKey = prevSelectedDateRef.current !== null
      ? (prevSelectedDateRef.current ? getDateKey(prevSelectedDateRef.current) : getDateKey())
      : getDateKey()
    saveConversationHistory(currentDateKey, conversation, aiQuestion, aiThinking, conversationPaused)
  }, [conversation, aiQuestion, aiThinking, conversationPaused])

  // 当选中日期改变时，先保存旧日期的数据，再加载新日期的对话历史
  useEffect(() => {
    // 如果 selectedDate 改变了，先保存旧日期的对话历史
    if (prevSelectedDateRef.current !== selectedDate) {
      // 只有在不是初始加载时才保存（prevSelectedDateRef.current !== null）
      if (prevSelectedDateRef.current !== null) {
        const prevDateKey = prevSelectedDateRef.current 
          ? getDateKey(prevSelectedDateRef.current) 
          : getDateKey()
        // 保存旧日期的对话历史（使用当前的 conversation、aiQuestion、aiThinking）
        saveConversationHistory(prevDateKey, conversation, aiQuestion, aiThinking, conversationPaused)
      }
      
      // 更新 ref
      prevSelectedDateRef.current = selectedDate
    }

    if (selectedDate) {
      const dateThoughts = getThoughtsByDate(selectedDate)
      if (dateThoughts.length > 0) {
        const summaryText = `那天你记录了 ${dateThoughts.length} 条想法。`
        setDailySummary(summaryText)
      } else {
        setDailySummary('那天你选择了留白，也很好')
      }
      
      // 加载该日期的对话历史
      const dateKey = getDateKey(selectedDate)
      const history = loadConversationHistory(dateKey)
      setAiQuestion(history.aiQuestion)
      setAiThinking(history.aiThinking)
      setConversation(history.conversation)
      setConversationPaused(history.isPaused)
    } else {
      // 取消选择日期，回到今天
      setDailySummary('')
      
      // 加载今天的对话历史
      const todayKey = getDateKey()
      const history = loadConversationHistory(todayKey)
      setAiQuestion(history.aiQuestion)
      setAiThinking(history.aiThinking)
      setConversation(history.conversation)
      setConversationPaused(history.isPaused)
    }
  }, [selectedDate, thoughts.length])

  // 将对话存入卡片（定稿）- 包括AI的初始问题
  // 处理"今天就到这吧"按钮点击 - 不再保存为卡片，而是暂停对话并显示道别
  const handleSaveClick = () => {
    // 不保存为卡片，只暂停对话
    setConversationPaused(true)
    // 显示道别界面
    setShowFarewell(true)
    // 2秒后隐藏道别界面
    setTimeout(() => {
      setShowFarewell(false)
    }, 2000)
    
    // 立即保存暂停状态
    const dateKey = selectedDate ? getDateKey(selectedDate) : getDateKey()
    saveConversationHistory(dateKey, conversation, aiQuestion, aiThinking, true)
  }

  // 继续对话（点击"…"后）
  const handleResumeConversation = () => {
    setConversationPaused(false)
    setTodaySealed(false) // 取消封存，允许继续对话
    // 聚焦输入框
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  // 清除对话确认
  const handleClearConversationClick = () => {
    setShowClearConversationConfirm(true)
  }

  // 确认清除对话
  const confirmClearConversation = () => {
    // 清除所有对话相关状态
    setConversation([])
    setAiQuestion(null)
    setAiThinking(null)
    setConversationPaused(false)
    setTodaySealed(false) // 取消封存，允许继续输入
    
    // 清除本地存储的对话历史
    const dateKey = selectedDate ? getDateKey(selectedDate) : getDateKey()
    saveConversationHistory(dateKey, [], null, null, false)
    
    setShowClearConversationConfirm(false)
    
    // 聚焦输入框
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  // 取消清除对话
  const cancelClearConversation = () => {
    setShowClearConversationConfirm(false)
  }

  // 快捷键处理：Cmd/Ctrl + Enter 存入对话
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        // 如果今天已封存，不允许操作
        if (todaySealed && !selectedDate) {
          return
        }
        if (conversation.length > 0 || (aiQuestion && !selectedDate)) {
          if (!conversationPaused) {
            handleSaveClick()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [conversation, dailySummary, selectedDate, conversationPaused, todaySealed])

  // 自动滚动到对话底部
  const conversationEndRef = useRef(null)
  useEffect(() => {
    if (conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [conversation, isLoadingAI])

  // 格式化日期
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now - date
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`

    let relativeTime = ''
    if (minutes < 1) {
      relativeTime = '刚刚'
    } else if (minutes < 60) {
      relativeTime = `${minutes}分钟前`
    } else if (hours < 24) {
      relativeTime = `${hours}小时前`
    } else if (days < 7) {
      relativeTime = `${days}天前`
    } else {
      relativeTime = '更早'
    }

    return `${dateStr} - ${relativeTime}`
  }

  const calendarDays = generateCalendar()
  const monthNames = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']

  if (showWelcome) {
    return (
      <div className="welcome-screen">
        <div className="welcome-logo">ECHO</div>
      </div>
    )
  }

  // 道别界面
  if (showFarewell) {
    return (
      <div className="welcome-screen">
        <div className="farewell-content">
          <p className="farewell-title">今天又完成了一次记录</p>
          <p className="farewell-subtitle">好好休息，下次见~</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* 左侧区域：日历和今日总结 */}
      <div className="left-zone">
        {/* 年月选择器 */}
        <div className="month-selector">
          <button 
            className="month-nav-btn"
            onClick={() => changeMonth('prev')}
            aria-label="上一月"
          >
            ‹
          </button>
          <span className="month-year">
            {currentYear}.{monthNames[currentMonth]}
          </span>
          <button 
            className="month-nav-btn"
            onClick={() => changeMonth('next')}
            aria-label="下一月"
          >
            ›
          </button>
        </div>

        {/* 极简日历 */}
        <div className="zen-calendar">
          {calendarDays.map((item, index) => {
            // 计算热力图背景色（所有有记录的日期都显示，包括今天）
            const heatmapBg = item.heatmapIntensity > 0
              ? `rgba(255, 215, 0, ${item.heatmapIntensity * 0.4})`
              : undefined
            
            return (
              <button
                key={index}
                className={`calendar-dot ${item.hasThoughts ? 'has-thoughts' : ''} ${
                  item.isToday ? 'is-today' : ''
                } ${item.isSelected ? 'is-selected' : ''} ${
                  item.isFuture ? 'is-future' : ''
                }`}
                onClick={() => handleCalendarClick(item.date)}
                title={`${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, '0')}-${String(item.day).padStart(2, '0')}${item.thoughtCount > 0 ? ` (${item.thoughtCount}条)` : ''}`}
                style={{
                  backgroundColor: heatmapBg
                }}
              >
                {item.day}
              </button>
            )
          })}
        </div>

      </div>

      {/* 中央区域：对话区 */}
      <div className={`center-zone ${(conversation.length > 0) ? 'has-conversation' : 'no-conversation'}`}>
        {/* 未来日期提示 */}
        {futureDateMessage && (
          <div className="future-date-message">
            {futureDateMessage}
          </div>
        )}

        {/* AI开场白 */}
        {conversation.length === 0 && thoughts.length === 0 && !dailySummary && (
          <div className="ai-greeting">
            <p>你想到什么了？</p>
          </div>
        )}

        {/* 历史想法列表（如果有历史洞察数据，始终显示在对话流上方） */}
        {(() => {
          try {
            if (aiThinking) {
              const echoes = JSON.parse(aiThinking)
              if (Array.isArray(echoes) && echoes.length > 0) {
                // 收集所有相关的历史想法
                const relatedThoughts = []
                echoes.forEach(echo => {
                  if (echo.relatedThoughts && Array.isArray(echo.relatedThoughts)) {
                    echo.relatedThoughts.forEach(rel => {
                      if (rel.historyThought) {
                        relatedThoughts.push({
                          content: rel.historyThought.content,
                          date: rel.historyThought.createdAt,
                          similarity: rel.similarity
                        })
                      }
                    })
                  }
                })
                
                // 去重（仅基于内容，保留日期最新的）
                const contentMap = new Map()
                relatedThoughts.forEach(thought => {
                  const existing = contentMap.get(thought.content)
                  if (!existing) {
                    contentMap.set(thought.content, thought)
                  } else {
                    const existingDate = new Date(existing.date).getTime()
                    const currentDate = new Date(thought.date).getTime()
                    if (currentDate > existingDate) {
                      contentMap.set(thought.content, thought)
                    }
                  }
                })
                const uniqueThoughts = Array.from(contentMap.values())
                
                // 按日期从新到旧排序
                uniqueThoughts.sort((a, b) => {
                  const dateA = new Date(a.date).getTime()
                  const dateB = new Date(b.date).getTime()
                  return dateB - dateA
                })
                
                if (uniqueThoughts.length > 0) {
                  return (
                    <div style={{
                      marginBottom: '20px',
                      paddingBottom: '16px',
                      borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
                      textAlign: 'left'
                    }}>
                      <ul style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                        fontSize: '12px',
                        color: 'rgba(0, 0, 0, 0.5)',
                        lineHeight: '1.6',
                        textAlign: 'left'
                      }}>
                        {uniqueThoughts.map((thought, idx) => {
                          const dateStr = new Date(thought.date).toISOString().substring(0, 10)
                          return (
                            <li key={idx} style={{ marginBottom: '4px', textAlign: 'left' }}>
                              <span style={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                                {thought.content}
                              </span>
                              <span style={{ 
                                marginLeft: '8px', 
                                color: 'rgba(0, 0, 0, 0.4)',
                                fontSize: '11px'
                              }}>
                                - {dateStr}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                }
              }
            }
          } catch (e) {
            // 如果解析失败，忽略
          }
          return null
        })()}

        {/* 对话流（临时，浅色） */}
        {conversation.length > 0 && (
          <div className="conversation-flow">
            {/* 显示对话历史（包括AI的引导问题） */}
            {conversation.map((msg, index) => (
              <div 
                key={index} 
                className={`conversation-message ${msg.role === 'user' ? 'user-message' : 'ai-message'}`}
              >
                <div className="message-bubble">
                  <span 
                    className="message-content" 
                    dangerouslySetInnerHTML={renderMarkdown(msg.content)}
                  />
                </div>
              </div>
            ))}
            {isLoadingAI && (
              <div className="conversation-message ai-message">
                <div className="message-bubble">
                  <span className="message-content typing">思考中...</span>
                </div>
              </div>
            )}
            <div ref={conversationEndRef} />
            
            {/* 继续对话按钮（"…"）和清除对话按钮 - 当对话已暂停时显示在对话下方 */}
            {conversationPaused && (
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={handleResumeConversation}
                  className="resume-conversation-btn"
                  title="继续说点什么"
                >
                  …
                </button>
                <button
                  type="button"
                  onClick={handleClearConversationClick}
                  className="clear-conversation-btn"
                  title="清除对话"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.borderColor = 'rgba(39, 10, 10, 0.5)'
                    e.target.style.color = 'rgba(0, 0, 0, 0.9)'
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                    e.target.style.color = 'rgba(255, 255, 255, 0.7)'
                  }}
                >
                  清除对话
                </button>
              </div>
            )}
          </div>
        )}

        {/* 初始AI引导问题 - 居中显示 */}
        {conversation.length === 0 && aiQuestion && (
          <div className="initial-ai-question">
            {/* 历史想法列表（如果有历史洞察数据） */}
            {(() => {
              try {
                if (aiThinking) {
                  const echoes = JSON.parse(aiThinking)
                  if (Array.isArray(echoes) && echoes.length > 0) {
                    // 收集所有相关的历史想法
                    const relatedThoughts = []
                    echoes.forEach(echo => {
                      if (echo.relatedThoughts && Array.isArray(echo.relatedThoughts)) {
                        echo.relatedThoughts.forEach(rel => {
                          if (rel.historyThought) {
                            relatedThoughts.push({
                              content: rel.historyThought.content,
                              date: rel.historyThought.createdAt,
                              similarity: rel.similarity
                            })
                          }
                        })
                      }
                    })
                    
                    // 去重（仅基于内容，保留日期最新的）
                    const contentMap = new Map() // key: 内容, value: {content, date, similarity}
                    relatedThoughts.forEach(thought => {
                      const existing = contentMap.get(thought.content)
                      if (!existing) {
                        // 第一次遇到这个内容，直接添加
                        contentMap.set(thought.content, thought)
                      } else {
                        // 已存在，比较日期，保留更新的
                        const existingDate = new Date(existing.date).getTime()
                        const currentDate = new Date(thought.date).getTime()
                        if (currentDate > existingDate) {
                          // 当前日期更新，替换
                          contentMap.set(thought.content, thought)
                        }
                      }
                    })
                    const uniqueThoughts = Array.from(contentMap.values())
                    
                    // 按日期从新到旧排序
                    uniqueThoughts.sort((a, b) => {
                      const dateA = new Date(a.date).getTime()
                      const dateB = new Date(b.date).getTime()
                      return dateB - dateA // 从新到旧
                    })
                    
                    if (uniqueThoughts.length > 0) {
                      return (
                        <div style={{
                          marginBottom: '16px',
                          paddingBottom: '16px',
                          borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
                          textAlign: 'left' // 左对齐
                        }}>
                          <ul style={{
                            listStyle: 'none',
                            padding: 0,
                            margin: 0,
                            fontSize: '12px',
                            color: 'rgba(0, 0, 0, 0.5)', // 深色文字，在米白色背景上更清晰
                            lineHeight: '1.6',
                            textAlign: 'left' // 左对齐
                          }}>
                            {uniqueThoughts.map((thought, idx) => {
                              const dateStr = new Date(thought.date).toISOString().substring(0, 10)
                              return (
                                <li key={idx} style={{ marginBottom: '4px', textAlign: 'left' }}>
                                  <span style={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                                    {thought.content}
                                  </span>
                                  <span style={{ 
                                    marginLeft: '8px', 
                                    color: 'rgba(0, 0, 0, 0.4)',
                                    fontSize: '11px'
                                  }}>
                                    - {dateStr}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )
                    }
                  }
                }
              } catch (e) {
                // 如果解析失败，忽略
              }
              return null
            })()}
            
            <p dangerouslySetInnerHTML={renderMarkdown(aiQuestion)} />
            
            {/* 继续对话按钮（"…"）和清除对话按钮 - 当对话已暂停时显示在问题下方 */}
            {conversationPaused && (
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={handleResumeConversation}
                  className="resume-conversation-btn"
                  title="继续说点什么"
                >
                  …
                </button>
                <button
                  type="button"
                  onClick={handleClearConversationClick}
                  className="clear-conversation-btn"
                  title="清除对话"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.5)'
                    e.target.style.color = 'rgba(255, 255, 255, 0.9)'
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                    e.target.style.color = 'rgba(255, 255, 255, 0.7)'
                  }}
                >
                  清除对话
                </button>
              </div>
            )}
          </div>
        )}

        {/* "今天就到这吧"和"清除对话"按钮 - 放在整体布局左侧 */}
        {(conversation.length > 0 || aiQuestion) && !conversationPaused && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleSaveClick}
              className="save-conversation-btn-standalone"
              title="今天就到这吧 (Cmd/Ctrl + Enter)"
            >
              今天就到这吧
            </button>
            <button
              type="button"
              onClick={handleClearConversationClick}
              className="clear-conversation-btn"
              title="清除对话"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                color: 'rgba(255, 255, 255, 0.7)',
                padding: '8px 16px',
                borderRadius: '20px',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.5)'
                e.target.style.color = 'rgba(255, 255, 255, 0.9)'
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                e.target.style.color = 'rgba(255, 255, 255, 0.7)'
              }}
            >
              清除对话
            </button>
          </div>
        )}


        {/* 删除确认对话框 */}
        {showDeleteConfirm && (
          <div className="save-confirm-dialog">
            <div className="confirm-content">
              <p className="confirm-title">确认删除</p>
              <p className="confirm-message">这条想法将永久消失，确定吗？</p>
              <div className="confirm-actions">
                <button
                  onClick={confirmDelete}
                  className="confirm-btn delete-confirm-btn"
                >
                  删除
                </button>
                <button
                  onClick={cancelDelete}
                  className="cancel-confirm-btn"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 清除对话确认对话框 */}
        {showClearConversationConfirm && (
          <div className="save-confirm-dialog">
            <div className="confirm-content">
              <p className="confirm-title">确认清除对话</p>
              <p className="confirm-message">清除后，当前对话历史将消失，但想法记录会保留。确定要清除吗？</p>
              <div className="confirm-actions">
                <button
                  onClick={confirmClearConversation}
                  className="confirm-btn"
                >
                  清除
                </button>
                <button
                  onClick={cancelClearConversation}
                  className="cancel-confirm-btn"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 今天已封存的鼓励信息 */}
        {todaySealed && !selectedDate && (
          <div className="sealed-message">
            <div className="sealed-content">
              <p className="sealed-title">今天又完成了一次记录</p>
              <p className="sealed-subtitle">好好休息，下次见~</p>
            </div>
          </div>
        )}

      </div>

      {/* 输入胶囊 - 根据对话状态决定定位方式 */}
      {(!todaySealed || selectedDate) && !futureDateMessage && (
        // 如果有AI对话且处于暂停状态，隐藏输入框显示 "..." 按钮
        // 但对于没有AI对话的日期，始终显示输入框
        ((conversation.length === 0 && !aiQuestion) || !conversationPaused) ? (
          <form 
            onSubmit={handleSubmit} 
            className={`input-capsule-form ${
              (conversation.length > 0 || aiQuestion) ? 'has-conversation is-fixed' : 'no-conversation is-centered'
            }`}
          >
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  // 自动调整高度
                  adjustTextareaHeight(e.target)
                  // 滚动到底部
                  setTimeout(() => {
                    if (e.target) {
                      e.target.scrollTop = e.target.scrollHeight
                    }
                  }, 0)
                }}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onKeyDown={(e) => {
                  // Enter 键发送消息 (不按 Shift 且不是输入法组合状态)
                  if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                    e.preventDefault()
                    handleSubmit(e)
                  }
                  // Cmd/Ctrl + Enter 也可以发送（兼容用户习惯）
                  else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isComposing) {
                    e.preventDefault()
                    handleSubmit(e)
                  }
                }}
                placeholder={
                  conversation.length > 0 || aiQuestion
                    ? "继续对话..." 
                    : "写下你的想法..."
                }
                className="input-capsule"
                autoFocus
                disabled={todaySealed && !selectedDate}
                rows={1}
              />
              <button 
                type="button"
                className={`voice-input-btn ${isRecording ? 'recording' : ''}`}
                onClick={handleVoiceInput}
                title={isRecording ? "停止录音" : "语音输入"}
              >
                {isRecording ? (
                  <div style={{width: 12, height: 12, background: '#ff4d4f', borderRadius: 2}}></div>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 14C14.2091 14 16 12.2091 16 10V5C16 2.79086 14.2091 1 12 1C9.79086 1 8 2.79086 8 5V10C8 12.2091 9.79086 14 12 14Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M19 10V12C19 15.866 15.866 19 12 19M5 10V12C5 15.866 8.13401 19 12 19M12 19V23M8 23H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>
          </form>
        ) : null
      )}

      {/* 右侧区域：卡片流 */}
      <div className="right-zone">
        {/* 只在非未来日期显示卡片流相关的总结和想法 */}
        {!(selectedDate && selectedDate.getTime() > getCurrentDate().getTime()) && (
          <>
            {/* 今日总结 - 位于卡片流上方 */}
            {!selectedDate && getTodayThoughts().length > 0 && !todaySealed && (
              <div className="daily-summary-bar">
                <span className="summary-text">
                  今天你记录了 {getTodayThoughts().length} 条想法
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className={`summary-trigger-btn ${isLoadingSummary ? 'loading' : ''}`}
                    onClick={handleSummaryClick}
                    disabled={isLoadingSummary}
                    title="今日总结"
                  >
                    <span className="refresh-icon">✨</span>
                  </button>
                  <button 
                    className={`summary-trigger-btn ${isLoadingCrossInsight ? 'loading' : ''}`}
                    onClick={handleCrossDateInsight}
                    disabled={isLoadingCrossInsight}
                    title="历史洞察"
                  >
                    <span className="refresh-icon">🔗</span>
                  </button>
                </div>
              </div>
            )}

            {/* 选择日期的总结 - 位于卡片流上方 */}
            {selectedDate && getThoughtsByDate(selectedDate).length > 0 && (
              <div className="daily-summary-bar">
                <span className="summary-text">
                  这天你记录了 {getThoughtsByDate(selectedDate).length} 条想法
                </span>
                <button 
                  className={`summary-trigger-btn ${isLoadingSummary ? 'loading' : ''}`}
                  onClick={handleSelectedDateInsight}
                  disabled={isLoadingSummary}
                  title="今日洞察"
                >
                  <span className="refresh-icon">✨</span>
                </button>
              </div>
            )}

            {/* 总结确认对话框 */}
            {showSummaryConfirm && (
              <div className="save-confirm-dialog">
                <div className="confirm-content">
                  <p className="confirm-title">确认总结</p>
                  <p className="confirm-message">今日总结后将无法再输入新的想法，是否继续？</p>
                  <div className="confirm-actions">
                    <button
                      onClick={handleConfirmSummary}
                      className="confirm-btn"
                    >
                      继续
                    </button>
                    <button
                      onClick={handleCancelSummary}
                      className="cancel-confirm-btn"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="thoughts-stream">
              {displayThoughts.length === 0 ? (
                <div className="empty-state">
                  {selectedDate ? (
                    <p className="empty-message">那天你选择了留白，也很好</p>
                  ) : (
                    <p className="empty-message">还没有记录任何想法</p>
                  )}
                </div>
              ) : (
                displayThoughts.map((thought) => (
                  <div key={thought.id} className="thought-card-mini">
                    {editingId === thought.id ? (
                      <div className="edit-mode-mini">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="edit-input-mini"
                          rows="2"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              handleCancelEdit()
                            } else if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              handleSaveEdit(thought.id)
                            }
                          }}
                        />
                        <div className="edit-actions-mini">
                          <button
                            onClick={() => handleSaveEdit(thought.id)}
                            className="save-btn-mini"
                            disabled={!editingContent.trim()}
                          >
                            保存
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="cancel-btn-mini"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className="thought-content-mini"
                          onClick={() => handleStartEdit(thought)}
                          title="点击编辑"
                        >
                          {thought.content}
                        </div>
                        <div className="thought-time-mini">
                          {formatDate(thought.createdAt)}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(thought.id);
                          }}
                          className="delete-btn-mini"
                          aria-label="删除"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default App
