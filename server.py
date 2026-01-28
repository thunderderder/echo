from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import os
from pathlib import Path
from openai import AsyncOpenAI
from datetime import datetime
from dotenv import load_dotenv
import shutil
import httpx
from io import BytesIO

# 加载 .env 文件（自动处理 BOM）
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    try:
        with open(env_path, 'rb') as f:
            content = f.read()
            # 移除 UTF-8 BOM (EF BB BF)
            if content.startswith(b'\xef\xbb\xbf'):
                content = content[3:]
            
            # 写入临时文件（无 BOM）
            temp_env = env_path.parent / ".env.temp"
            with open(temp_env, 'wb') as f:
                f.write(content)
            
            # 从临时文件加载
            load_dotenv(dotenv_path=temp_env, override=True)
            
            # 删除临时文件
            try:
                temp_env.unlink()
            except:
                pass
    except Exception:
        # 如果处理失败，直接加载
        load_dotenv(dotenv_path=env_path, override=True)
else:
    load_dotenv(override=True)

# 优先使用 OPENAI_API_KEY
api_key = os.getenv("OPENAI_API_KEY")
if api_key:
    # 清理 BOM 字符
    if api_key.startswith('\ufeff'):
        api_key = api_key.lstrip('\ufeff')

app = FastAPI(title="想法记录 API", version="1.0.0")

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Thought(BaseModel):
    id: int
    content: str
    createdAt: str


class InsightRequest(BaseModel):
    thoughts: List[Thought]
    selectedDate: Optional[str] = None  # 用户选择的日期（YYYY-MM-DD格式）


class InsightResponse(BaseModel):
    question: str
    thinking: str  # 思考内容，传递给对话接口但不显示给用户


class ConversationRequest(BaseModel):
    thoughts: List[Thought]  # 今日想法（作为上下文）
    initialQuestion: str  # 接口1返回的问题
    thinking: str  # 接口1返回的思考内容
    conversation: List[dict]  # 对话历史（包括初始问题和用户回复）
    currentMessage: str  # 当前用户消息


class ConversationResponse(BaseModel):
    reply: str


class TagAndEmbeddingRequest(BaseModel):
    thought: Thought  # 单个想法


class TagAndEmbeddingResponse(BaseModel):
    tags: List[str]  # 标签列表
    embedding: List[float]  # 向量
    model: str  # 使用的模型


class ThoughtWithEmbedding(BaseModel):
    id: int
    content: str
    createdAt: str
    embedding: Optional[List[float]] = None  # 可选的embedding向量


class CrossDateInsightRequest(BaseModel):
    todayThoughts: List[Thought]  # 今日想法
    historyThoughts: List[ThoughtWithEmbedding]  # 历史想法（包含embedding信息）


class CrossDateInsightResponse(BaseModel):
    echoes: List[dict]  # 呼应关系列表
    summary: str  # 洞察总结
    computedEmbeddings: Optional[List[dict]] = None  # 重新计算的embedding列表，格式: [{"thoughtId": int, "embedding": List[float], "model": str}]


