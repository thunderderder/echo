# 想法记录工具

一个简洁、零干扰的想法记录工具，帮助你捕捉日常生活中的每一个想法。

## 特性

- ✨ 简洁美观的界面设计
- 🚀 快速记录，无需复杂操作
- 💾 本地存储，数据安全
- 📱 响应式设计，支持移动端
- 🎯 零干扰，专注记录
- 🤖 AI 深度思考：基于今日想法生成引导性问题

## 开始使用

### 1. 安装依赖

**前端依赖：**
```bash
npm install
```

**后端依赖（需要 Python 3.8+）：**
```bash
pip install -r requirements.txt
```

或者使用虚拟环境（推荐）：
```bash
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2. 配置环境变量

创建 `.env` 文件，添加你的 DeepSeek API Key：

```env
DEEPSEEK_API_KEY=your_deepseek_api_key_here
PORT=3001
```

### 3. 启动服务

**方式一：同时启动前后端（推荐）**

```bash
npm run dev:all
```

**方式二：分别启动**

启动后端服务器（FastAPI）：
```bash
npm run server
# 或直接运行
python server.py
```

启动前端开发服务器（新终端）：
```bash
npm run dev
```

### 4. 访问应用

前端：http://localhost:5173  
后端：http://localhost:3001

## 使用说明

1. 在输入框中写下你的想法
2. 按 `Enter` 发送，`Shift+Enter` 换行
3. 点击"记录"按钮保存想法
4. 查看已记录的想法列表
5. 点击想法内容可以编辑
6. 点击 × 按钮删除不需要的记录
7. **今日深度思考**：当有今日想法时，点击"今日深度思考"按钮，AI 会分析你的想法并生成引导性问题

## 技术栈

- **前端**：React 18 + Vite
- **后端**：FastAPI + Python 3.8+
- **AI**：DeepSeek API
- **存储**：本地存储 (LocalStorage)

## API 文档

启动后端服务后，可以访问自动生成的 API 文档：
- Swagger UI: http://localhost:3001/docs
- ReDoc: http://localhost:3001/redoc
