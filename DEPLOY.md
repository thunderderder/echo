# 部署说明

## 部署前准备

### 1. 构建前端

```bash
npm run build
```

这会生成 `dist` 目录，包含构建后的前端文件。

### 2. 环境变量配置

确保在生产环境中设置以下环境变量：

- `OPENAI_API_KEY`: OpenAI API Key（或 DeepSeek API Key）
- `PORT`: 服务端口（默认 3001）
- `BASE_URL`: API Base URL（可选，默认使用 AI Builder Space）

### 3. 安装依赖

**Python 依赖：**
```bash
pip install -r requirements.txt
```

**前端依赖（构建时需要）：**
```bash
npm install
```

## 部署方式

### 方式一：单进程部署（推荐）

项目已配置为单进程、单端口部署，同时服务前端静态文件和后端 API。

```bash
python server.py
```

服务器会：
- 在 `PORT` 环境变量指定的端口（默认 3001）启动
- 自动检测 `dist` 目录，如果存在则服务前端文件
- API 路由在 `/api/*` 路径下
- 前端应用在根路径 `/` 下

### 方式二：使用 uvicorn

```bash
uvicorn server:app --host 0.0.0.0 --port ${PORT:-3001}
```

## 部署检查清单

- [ ] 前端已构建（`dist` 目录存在）
- [ ] Python 依赖已安装
- [ ] 环境变量已配置（`.env` 文件或系统环境变量）
- [ ] `PORT` 环境变量已设置（如果使用非默认端口）
- [ ] 服务器可以访问所需的外部 API（OpenAI/DeepSeek）

## 生产环境注意事项

1. **CORS 配置**：当前 CORS 设置为允许所有来源（`allow_origins=["*"]`），生产环境建议限制为具体域名。

2. **静态文件**：确保 `dist` 目录在生产环境中存在，否则前端将无法访问。

3. **API 路由**：所有 API 路由都在 `/api/*` 路径下，前端使用相对路径调用。

4. **健康检查**：可以访问 `/` 或 `/docs` 检查服务是否正常运行。

## 测试部署

部署后，可以通过以下方式测试：

1. 访问根路径查看前端应用
2. 访问 `/docs` 查看 API 文档
3. 测试 API 端点：`/api/insight`、`/api/conversation` 等