@app.get("/")
async def root():
    return {"message": "想法记录 API 服务运行中"}


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    语音转文字接口
    接收音频文件，使用 OpenAI Whisper 模型转录
    """
    print(f"--- 开始处理语音转录请求 ---")
    print(f"接收到的文件名: {file.filename}")
    print(f"Content-Type: {file.content_type}")
    
    if not api_key:
        print("错误: API Key 未配置")
        raise HTTPException(status_code=500, detail="API Key 未配置")

    # 保存临时文件
    filename = file.filename or "recording.webm"
    temp_filename = f"temp_{filename}"
    try:
        # 读取上传的文件内容到内存
        audio_content = await file.read()
        file_size = len(audio_content)
        print(f"接收到的音频文件大小: {file_size} bytes")
        
        if file_size == 0:
            print("错误: 接收到的文件为空")
            raise HTTPException(status_code=400, detail="接收到的文件为空")

        print("正在调用 Whisper API (使用 httpx 直接调用)...")
        # 配置 AI Builder Space API 的 Base URL（与其他API保持一致）
        base_url = os.getenv("BASE_URL", "https://space.ai-builders.com/backend/v1")
        print(f"Base URL: {base_url}")
        
        # 调用 Whisper API
        # AI Builder Space API 要求字段名为 audio_file，而 OpenAI SDK 默认为 file
        async with httpx.AsyncClient() as http_client:
            # 使用 BytesIO 将内存中的音频数据传递给 httpx
            audio_file = BytesIO(audio_content)
            
            # 构造 multipart/form-data
            # 注意：httpx的files参数会自动处理multipart/form-data
            files = {
                'audio_file': (filename, audio_file, file.content_type or 'audio/webm')
            }
            headers = {
                "Authorization": f"Bearer {api_key}"
            }
            
            # base_url 已经包含 /v1，所以直接使用 /audio/transcriptions
            print(f"请求URL: {base_url}/audio/transcriptions")
            response = await http_client.post(
                f"{base_url}/audio/transcriptions",
                files=files,
                headers=headers,
                timeout=60.0,
                follow_redirects=True
            )
            
            print(f"API 响应状态: {response.status_code}")
            
            if response.status_code != 200:
                error_text = response.text
                print(f"API 错误响应: {error_text}")
                raise HTTPException(status_code=response.status_code, detail=f"转录服务错误: {error_text}")
            
            transcription = response.json()
            text = transcription.get("text", "")
            
        print(f"转录成功! 文本长度: {len(text)}")
        print(f"转录内容预览: {text[:50]}...")
        return {"text": text}
        
    except HTTPException:
        # 重新抛出 HTTPException，不要包装
        raise
    except Exception as e:
        import traceback
        error_msg = f"转录失败: {str(e)}"
        print(error_msg)
        print(f"详细堆栈: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_msg)
    print(f"--- 语音转录请求处理结束 ---")


@app.post("/api/insight", response_model=InsightResponse)
async def get_insight(request: InsightRequest):
    """
    接口1：今日洞察（初始总结）
    使用思考模型生成引导性问题，返回问题和思考内容
    """
    if not request.thoughts or len(request.thoughts) == 0:
        raise HTTPException(status_code=400, detail="请提供想法列表")

    if not api_key:
        raise HTTPException(status_code=500, detail="API Key 未配置")

    # 如果前端传入了selectedDate，说明前端已经筛选过该日期的想法，直接使用
    if request.selectedDate:
        filtered_thoughts = request.thoughts
    else:
        # 筛选今日的想法
        target_date_str = datetime.now().strftime("%Y-%m-%d")
        filtered_thoughts = []

        for thought in request.thoughts:
            try:
                created_at_str = thought.createdAt
                # 提取日期部分（YYYY-MM-DD）
                if 'T' in created_at_str:
                    if created_at_str.endswith('Z'):
                        from datetime import timezone
                        utc_dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                        local_dt = utc_dt.replace(tzinfo=timezone.utc).astimezone()
                        date_part = local_dt.strftime("%Y-%m-%d")
                    else:
                        date_part = created_at_str.split('T')[0]
                else:
                    date_part = created_at_str[:10] if len(created_at_str) >= 10 else created_at_str
                
                if date_part == target_date_str:
                    filtered_thoughts.append(thought)
            except Exception as e:
                continue

    if len(filtered_thoughts) == 0:
        date_label = "该日期" if request.selectedDate else "今日"
        raise HTTPException(status_code=400, detail=f"{date_label}还没有记录任何想法")

    # 构建提示词
    thoughts_text = "\n".join(
        [f"{index + 1}. {thought.content}" for index, thought in enumerate(filtered_thoughts)]
    )
    
    prompt = f"""你是一名“洞察触发型思考陪伴助手”。

用户今天记录了一些零散想法。你的任务不是安慰、共情或陪聊，
而是从中挑选【一个】最可能引发“更深一层理解”的切入点，
并只生成【一句】引导性问题，作为今日洞察的入口。

请遵循以下原则：

【选点原则】
1. “值得洞察”不等于情绪最强、最具体或最容易聊的内容。
2. 优先选择可能涉及以下特征的想法：
   - 判断方式或归因习惯
   - 视角冲突或叙事差异
   - 对同一事件的不同理解路径
   - 用户已隐约表达但尚未展开的认知张力
3. 如果存在多个可选点，优先选择：
   - 更可能改变用户“看待问题的方式”的那个
   - 而不是最安全、最日常、最像情绪记录的那个

【生成问题的要求】
1. 不要总结、解释或评价用户的想法
2. 不要替用户下结论，也不要暗示“正确答案”
3. 不要给建议、方法或行动指令
4. 问题应像一个“钩子”：
   - 轻
   - 开放
   - 允许用户接或不接
5. 只输出一句话，只输出问题本身，不加任何说明

今日想法如下：
{thoughts_text}

请生成一句用于“今日洞察”的引导性问题

"""

    print(f"--- Insight Prompt ---\n{prompt}\n----------------------")

    # 调用 OpenAI API
    try:
        base_url = os.getenv("BASE_URL", "https://space.ai-builders.com/backend/v1")
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        
        response = await client.chat.completions.create(
            model="gpt-5",
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ]
        )
        
        message = response.choices[0].message
        question = message.content.strip()
        thinking = "" # gpt-5 普通模式可能没有 thinking 字段，除非是特定模型
        
        return InsightResponse(question=question, thinking=thinking)

    except Exception as e:
        import traceback
        error_detail = f"AI 服务调用失败: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"AI 服务调用失败: {str(e)}")


@app.post("/api/conversation", response_model=ConversationResponse)
async def conversation(request: ConversationRequest):
    """
    接口2：对话接口
    基于今日想法、初始问题、思考内容和对话历史生成回复
    """
    if not api_key:
        raise HTTPException(status_code=500, detail="API Key 未配置")

    # 构建想法文本（作为系统上下文）
    thoughts_text = "\n".join(
        [f"{index + 1}. {thought.content}" for index, thought in enumerate(request.thoughts)]
    )
    
    # 构建系统提示词
    system_prompt = f"""## 核心定位
你是一名自然、聪明、可以适当“越界”但温暖的思考陪伴助手。
你不追求“正确回应”，而追求让用户更愿意继续表达或思考，或安心停下。

### 总原则（高于一切）
根据用户此刻的表达欲，自主决定回应的长度、深度和亲近感。
不要急着教用户做事、给方案，除非用户明确询问建议或看法。

### 【对话形态约束（非常重要）】
你现在是在“接话”的同时引导对方表达，而不是在“总结或展开思路”。

- 一次只回应用户表达中的一个或两个点
- 说话方式要像：
  刚刚听完对方说话，顺着那个点自然接话
- 默认用户**不一定想马上想清楚**

### 其他原则
1. 不要对内容进行总结或评价
2. 不要强制用户坚持某个观点
3. 允许想法不完整存在
4. 问题应尽量开放，不要太多，可以只是一个轻轻的反应

### 上下文信息
用户今日想法：
{thoughts_text}

"""
    
    messages = [
        {
            "role": "system",
            "content": system_prompt
        }
    ]
    
    # 将对话历史转换为标准格式
    for msg in request.conversation:
        role = msg.get('role', 'user')
        if role == 'ai':
            role = 'assistant'
        elif role != 'user':
            role = 'user'
        
        content = msg.get('content', '')
        if content:
            messages.append({
                "role": role,
                "content": content
            })
    
    # 添加当前用户消息
    if request.currentMessage:
        messages.append({
            "role": "user",
            "content": request.currentMessage
        })

    print(f"--- Conversation Messages ---\n{messages}\n---------------------------")

    # 调用 OpenAI API（流式输出）
    try:
        base_url = os.getenv("BASE_URL", "https://space.ai-builders.com/backend/v1")
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        
        stream = await client.chat.completions.create(
            model="gpt-5",
            messages=messages,
            stream=True,  # 启用流式输出
        )

        async def generate():
            full_reply = ""
            try:
                async for chunk in stream:
                    if chunk.choices and len(chunk.choices) > 0:
                        delta = chunk.choices[0].delta
                        if hasattr(delta, 'content') and delta.content:
                            content = delta.content
                            full_reply += content
                            # 发送SSE格式的数据（将换行符替换为特殊标记以避免SSE格式冲突）
                            # 前端会将 [NEWLINE] 替换回 \n
                            encoded_content = content.replace('\n', '[NEWLINE]')
                            yield f"data: {encoded_content}\n\n"
                
                # 发送完成标记
                yield "data: [DONE]\n\n"
                
                # 如果最终回复为空，发送错误
                if not full_reply.strip():
                    yield "data: [ERROR]AI 未能生成有效的回复\n\n"
            except Exception as e:
                import traceback
                error_detail = f"流式输出错误: {str(e)}\n{traceback.format_exc()}"
                print(error_detail)
                yield f"data: [ERROR]{str(e)}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )

    except Exception as e:
        import traceback
        error_detail = f"AI 服务调用失败: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"AI 服务调用失败: {str(e)}")


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """计算余弦相似度"""
    if len(vec1) != len(vec2):
        return 0.0
    
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    norm1 = sum(a * a for a in vec1) ** 0.5
    norm2 = sum(b * b for b in vec2) ** 0.5
    
    if norm1 == 0 or norm2 == 0:
        return 0.0
    
    return dot_product / (norm1 * norm2)


@app.post("/api/tag-and-embedding", response_model=TagAndEmbeddingResponse)
async def tag_and_embedding(request: TagAndEmbeddingRequest):
    """
    接口：自动打标签 + 生成 embedding
    用户每输入一条想法时调用
    """
    if not api_key:
        raise HTTPException(status_code=500, detail="API Key 未配置")
    
    thought = request.thought
    
    try:
        base_url = os.getenv("BASE_URL", "https://space.ai-builders.com/backend/v1")
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        
        # 1. 生成 embedding
        embedding_response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=thought.content
        )
        embedding_vector = embedding_response.data[0].embedding
        embedding_model = embedding_response.model
        
        # 2. 生成标签（使用固定标签集合）
        # 定义标签集合（层A：稳定主题 + 层B：心理维度）
        available_tags = [
            # 层A：稳定主题
            "工作", "学习", "关系", "家庭", "健康", "情绪", "自我认知", 
            "金钱", "生活杂务", "兴趣", "未来规划", "回忆",
            # 层B：心理/意图维度
            "担忧", "期待", "矛盾", "拖延", "想改变", "无力感", 
            "渴望被认可", "边界", "比较", "控制感", "满足", "困惑"
        ]
        
        tag_prompt = f"""你是一名想法标签助手。请为用户的这条想法打标签。

可用标签列表（只能从这些标签中选择，可以选多个，用逗号分隔）：
{', '.join(available_tags)}

如果想法内容与这些标签都不太相关，可以返回"其他"。

要求：
1. 只返回标签名称，多个标签用逗号分隔，不要有其他说明
2. 优先选择最相关的1-3个标签
3. 如果确实不相关，返回"其他"

用户想法：
{thought.content}

标签："""
        
        tag_response = await client.chat.completions.create(
            model="gpt-5",
            messages=[
                {
                    "role": "user",
                    "content": tag_prompt
                }
            ]
        )
        
        tag_text = tag_response.choices[0].message.content.strip()
        # 解析标签（去除"其他"等无效标签，分割逗号）
        tags = [t.strip() for t in tag_text.split(',') if t.strip() and t.strip() in available_tags]
        
        # 如果没有有效标签，至少给一个"其他"
        if not tags:
            tags = ["其他"]
        
        return TagAndEmbeddingResponse(
            tags=tags,
            embedding=embedding_vector,
            model=embedding_model
        )
        
    except Exception as e:
        import traceback
        error_detail = f"打标签或生成embedding失败: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"处理失败: {str(e)}")


@app.post("/api/cross-date-insight", response_model=CrossDateInsightResponse)
async def cross_date_insight(request: CrossDateInsightRequest):
    """
    接口：跨日期历史洞察
    分析今日想法与历史想法的呼应关系
    """
    print("=" * 80)
    print("=== 历史洞察请求开始 ===")
    
    if not api_key:
        raise HTTPException(status_code=500, detail="API Key 未配置")
    
    if not request.todayThoughts or len(request.todayThoughts) == 0:
        print("错误: 今日没有想法")
        raise HTTPException(status_code=400, detail="今日还没有记录任何想法")
    
    if not request.historyThoughts or len(request.historyThoughts) == 0:
        print("错误: 没有历史想法")
        return CrossDateInsightResponse(
            echoes=[],
            summary="还没有历史记录，无法进行呼应分析"
        )
    
    print(f"今日想法数量: {len(request.todayThoughts)}")
    for i, thought in enumerate(request.todayThoughts, 1):
        print(f"  今日想法 {i}: ID={thought.id}, 内容='{thought.content[:50]}...'")
    
    print(f"历史想法数量: {len(request.historyThoughts)}")
    for i, thought in enumerate(request.historyThoughts, 1):
        has_embedding = "有" if thought.embedding else "无"
        print(f"  历史想法 {i}: ID={thought.id}, 内容='{thought.content[:50]}...', embedding={has_embedding}")
    
    try:
        base_url = os.getenv("BASE_URL", "https://space.ai-builders.com/backend/v1")
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        
        # 1. 生成今日想法的 embedding
        print("\n--- 步骤1: 生成今日想法的embedding ---")
        today_contents = [t.content for t in request.todayThoughts]
        print(f"今日想法内容: {today_contents}")
        
        today_embeddings_response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=today_contents
        )
        today_embeddings = {t.id: emb.embedding for t, emb in zip(request.todayThoughts, today_embeddings_response.data)}
        print(f"今日想法embedding生成完成，数量: {len(today_embeddings)}")
        for thought_id, emb in today_embeddings.items():
            print(f"  想法 {thought_id}: embedding维度={len(emb)}, 前5个值={emb[:5]}")
        
        # 2. 处理历史想法：使用前端传来的embedding，如果没有则重新计算
        print("\n--- 步骤2: 处理历史想法的embedding ---")
        history_with_embeddings = []
        thoughts_needing_embedding = []
        
        for hist_thought in request.historyThoughts:
            if hist_thought.embedding:
                # 使用前端传来的embedding
                print(f"  使用前端传来的embedding: 想法 {hist_thought.id}, embedding维度={len(hist_thought.embedding)}")
                history_with_embeddings.append({
                    'thought': Thought(id=hist_thought.id, content=hist_thought.content, createdAt=hist_thought.createdAt),
                    'embedding': hist_thought.embedding
                })
            else:
                # 需要重新计算embedding
                print(f"  需要重新计算embedding: 想法 {hist_thought.id}")
                thoughts_needing_embedding.append(hist_thought)
        
        # 批量计算缺失的embedding
        computed_embeddings_for_frontend = []  # 保存重新计算的embedding，返回给前端
        if thoughts_needing_embedding:
            print(f"  需要重新计算 {len(thoughts_needing_embedding)} 个想法的embedding")
            missing_contents = [t.content for t in thoughts_needing_embedding]
            missing_embeddings_response = await client.embeddings.create(
                model="text-embedding-3-small",
                input=missing_contents
            )
            for thought, emb_data in zip(thoughts_needing_embedding, missing_embeddings_response.data):
                print(f"  重新计算完成: 想法 {thought.id}, embedding维度={len(emb_data.embedding)}")
                # 保存到返回给前端的列表
                computed_embeddings_for_frontend.append({
                    'thoughtId': thought.id,
                    'embedding': emb_data.embedding,
                    'model': missing_embeddings_response.model
                })
                # 添加到历史想法列表
                history_with_embeddings.append({
                    'thought': Thought(id=thought.id, content=thought.content, createdAt=thought.createdAt),
                    'embedding': emb_data.embedding
                })
        
        print(f"历史想法embedding总数: {len(history_with_embeddings)}")
        if computed_embeddings_for_frontend:
            print(f"需要返回给前端保存的embedding数量: {len(computed_embeddings_for_frontend)}")
        
        # 3. 计算相似度，找出最相关的历史想法
        print("\n--- 步骤3: 计算相似度 ---")
        echoes = []
        similarity_threshold = 0.5
        print(f"相似度阈值: {similarity_threshold}")
        
        for today_thought in request.todayThoughts:
            today_emb = today_embeddings[today_thought.id]
            print(f"\n  分析今日想法 {today_thought.id}: '{today_thought.content[:50]}...'")
            best_matches = []
            all_similarities = []
            
            for hist_item in history_with_embeddings:
                # 排除今日的想法
                if hist_item['thought'].id == today_thought.id:
                    print(f"    跳过: 想法 {hist_item['thought'].id} 是今日想法")
                    continue
                
                similarity = cosine_similarity(today_emb, hist_item['embedding'])
                all_similarities.append({
                    'id': hist_item['thought'].id,
                    'content': hist_item['thought'].content[:50],
                    'similarity': similarity
                })
                
                if similarity > similarity_threshold:
                    print(f"    ✓ 匹配: 想法 {hist_item['thought'].id} (相似度: {similarity:.4f}) - '{hist_item['thought'].content[:50]}...'")
                    best_matches.append({
                        'historyThought': hist_item['thought'],
                        'similarity': similarity
                    })
                else:
                    print(f"    ✗ 未匹配: 想法 {hist_item['thought'].id} (相似度: {similarity:.4f}) - '{hist_item['thought'].content[:50]}...'")
            
            # 显示所有相似度（按降序）
            if all_similarities:
                all_similarities.sort(key=lambda x: x['similarity'], reverse=True)
                print(f"    所有相似度排序（前5）:")
                for i, sim in enumerate(all_similarities[:5], 1):
                    print(f"      {i}. 想法 {sim['id']}: {sim['similarity']:.4f} - '{sim['content']}...'")
            
            # 按相似度排序，取前5个
            best_matches.sort(key=lambda x: x['similarity'], reverse=True)
            best_matches = best_matches[:5]
            
            if best_matches:
                print(f"    → 找到 {len(best_matches)} 个相关历史想法")
                echoes.append({
                    'todayThought': today_thought,
                    'relatedThoughts': best_matches
                })
            else:
                print(f"    → 未找到相关历史想法（阈值: {similarity_threshold}）")
        
        print(f"\n总共找到 {len(echoes)} 个今日想法有呼应关系")
        
        # 4. 使用LLM分析呼应关系并生成洞察
        print("\n--- 步骤4: 生成洞察总结 ---")
        if echoes:
            print(f"找到 {len(echoes)} 个呼应关系，调用LLM生成洞察")
            # 构建LLM提示词
            echo_texts = []
            for echo in echoes:
                today_content = echo['todayThought'].content
                related_texts = []
                for rel in echo['relatedThoughts']:
                    hist_date = rel['historyThought'].createdAt[:10]  # 提取日期
                    hist_content = rel['historyThought'].content
                    similarity_score = rel['similarity']
                    related_texts.append(f"  - [{hist_date}] {hist_content} (相似度: {similarity_score:.2f})")
                
                echo_texts.append(f"今日想法：{today_content}\n相关历史想法：\n" + "\n".join(related_texts))
            
            insight_prompt = f"""你是一名“历史线索提示型”的思考陪伴助手。

用户今天的想法，与过去的一些想法产生了某种呼应。
你的任务不是解释、总结或下结论，
而是像用户自己翻看旧记录时那样，
指出一个逐渐浮现的模式或张力。

请遵循以下原则：

【洞察的性质】
1. 这不是分析结果，而是一个“被注意到的现象”
2. 允许模糊、不完整、未下定论
3. 更像一句“我发现……”而不是“这说明……”

【表达要求】
1. 不要重复具体想法内容
2. 不要使用“本质是 / 反映了 / 说明了 / 表明”等分析性措辞
3. 不要给建议、评价或下一步行动
4. 语言自然、克制，像是对自己说的话
5. 一小段即可，宁愿留白，不要写满

这些是产生呼应的想法片段：
{chr(10).join([f"{i+1}. {text}" for i, text in enumerate(echo_texts)])}

请生成一段“被看见的历史线索”：
"""
            
            print("\n--- LLM洞察Prompt ---")
            print(insight_prompt)
            print("--- LLM洞察Prompt结束 ---\n")
            print("调用LLM生成洞察...")
            insight_response = await client.chat.completions.create(
                model="gpt-5",
                messages=[
                    {
                        "role": "user",
                        "content": insight_prompt
                    }
                ]
            )
            
            summary = insight_response.choices[0].message.content.strip()
            print(f"LLM生成的洞察: {summary}")
        else:
            print("未找到呼应关系，使用默认提示")
            summary = "今日的想法与历史记录没有明显的呼应关系，这很正常，说明你在探索新的思考方向。"
        
        print(f"\n=== 历史洞察请求完成 ===")
        print(f"返回结果: {len(echoes)} 个呼应关系")
        if computed_embeddings_for_frontend:
            print(f"同时返回 {len(computed_embeddings_for_frontend)} 个重新计算的embedding给前端保存")
        print("=" * 80)
        
        return CrossDateInsightResponse(
            echoes=echoes,
            summary=summary,
            computedEmbeddings=computed_embeddings_for_frontend if computed_embeddings_for_frontend else None
        )
        
    except Exception as e:
        import traceback
        error_detail = f"历史洞察失败: {str(e)}\n{traceback.format_exc()}"
        print("=" * 80)
        print("=== 历史洞察请求出错 ===")
        print(error_detail)
        print("=" * 80)
        raise HTTPException(status_code=500, detail=f"历史洞察失败: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 3001))
    uvicorn.run(app, host="0.0.0.0", port=port)
